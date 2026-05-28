/**
 * Committed reserve tracker for Sagitta-backed fixed deposits.
 *
 * "Committed reserve" is the portion of the on-chain NAV reserve that has
 * already been earmarked to cover the promised yield on active Sagitta FDs.
 * Before approving a new deposit the gate must prove:
 *
 *   availableReserveUsd = navReserveUsd - committedReserveUsd
 *   availableReserveUsd ≥ requiredReserveUsd (for the new deposit)
 *
 * Per-deposit required reserve formula (mirrors reserveGate.ts):
 *
 *   requiredReserveUsd = principalAmountUsd
 *                        × fixedYieldApy
 *                        × (termMonths / 12)
 *                        × coverageRatio
 *
 * Data sources (in priority order):
 *   1. COMMITTED_RESERVE_REGISTRY env var — absolute path to a JSON registry file.
 *   2. out/sagitta-active-deposits-registry.json  — default local registry.
 *   3. out/sagitta-fineract-fixed-deposit-demo.json — legacy receipt fallback
 *      (single deposit; used when no registry file exists yet).
 *
 * Fail-closed: if the registry cannot be read or parsed, this module throws.
 * The caller is responsible for blocking the Fineract approval.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Registry entry — what lives in sagitta-active-deposits-registry.json
// ---------------------------------------------------------------------------

export interface DepositRegistryEntry {
  /** Sagitta-internal identifier, e.g. "sagitta-fd-1". */
  sagittaTermDepositId: string;
  /** Apache Fineract fixed deposit account id. */
  fineractAccountId: number;
  /** Deposit principal in USD. */
  principalAmountUsd: number;
  /** Fixed annual yield promised to depositor (decimal, e.g. 0.06 = 6 %). */
  fixedYieldApy: number;
  /** Deposit term in months. */
  termMonths: number;
  /** Reserve-to-promised-yield coverage ratio (e.g. 1.25 = 125 %). */
  coverageRatio: number;
  /**
   * Current status of the deposit. Only "active" and "approved_not_active"
   * entries are counted toward committed reserve; all others are skipped.
   */
  status: string;
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** Per-commitment detail row returned by readCommittedReserve(). */
export interface ActiveDepositCommitment {
  sagittaTermDepositId: string;
  fineractAccountId: number;
  principalAmountUsd: number;
  fixedYieldApy: number;
  termMonths: number;
  coverageRatio: number;
  requiredReserveUsd: number;
  status: string;
}

/** Aggregated committed reserve result. */
export interface CommittedReserveResult {
  /** Number of active/approved deposits counted. */
  activeDepositCount: number;
  /** Total USD reserve already committed to active deposits. */
  committedReserveUsd: number;
  /** Per-deposit breakdown. */
  commitments: ActiveDepositCommitment[];
}

// ---------------------------------------------------------------------------
// Statuses that count as "active" for reserve purposes
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(["active", "approved_not_active"]);

function isActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status.toLowerCase().trim());
}

// ---------------------------------------------------------------------------
// Per-deposit reserve formula
// ---------------------------------------------------------------------------

function computeRequiredReserve(
  principalAmountUsd: number,
  fixedYieldApy: number,
  termMonths: number,
  coverageRatio: number,
): number {
  const raw = principalAmountUsd * fixedYieldApy * (termMonths / 12) * coverageRatio;
  return Math.round(raw * 100) / 100;
}

// ---------------------------------------------------------------------------
// Registry loading helpers
// ---------------------------------------------------------------------------

/** Default paths relative to the current working directory. */
const DEFAULT_REGISTRY_PATH = "out/sagitta-active-deposits-registry.json";
const LEGACY_RECEIPT_PATH = "out/sagitta-fineract-fixed-deposit-demo.json";

/**
 * Parse the JSON registry file and return an array of entries.
 * Throws a descriptive error if the file is missing or malformed.
 */
async function loadRegistryFile(path: string): Promise<DepositRegistryEntry[]> {
  const absPath = resolve(path);
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `committedReserve: cannot read registry file at ${absPath}:\n  ${message}\n` +
        "Fineract approval is blocked until the registry is readable.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `committedReserve: registry file at ${absPath} is not valid JSON:\n  ${message}\n` +
        "Fineract approval is blocked until the registry is valid.",
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `committedReserve: registry file at ${absPath} must be a JSON array of deposit entries.\n` +
        "Fineract approval is blocked until the registry is valid.",
    );
  }

  return parsed as DepositRegistryEntry[];
}

/**
 * Legacy fallback: read a single deposit from the FD lifecycle receipt and
 * derive a DepositRegistryEntry from it.
 *
 * This handles the case where the new registry file does not yet exist and the
 * operator has run demo:fd-lifecycle but not yet created the registry.
 */
