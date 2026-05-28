/**
 * Sagitta Fineract Settlement Evidence Writeback Demo
 *
 * Writes Sagitta settlement evidence back to a live Fineract fixed deposit
 * account using verified extension points:
 *
 *   1. Datatable (SAGITTA_SETTLEMENT_EVIDENCE → m_savings_account)
 *      Structured row; machine-readable; idempotent via POST/PUT.
 *
 *   2. Note (POST /savings/{accountId}/notes)
 *      Human-readable audit trail; append-only.
 *
 *   3. externalId writeback: NOT SUPPORTED
 *      PUT /fixeddepositaccounts/{id} with externalId returns HTTP 400 (empty body).
 *      This is a known limitation of the current Fineract build.
 *      The sagittaTermDepositId is stored in the datatable and note instead.
 *
 * Guards:
 *   - Requires SAGITTA_EVIDENCE_WRITE=true (prevents accidental writes).
 *   - When SAGITTA_DEMO_EVIDENCE=true the evidence object is clearly synthetic
 *     and labelled; it is never passed to a real settlement pipeline.
 *   - npm run smoke remains read-only (no guard env vars are set).
 *
 * Modes:
 *   demo:settlement-writeback
 *     Reads SAGITTA_ACCOUNT_ID from env (or falls back to account id=1 for demo).
 *     Builds evidence, writes to datatable + note, updates receipt.
 *
 *   demo:evidence-only
 *     Builds and prints the evidence object without writing anything to Fineract.
 *     Useful for inspecting the evidence shape in CI or dry-run contexts.
 */

import "dotenv/config";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { FineractHttpClient } from "./fineractHttp.js";
import {
  buildSettlementEvidence,
  type SagittaSettlementEvidence,
  type WritebackResult,
} from "./settlementEvidence.js";
import {
  addFdAccountNote,
  buildSettlementNoteText,
} from "./fineractNotes.js";
import {
  ensureSettlementEvidenceTable,
  writeSettlementEvidenceRow,
} from "./fineractDataTables.js";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`${name} must be an integer, got: ${v}`);
  return n;
}

const LIFECYCLE_RECEIPT = "out/sagitta-fineract-fixed-deposit-demo.json";
const WRITEBACK_RECEIPT = "out/sagitta-fineract-settlement-writeback-demo.json";

// ---------------------------------------------------------------------------
// Load existing lifecycle receipt
// ---------------------------------------------------------------------------

interface LifecycleReceipt {
  fineractAccountId?: number;
  sagittaTermDeposit?: { fineractAccountId?: number };
  reserveGate?: Record<string, unknown>;
  [key: string]: unknown;
}

async function loadLifecycleReceipt(): Promise<LifecycleReceipt | null> {
  if (!existsSync(LIFECYCLE_RECEIPT)) return null;
  const raw = await readFile(LIFECYCLE_RECEIPT, "utf8");
  return JSON.parse(raw) as LifecycleReceipt;
}

// ---------------------------------------------------------------------------
// Datatable row builder
// ---------------------------------------------------------------------------

function evidenceToDataTableRow(ev: SagittaSettlementEvidence): Record<string, unknown> {
  return {
    sagitta_term_deposit_id:    ev.sagittaTermDepositId,
    circle_transfer_id:         ev.circleTransferId    ?? "",
    arc_tx_hash:                ev.arcTxHash           ?? "",
    treasury_batch_id:          ev.treasuryBatchId     ?? "",
    escrow_execution_order_id:  ev.escrowExecutionOrderId ?? "",
    allocation_plan_hash:       ev.allocationPlanHash  ?? "",
    reserve_gate_hash:          ev.reserveGateHash     ?? "",
    settlement_status:          ev.settlementStatus,
    evidence_version:           ev.evidenceVersion,
    recorded_at:                ev.recordedAt,
    // Fineract datatable write requires locale + dateFormat even when no date columns are used
    locale:                     "en",
    dateFormat:                 "yyyy-MM-dd",
  };
}

// ---------------------------------------------------------------------------
// Core writeback flow
// ---------------------------------------------------------------------------

interface WritebackContext {
  accountId: number;
  evidence: SagittaSettlementEvidence;
  http: FineractHttpClient;
  receiptFilename: string;
}

