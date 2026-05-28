/**
 * Sagitta Fineract Fixed Deposit Lifecycle Demo
 *
 * Opt-in via CREATE_TEST_DATA=true.  npm run smoke remains read-only.
 *
 * What this script does:
 *   1. Validate CREATE_TEST_DATA=true guard.
 *   2. Run the local reserve capacity gate.
 *   3. Find or create a SAGITTA_TEST_ client.
 *   4. Find or create a SAGITTA_TEST_ fixed deposit product.
 *   5. Create a new fixed deposit account (or reuse one in submitted/approved state).
 *   6. Approve the account (if not already approved/active).
 *   7. Activate the account (if not already active).
 *   8. Fetch the final account state.
 *   9. Map it into the Sagitta term deposit shape.
 *  10. Write a JSON receipt to out/sagitta-fineract-fixed-deposit-demo.json.
 *
 * All created Fineract records use the SAGITTA_TEST_ prefix so they are easy
 * to identify and clean up. The script is idempotent: client and product are
 * reused if they already exist; accounts in-flight are advanced rather than
 * duplicated.
 *
 * Field names confirmed against the live local Fineract instance on 2026-05-26:
 *   - Product:  minDepositTermTypeId / maxDepositTermTypeId  (NOT minDepositTermType)
 *   - Product:  description is mandatory
 *   - Product:  chart.dateFormat / chart.locale must be inside each chart object
 *   - Client:   legalFormId is mandatory (1 = Person)
 *   - Account:  depositPeriodFrequencyId (2 = Months)
 *   - Approve:  body { approvedOnDate, dateFormat, locale } at ?command=approve
 *   - Activate: body { activatedOnDate, dateFormat, locale } at ?command=activate
 */

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { FineractHttpClient } from "./fineractHttp.js";
import { listClients, type FineractClient, type FineractPage } from "./clients.js";
import {
  listFixedDepositProducts,
  type FineractFixedDepositProduct,
} from "./fixedDepositProducts.js";
import {
  listFixedDepositAccounts,
  getFixedDepositAccount,
  createFixedDepositAccount,
  approveFixedDepositAccount,
  activateFixedDepositAccount,
  type FineractFixedDepositAccount,
  type CommandResult,
} from "./fixedDepositAccounts.js";
import { mapFixedDepositToSagittaTermDeposit } from "./sagittaTermDepositMapper.js";
import { checkReserveGate, type ReserveGateResult } from "./reserveGate.js";
import { readOnchainReserve, type OnchainReserveResult } from "./onchainReserve.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function envFloat(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = parseFloat(v);
  if (isNaN(n)) throw new Error(`${name} must be a number, got: ${v}`);
  return n;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`${name} must be an integer, got: ${v}`);
  return n;
}

interface DemoConfig {
  clientName: string;
  depositAmount: number;
  fixedYieldApy: number;
  termMonths: number;
  reserveAmountUsd: number;
  coverageRatio: number;
}