async function loadLegacyReceipt(path: string): Promise<DepositRegistryEntry[]> {
  const absPath = resolve(path);
  let raw: string;
  try {
    raw = await readFile(absPath, "utf8");
  } catch {
    // If neither file exists, treat as zero committed deposits (first-ever deposit).
    return [];
  }

  let receipt: Record<string, unknown>;
  try {
    receipt = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `committedReserve: legacy receipt at ${absPath} is not valid JSON:\n  ${message}`,
    );
  }

  const td = receipt["sagittaTermDeposit"] as Record<string, unknown> | undefined;
  const gate = receipt["reserveGate"] as Record<string, unknown> | undefined;

  if (!td || typeof td !== "object") {
    // Receipt exists but has no deposit record — treat as zero.
    return [];
  }

  const sagittaStatus = typeof td["sagittaStatus"] === "string" ? td["sagittaStatus"] : "unknown";
  if (!isActive(sagittaStatus)) {
    return [];
  }

  const principal = typeof td["principalAmount"] === "number" ? td["principalAmount"] : null;
  const termVal =
    td["depositTerm"] &&
    typeof (td["depositTerm"] as Record<string, unknown>)["value"] === "number"
      ? (td["depositTerm"] as Record<string, unknown>)["value"]
      : null;
  const interestRate =
    typeof td["interestRate"] === "number" ? td["interestRate"] : null;
  const fineractAccountId =
    typeof td["fineractAccountId"] === "number" ? td["fineractAccountId"] : null;
  const coverageRatio =
    gate && typeof gate["coverageRatio"] === "number" ? gate["coverageRatio"] : 1.25;

  if (
    principal === null ||
    termVal === null ||
    interestRate === null ||
    fineractAccountId === null
  ) {
    throw new Error(
      `committedReserve: legacy receipt at ${absPath} is missing required fields ` +
        "(principalAmount, depositTerm.value, interestRate, fineractAccountId).\n" +
        "Fineract approval is blocked until the receipt is valid.",
    );
  }

  return [
    {
      sagittaTermDepositId: `sagitta-fd-${fineractAccountId as number}`,
      fineractAccountId: fineractAccountId as number,
      principalAmountUsd: principal as number,
      fixedYieldApy: (interestRate as number) / 100,
      termMonths: termVal as number,
      coverageRatio: coverageRatio as number,
      status: sagittaStatus,
    },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CommittedReserveOptions {
  /**
   * Absolute or relative path to the deposit registry JSON file.
   * Overridden by COMMITTED_RESERVE_REGISTRY env var if set.
   * Defaults to out/sagitta-active-deposits-registry.json.
   */
  registryPath?: string;
}

/**
 * Read committed reserve from the active deposit registry.
 *
 * Throws (fail-closed) if the registry exists but cannot be read or parsed.
 * Returns zero committed reserve if no registry file exists and the legacy
 * receipt also doesn't exist (first-ever deposit scenario).
 */
export async function readCommittedReserve(
  options: CommittedReserveOptions = {},
): Promise<CommittedReserveResult> {
  // Resolve registry path — env var wins, then options, then default.
  const envPath = (process.env.COMMITTED_RESERVE_REGISTRY ?? "").trim();
  const registryPath = envPath || options.registryPath || DEFAULT_REGISTRY_PATH;

  let entries: DepositRegistryEntry[];

  if (existsSync(resolve(registryPath))) {
    // Primary path: load the explicit registry file.
    entries = await loadRegistryFile(registryPath);
  } else {
    // Fallback: derive from the legacy lifecycle receipt.
    entries = await loadLegacyReceipt(LEGACY_RECEIPT_PATH);
  }

  // Filter to active/approved deposits only.
  const active = entries.filter((e) => isActive(e.status));

  // Compute per-deposit committed reserve and total.
  const commitments: ActiveDepositCommitment[] = active.map((e) => ({
    sagittaTermDepositId: e.sagittaTermDepositId,
    fineractAccountId: e.fineractAccountId,
    principalAmountUsd: e.principalAmountUsd,
    fixedYieldApy: e.fixedYieldApy,
    termMonths: e.termMonths,
    coverageRatio: e.coverageRatio,
    requiredReserveUsd: computeRequiredReserve(
      e.principalAmountUsd,
      e.fixedYieldApy,
      e.termMonths,
      e.coverageRatio,
    ),
    status: e.status,
  }));

  const committedReserveUsd = Math.round(
    commitments.reduce((sum, c) => sum + c.requiredReserveUsd, 0) * 100,
  ) / 100;

  return {
    activeDepositCount: commitments.length,
    committedReserveUsd,
    commitments,
  };
}