async function runDatatableWriteback(ctx: WritebackContext): Promise<WritebackResult> {
  const { accountId, evidence, http } = ctx;

  // 1. Ensure the datatable exists (create if missing, skip if present)
  console.log("  [datatable] Ensuring SAGITTA_SETTLEMENT_EVIDENCE table exists...");
  let tableStatus: "created" | "already_exists";
  try {
    tableStatus = await ensureSettlementEvidenceTable(http);
    console.log(`  [datatable] Table: ${tableStatus}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [datatable] Could not ensure table: ${msg}`);
    return { method: "datatable", success: false, error: msg };
  }

  // 2. Write the evidence row
  const row = evidenceToDataTableRow(evidence);
  try {
    const { outcome, result } = await writeSettlementEvidenceRow(accountId, row, http);
    const resourceId = typeof result.resourceId === "number" ? result.resourceId : undefined;
    console.log(`  [datatable] Row ${outcome} for account ${accountId}, resourceId=${resourceId ?? "(none)"}`);
    return { method: "datatable", success: true, fineractResourceId: resourceId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [datatable] Write failed: ${msg}`);
    return { method: "datatable", success: false, error: msg };
  }
}

async function runNoteWriteback(ctx: WritebackContext): Promise<WritebackResult> {
  const { accountId, evidence, http, receiptFilename } = ctx;
  const isDemo = evidence._demoOnly === true;

  const noteText = buildSettlementNoteText({
    sagittaTermDepositId: evidence.sagittaTermDepositId,
    settlementStatus: evidence.settlementStatus,
    receiptFilename,
    isDemo,
  });

  try {
    const result = await addFdAccountNote(accountId, noteText, http);
    const resourceId = typeof result.resourceId === "number" ? result.resourceId : undefined;
    console.log(`  [note] Added to account ${accountId}, noteId=${resourceId ?? "(none)"}`);
    return { method: "note", success: true, fineractResourceId: resourceId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  [note] Write failed: ${msg}`);
    return { method: "note", success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// demo:settlement-writeback entry point
// ---------------------------------------------------------------------------

async function runSettlementWriteback(): Promise<void> {
  if (process.env.SAGITTA_EVIDENCE_WRITE?.toLowerCase() !== "true") {
    console.error(
      "Error: SAGITTA_EVIDENCE_WRITE=true is required to write settlement evidence to Fineract.\n" +
        "Set it in your .env file or prefix the command:\n" +
        "  SAGITTA_EVIDENCE_WRITE=true npm run demo:settlement-writeback\n" +
        "\n" +
        "To inspect the evidence without writing anything:\n" +
        "  npm run demo:evidence-only\n" +
        "\n" +
        "npm run smoke remains read-only regardless of this flag.",
    );
    process.exitCode = 1;
    return;
  }

  const isDemo = process.env.SAGITTA_DEMO_EVIDENCE?.toLowerCase() === "true";

  console.log("=".repeat(60));
  console.log("Sagitta Fineract Settlement Evidence Writeback Demo");
  console.log("=".repeat(60));

  // Resolve the account id
  const lifecycle = await loadLifecycleReceipt();
  const envAccountId = envInt("SAGITTA_ACCOUNT_ID", 0);
  const accountId =
    envAccountId ||
    (lifecycle?.fineractAccountId ??
      (lifecycle?.sagittaTermDeposit?.fineractAccountId ?? 1));

  console.log(`Account id: ${accountId}`);
  console.log(`Demo mode:  ${isDemo ? "YES — synthetic evidence, clearly labelled" : "NO — real evidence expected"}`);
  console.log();

  // Build evidence
  const evidence = buildSettlementEvidence({ fineractAccountId: accountId });
  console.log("Evidence object:");
  console.log(JSON.stringify(evidence, null, 2));
  console.log();

  if (evidence._demoOnly) {
    console.log("⚠  DEMO evidence — synthetic values only.  Not real settlement data.");
    console.log();
  }

  const http = new FineractHttpClient();
  const writebackResults: WritebackResult[] = [];

  // ── Datatable writeback ───────────────────────────────────────────────────
  console.log("── Writeback: datatable ──");
  const dtResult = await runDatatableWriteback({
    accountId,
    evidence,
    http,
    receiptFilename: WRITEBACK_RECEIPT,
  });
  writebackResults.push(dtResult);
  console.log(`  Result: ${dtResult.success ? "✓ OK" : "✗ FAILED — " + dtResult.error}`);
  console.log();

  // ── Note writeback ────────────────────────────────────────────────────────
  console.log("── Writeback: note ──");
  const noteResult = await runNoteWriteback({
    accountId,
    evidence,
    http,
    receiptFilename: WRITEBACK_RECEIPT,
  });
  writebackResults.push(noteResult);
  console.log(`  Result: ${noteResult.success ? "✓ OK" : "✗ FAILED — " + noteResult.error}`);
  console.log();

  // ── externalId writeback (not supported — documented skip) ────────────────
  console.log("── Writeback: externalId ──");
  console.log("  SKIPPED — PUT /fixeddepositaccounts/{id} with externalId returns HTTP 400.");
  console.log("  Root cause: Fineract does not support externalId updates on FD accounts in this build.");
  console.log("  Mitigation: sagittaTermDepositId is stored in the datatable and note instead.");
  const externalIdResult: WritebackResult = {
    method: "local_only",
    success: false,
    error: "externalId writeback is not supported on Fineract FD accounts (PUT returns 400). " +
           "sagittaTermDepositId recorded in datatable and note.",
  };
  writebackResults.push(externalIdResult);
  console.log();

  // ── Determine recommended production method ───────────────────────────────
  const successfulMethods = writebackResults
    .filter((r) => r.success)
    .map((r) => r.method);
  const primaryMethod = successfulMethods[0] ?? "local_only";

  const recommendedApproach =
    successfulMethods.includes("datatable")
      ? "datatable (structured, queryable) + note (human audit trail)"
      : successfulMethods.includes("note")
      ? "note only (datatable write failed — see errors above)"
      : "local_only (all Fineract writes failed — evidence preserved in receipt only)";

  // ── Receipt ───────────────────────────────────────────────────────────────
  console.log("── Writing receipt ──");

  const receipt = {
    writebackRunAt: new Date().toISOString(),
    fineractBaseUrl: http.config.baseUrl,
    fineractTenantId: http.config.tenantId,
    fineractAccountId: accountId,

    // Original lifecycle data (if available)
    ...(lifecycle ?? {}),

    // Settlement evidence
    settlementEvidence: evidence,

    // Writeback results per method
    writebackResults: {
      externalId: {
        attempted: false,
        supported: false,
        reason:
          "PUT /fixeddepositaccounts/{id} with externalId returns HTTP 400 (empty body). " +
          "Fineract does not support externalId updates on FD accounts in this build.",
      },
      datatable: {
        attempted: true,
        tableName: "SAGITTA_SETTLEMENT_EVIDENCE",
        apptable: "m_savings_account",
        ...dtResult,
      },
      note: {
        attempted: true,
        entityPath: `/savings/${accountId}/notes`,
        ...noteResult,
      },
    },

    // Summary
    writebackMethodUsed: primaryMethod,
    recommendedProductionApproach: recommendedApproach,
    warnings: [
      ...(evidence._demoOnly
        ? ["DEMO evidence — synthetic values only; not real settlement data"]
        : []),
      ...writebackResults
        .filter((r) => !r.success && r.error)
        .map((r) => `${r.method} writeback failed: ${r.error}`),
    ],
  };

  await mkdir("out", { recursive: true });
  await writeFile(WRITEBACK_RECEIPT, JSON.stringify(receipt, null, 2), "utf8");

  console.log(`  Receipt written to: ${WRITEBACK_RECEIPT}`);
  console.log();
  console.log("=".repeat(60));
  console.log(`Writeback summary:`);
  console.log(`  externalId:  NOT SUPPORTED`);
  console.log(`  datatable:   ${dtResult.success ? "✓ OK" : "✗ FAILED"}`);
  console.log(`  note:        ${noteResult.success ? "✓ OK" : "✗ FAILED"}`);
  console.log(`  Recommended: ${recommendedApproach}`);
  console.log(`  Receipt:     ${WRITEBACK_RECEIPT}`);
  console.log("=".repeat(60));

  // Non-zero exit if all Fineract writes failed
  if (!dtResult.success && !noteResult.success) {
    console.error(
      "\nAll Fineract writes failed. Evidence is preserved in the local receipt only.",
    );
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// demo:evidence-only entry point
// ---------------------------------------------------------------------------

async function runEvidenceOnly(): Promise<void> {
  const lifecycle = await loadLifecycleReceipt();
  const envAccountId = envInt("SAGITTA_ACCOUNT_ID", 0);
  const accountId =
    envAccountId ||
    (lifecycle?.fineractAccountId ??
      (lifecycle?.sagittaTermDeposit?.fineractAccountId ?? 1));

  const isDemo = process.env.SAGITTA_DEMO_EVIDENCE?.toLowerCase() === "true";

  console.log("=".repeat(60));
  console.log("Sagitta Settlement Evidence — dry run (no Fineract writes)");
  console.log("=".repeat(60));
  console.log(`Account id: ${accountId}`);
  console.log(`Demo mode:  ${isDemo ? "YES" : "NO"}`);
  console.log();

  const evidence = buildSettlementEvidence({ fineractAccountId: accountId });
  console.log(JSON.stringify(evidence, null, 2));

  if (evidence._demoOnly) {
    console.log();
    console.log("⚠  DEMO evidence — synthetic values only.  Not real settlement data.");
  }
}

// ---------------------------------------------------------------------------
// Dispatch by entry point
// ---------------------------------------------------------------------------

const isSelf =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isSelf) {
  const mode = process.env.EVIDENCE_DEMO_MODE ?? "writeback";

  if (mode === "evidence-only") {
    runEvidenceOnly().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  } else {
    runSettlementWriteback().catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