function loadDemoConfig(): DemoConfig {
  return {
    clientName: process.env.SAGITTA_TEST_CLIENT_NAME ?? "SAGITTA_TEST_CLIENT",
    depositAmount: envFloat("SAGITTA_TEST_DEPOSIT_AMOUNT", 1000),
    fixedYieldApy: envFloat("SAGITTA_TEST_FIXED_YIELD_APY", 0.06),
    termMonths: envInt("SAGITTA_TEST_TERM_MONTHS", 12),
    reserveAmountUsd: envFloat("SAGITTA_TEST_RESERVE_AMOUNT", 100),
    coverageRatio: envFloat("SAGITTA_TEST_COVERAGE_RATIO", 1.25),
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as "dd MMMM yyyy" (e.g. "26 May 2026").
 * Used for client creation, FD account submission, and FD product charts — all
 * of which send dateFormat="dd MMMM yyyy" with their payload.
 */
function fineractDateStr(date: Date = new Date()): string {
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

/**
 * Format a Date as "yyyy-MM-dd" (e.g. "2026-05-26").
 * The approve and activate command helpers in fixedDepositAccounts.ts hardcode
 * dateFormat="yyyy-MM-dd" in their commandDatePayload, so these commands must
 * receive the date in ISO form.
 */
function isoDateStr(date: Date = new Date()): string {
  return date.toISOString().split("T")[0]!;
}

const DATE_FORMAT = "dd MMMM yyyy";
const LOCALE = "en";

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

const PRODUCT_NAME = "SAGITTA_TEST_FD_PRODUCT";
const PRODUCT_SHORT_NAME = "STFD";
const PRODUCT_DESCRIPTION = "Sagitta test fixed deposit USD — demo only";

async function findOrCreateClient(
  http: FineractHttpClient,
  fullName: string,
): Promise<{ client: FineractClient; created: boolean }> {
  // fullName is "SAGITTA_TEST CLIENT" (firstname + space + lastname).
  // Parse lastname = word after last space; firstname = everything before it.
  const lastSpace = fullName.lastIndexOf(" ");
  const firstname = lastSpace >= 0 ? fullName.substring(0, lastSpace).trim() : fullName;
  const lastname = lastSpace >= 0 ? fullName.substring(lastSpace + 1).trim() : "DEMO";
  // Fineract displayName = "<firstname> <lastname>"
  const expectedDisplayName = `${firstname} ${lastname}`;

  // Use Fineract's displayName search filter to avoid loading all clients
  const page = await http.get<FineractPage<FineractClient>>(
    `/clients?displayName=${encodeURIComponent(expectedDisplayName)}&limit=5`,
  );
  const items: FineractClient[] = Array.isArray(page)
    ? (page as unknown as FineractClient[])
    : (page.pageItems ?? []);

  // Exact match on displayName
  const existing = items.find(
    (c) => typeof c.displayName === "string" && c.displayName.trim() === expectedDisplayName,
  );
  if (existing) {
    return { client: existing, created: false };
  }


  const today = fineractDateStr();
  const result = await http.post<CommandResult>("/clients", {
    officeId: 1, // Head Office — always id=1 in a fresh Fineract instance
    legalFormId: 1, // 1=Person (confirmed from /clients/template)
    firstname,
    lastname,
    active: true,
    activationDate: today,
    dateFormat: DATE_FORMAT,
    locale: LOCALE,
  });

  const created: FineractClient = {
    id: result.clientId ?? result.resourceId,
    displayName: fullName,
    accountNo: undefined,
  };
  return { client: created, created: true };
}

// ---------------------------------------------------------------------------
// Product helpers
// ---------------------------------------------------------------------------

async function findOrCreateProduct(
  http: FineractHttpClient,
  apy: number,
): Promise<{ product: FineractFixedDepositProduct; created: boolean }> {
  const products = await listFixedDepositProducts(http);
  const existing = products.find((p) => p.name === PRODUCT_NAME);
  if (existing) {
    return { product: existing, created: false };
  }

  // Field names confirmed live:
  //   minDepositTermTypeId / maxDepositTermTypeId  (NOT minDepositTermType)
  //   description is mandatory
  //   dateFormat goes inside each chart object, NOT at top level
  //   accountingRule=1 = NONE (no GL accounts required)
  const today = fineractDateStr(new Date(new Date().getFullYear(), 0, 1)); // Jan 1 of current year
  const nominalRate = Math.round(apy * 100 * 1e6) / 1e6; // e.g. 0.06 -> 6.0

  const result = await http.post<CommandResult>("/fixeddepositproducts", {
    name: PRODUCT_NAME,
    shortName: PRODUCT_SHORT_NAME,
    description: PRODUCT_DESCRIPTION,
    currencyCode: "USD",
    digitsAfterDecimal: 2,
    inMultiplesOf: 0,
    // accountingRule=1 = NONE — no GL accounts required for demo
    accountingRule: 1,
    nominalAnnualInterestRate: nominalRate,
    interestCompoundingPeriodType: 4, // Monthly
    interestPostingPeriodType: 4, // Monthly
    interestCalculationType: 1, // Daily Balance
    interestCalculationDaysInYearType: 365,
    lockinPeriodFrequency: 0,
    lockinPeriodFrequencyType: 0,
    minDepositAmount: 1,
    depositAmount: 1000,
    maxDepositAmount: 999_999_999,
    minDepositTerm: 1,
    minDepositTermTypeId: 2, // Months — confirmed field name from integration-tests source
    maxDepositTerm: 60,
    maxDepositTermTypeId: 2, // Months
    locale: LOCALE,
    // charts[].fromDate requires dateFormat and locale inside the chart object
    charts: [
      {
        fromDate: today,
        dateFormat: DATE_FORMAT,
        locale: LOCALE,
        isPrimaryGroupingByAmount: false,
        // Chart slabs: fromPeriod must start at 1 to avoid chart.slabs.range.start.incorrect
        chartSlabs: [
          {
            periodType: 2, // Months
            fromPeriod: 1,
            toPeriod: 60,
            annualInterestRate: nominalRate,
            locale: LOCALE,
          },
        ],
      },
    ],
  });

  const created: FineractFixedDepositProduct = {
    id: result.resourceId,
    name: PRODUCT_NAME,
    shortName: PRODUCT_SHORT_NAME,
    currency: { code: "USD" },
  };
  return { product: created, created: true };
}

// ---------------------------------------------------------------------------
// Account lifecycle helpers
// ---------------------------------------------------------------------------

function accountStatus(account: FineractFixedDepositAccount): string {
  const s = account.status as Record<string, unknown> | undefined;
  if (!s) return "unknown";
  if (s["active"] === true) return "active";
  if (s["approved"] === true) return "approved";
  if (s["submittedAndPendingApproval"] === true) return "submitted";
  if (s["closed"] === true || s["prematureClosed"] === true || s["matured"] === true) return "closed";
  return String(s["value"] ?? "unknown");
}

/**
 * Find an existing in-flight FD account for the given client + product that is
 * not yet closed/matured, so we can advance it rather than create a duplicate.
 */
async function findInFlightAccount(
  http: FineractHttpClient,
  clientId: number,
  productId: number,
): Promise<FineractFixedDepositAccount | undefined> {
  const accounts = await listFixedDepositAccounts(http);
  return accounts.find(
    (a) =>
      a.clientId === clientId &&
      (a.savingsProductId === productId || (a as Record<string, unknown>)["depositProductId"] === productId) &&
      accountStatus(a) !== "closed",
  );
}

// ---------------------------------------------------------------------------
// Settlement evidence placeholder
// ---------------------------------------------------------------------------

const SETTLEMENT_EVIDENCE_PLACEHOLDER = {
  circleTransferId: null,
  arcTxHash: null,
  treasuryBatchId: null,
  escrowExecutionOrderId: null,
  allocationPlanHash: null,
  settlementStatus: "not_started",
};

// ---------------------------------------------------------------------------
// Main lifecycle
// ---------------------------------------------------------------------------

async function runLifecycle(): Promise<void> {
  // Guard: must opt in explicitly
  if (process.env.CREATE_TEST_DATA?.toLowerCase() !== "true") {
    console.error(
      "Error: CREATE_TEST_DATA=true is required to run the FD lifecycle demo.\n" +
        "Set it in your .env file or prefix the command:\n" +
        "  CREATE_TEST_DATA=true npm run demo:fd-lifecycle\n" +
        "The smoke test (npm run smoke) remains read-only.",
    );
    process.exitCode = 1;
    return;
  }

  const cfg = loadDemoConfig();
  const http = new FineractHttpClient();

  console.log("=".repeat(60));
  console.log("Sagitta Fineract Fixed Deposit Lifecycle Demo");
  console.log("=".repeat(60));
  console.log(`API:    ${http.config.baseUrl}`);
  console.log(`Tenant: ${http.config.tenantId}`);
  console.log();

  // ── 1. Reserve gate ─────────────────────────────────────────────────────
  console.log("── Step 1: Reserve capacity gate ──");

  const reserveGateSource = (process.env.RESERVE_GATE_SOURCE ?? "env").toLowerCase();
  let reserveAmountUsd = cfg.reserveAmountUsd;
  let onchainMeta: OnchainReserveResult | null = null;

  if (reserveGateSource === "onchain") {
    console.log("  Source: on-chain (RESERVE_GATE_SOURCE=onchain)");
    try {
      onchainMeta = await readOnchainReserve();
      reserveAmountUsd = onchainMeta.reserveAmountUsd;
      console.log(`  Contract:  ${onchainMeta.contract}`);
      console.log(`  Chain:     ${onchainMeta.chain} (id 5042002)`);
      console.log(`  Raw value: ${onchainMeta.rawValue} (uint256, ${onchainMeta.decimals} decimals)`);
      console.log(`  Read at:   ${onchainMeta.readAt}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n✗ On-chain reserve read FAILED — Fineract approval blocked.\n  ${message}`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log("  Source: env (RESERVE_GATE_SOURCE=env — demo mode)");
  }

  const gate: ReserveGateResult = checkReserveGate({
    reserveAmountUsd,
    fixedYieldApy: cfg.fixedYieldApy,
    termMonths: cfg.termMonths,
    coverageRatio: cfg.coverageRatio,
    requestedDepositAmountUsd: cfg.depositAmount,
  });
  console.log(`  Deposit requested:      $${gate.requestedDepositAmountUsd}`);
  console.log(`  Fixed yield APY:         ${(gate.fixedYieldApy * 100).toFixed(2)}%`);
  console.log(`  Term:                   ${gate.termMonths} months`);
  console.log(`  Promised yield:         $${gate.promisedYield}`);
  console.log(`  Coverage ratio:         ${gate.coverageRatio}x`);
  console.log(`  Required reserve:       $${gate.requiredReserve}`);
  console.log(`  Available reserve:      $${gate.reserveAmountUsd}${reserveGateSource === "onchain" ? " (on-chain)" : " (env)"}`);
  console.log(`  Max supported deposit:  $${gate.maxSupportedDepositAmountUsd}`);
  console.log(`  Gate decision:          ${gate.approved ? "✓ APPROVED" : "✗ REJECTED"}`);
  if (!gate.approved) {
    console.warn(
      `\n  WARNING: Reserve gate REJECTED (need $${gate.requiredReserve}, have $${gate.reserveAmountUsd}).\n` +
        "  Proceeding anyway for demo observability — the gate decision is recorded in the receipt.",
    );
  }
  console.log();

  // ── 2. Client ────────────────────────────────────────────────────────────
  console.log("── Step 2: Client ──");
  const { client, created: clientCreated } = await findOrCreateClient(http, cfg.clientName);
  console.log(
    `  ${clientCreated ? "Created" : "Found"} client: ${client.displayName} (id=${client.id})`,
  );
  const clientId = client.id!;
  console.log();

  // ── 3. Product ───────────────────────────────────────────────────────────
  console.log("── Step 3: Fixed deposit product ──");
  const { product, created: productCreated } = await findOrCreateProduct(http, cfg.fixedYieldApy);
  console.log(
    `  ${productCreated ? "Created" : "Found"} product: ${product.name} (id=${product.id})`,
  );
  const productId = product.id!;
  console.log();

  // ── 4. Account ───────────────────────────────────────────────────────────
  console.log("── Step 4: Fixed deposit account ──");
  const today = fineractDateStr();

  let account: FineractFixedDepositAccount;
  let statusBeforeApproval: string;
  let accountCreated = false;

  const inFlight = await findInFlightAccount(http, clientId, productId);
  if (inFlight?.id !== undefined) {
    account = await getFixedDepositAccount(inFlight.id, http);
    statusBeforeApproval = accountStatus(account);
    console.log(
      `  Found existing in-flight account id=${account.id}, status=${statusBeforeApproval}`,
    );
  } else {
    // Create a new FD account
    // depositPeriodFrequencyId: 2 = Months (confirmed from /fixeddepositaccounts/template)
    const result = await createFixedDepositAccount(
      {
        clientId,
        productId,
        depositAmount: cfg.depositAmount,
        depositPeriod: cfg.termMonths,
        depositPeriodFrequencyId: 2, // Months
        submittedOnDate: today,
        dateFormat: DATE_FORMAT,
        locale: LOCALE,
      },
      http,
    );
    account = await getFixedDepositAccount(result.resourceId!, http);
    statusBeforeApproval = accountStatus(account);
    accountCreated = true;
    console.log(`  Created FD account id=${account.id}, status=${statusBeforeApproval}`);
  }
  console.log();

  // ── 5. Approve ───────────────────────────────────────────────────────────
  console.log("── Step 5: Approve ──");
  let statusAfterApproval: string;
  if (statusBeforeApproval === "submitted") {
    await approveFixedDepositAccount(account.id!, isoDateStr(), http);
    account = await getFixedDepositAccount(account.id!, http);
    statusAfterApproval = accountStatus(account);
    console.log(`  Approved account id=${account.id}, status=${statusAfterApproval}`);
  } else {
    statusAfterApproval = statusBeforeApproval;
    console.log(`  Already past approval: status=${statusAfterApproval} — skipping`);
  }
  console.log();

  // ── 6. Activate ──────────────────────────────────────────────────────────
  console.log("── Step 6: Activate ──");
  let statusAfterActivation: string;
  if (statusAfterApproval === "approved") {
    await activateFixedDepositAccount(account.id!, isoDateStr(), http);
    account = await getFixedDepositAccount(account.id!, http);
    statusAfterActivation = accountStatus(account);
    console.log(`  Activated account id=${account.id}, status=${statusAfterActivation}`);
  } else if (statusAfterApproval === "active") {
    statusAfterActivation = "active";
    console.log("  Already active — skipping");
  } else {
    statusAfterActivation = statusAfterApproval;
    console.log(`  Unexpected status '${statusAfterApproval}' — skipping activation`);
  }
  console.log();

  // ── 7. Final account state ────────────────────────────────────────────────
  console.log("── Step 7: Final account state ──");
  const finalAccount = await getFixedDepositAccount(account.id!, http);
  const finalStatus = accountStatus(finalAccount);
  console.log(`  Final status: ${finalStatus}`);
  console.log(
    `  Maturity: ${JSON.stringify(finalAccount.maturityDate ?? finalAccount.maturityAmount)}`,
  );
  console.log();

  // ── 8. Sagitta mapping ───────────────────────────────────────────────────
  console.log("── Step 8: Sagitta term deposit mapping ──");
  const sagittaRecord = mapFixedDepositToSagittaTermDeposit(finalAccount);
  console.log(`  sagittaStatus: ${sagittaRecord.sagittaStatus}`);
  console.log(`  currency:      ${sagittaRecord.currency}`);
  console.log(`  principal:     ${sagittaRecord.principalAmount}`);
  console.log(`  interestRate:  ${sagittaRecord.interestRate}`);
  console.log(`  maturityDate:  ${sagittaRecord.maturityDate}`);
  console.log();

  // ── 9. Receipt ───────────────────────────────────────────────────────────
  console.log("── Step 9: Writing receipt ──");

  const receipt = {
    demoRunAt: new Date().toISOString(),
    fineractBaseUrl: http.config.baseUrl,
    fineractTenantId: http.config.tenantId,

    // Created / found resources
    fineractClientId: clientId,
    fineractClientName: client.displayName,
    clientCreated,
    fineractProductId: productId,
    fineractProductName: product.name,
    productCreated,
    fineractAccountId: account.id,
    accountCreated,

    // Lifecycle state trace
    accountStatusBeforeApproval: statusBeforeApproval,
    accountStatusAfterApproval: statusAfterApproval,
    accountStatusAfterActivation: statusAfterActivation,

    // Reserve gate — includes source metadata so the receipt is self-documenting
    reserveGate: {
      source: reserveGateSource === "onchain" ? "on-chain" as const : "env" as const,
      contract: onchainMeta?.contract ?? null,
      readAt: onchainMeta?.readAt ?? null,
      reserveAmountUsd: gate.reserveAmountUsd,
      requestedDepositAmountUsd: gate.requestedDepositAmountUsd,
      fixedYieldApy: gate.fixedYieldApy,
      termMonths: gate.termMonths,
      promisedYield: gate.promisedYield,
      requiredReserve: gate.requiredReserve,
      coverageRatio: gate.coverageRatio,
      maxSupportedDepositAmountUsd: gate.maxSupportedDepositAmountUsd,
      approved: gate.approved,
    },

    // Sagitta mapping
    sagittaTermDeposit: sagittaRecord,

    // Settlement evidence placeholder (production: write back via externalId / notes / datatable)
    settlementEvidence: SETTLEMENT_EVIDENCE_PLACEHOLDER,
  };

  await mkdir("out", { recursive: true });
  const receiptPath = "out/sagitta-fineract-fixed-deposit-demo.json";
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), "utf8");

  console.log(`  Receipt written to: ${receiptPath}`);
  console.log();
  console.log("=".repeat(60));
  console.log(`Lifecycle result: ${finalStatus === "active" ? "✓ PROVEN — account is active" : `? Final status is '${finalStatus}'`}`);
  console.log("=".repeat(60));

  if (finalStatus !== "active") {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLifecycle().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
