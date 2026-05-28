/**
 * Standalone demo: committed-reserve-aware available reserve gate.
 *
 * Extends demo:reserve-onchain by subtracting the committed reserve (sum of
 * required reserves for existing active Sagitta FDs) from the on-chain NAV
 * reserve before running the gate.
 *
 *   navReserveUsd       — read from ReserveController.navReserveUsd() on Arc,
 *                         or from SAGITTA_TEST_RESERVE_AMOUNT in env mode.
 *   committedReserveUsd — computed from out/sagitta-active-deposits-registry.json
 *                         (falls back to out/sagitta-fineract-fixed-deposit-demo.json).
 *   availableReserveUsd = navReserveUsd - committedReserveUsd
 *   approved            = availableReserveUsd ≥ requiredReserveUsd
 *
 * Fail-closed:
 *   - If committed reserve cannot be calculated, the demo exits 1 (no approval).
 *   - If RESERVE_GATE_SOURCE=onchain and the RPC call fails, the demo exits 1.
 *
 * Configuration:
 *   RESERVE_GATE_SOURCE=env|onchain    (default: env)
 *   SAGITTA_TEST_RESERVE_AMOUNT        (env mode: navReserveUsd, default 500000)
 *   SAGITTA_TEST_DEPOSIT_AMOUNT        (new deposit amount, default 1000)
 *   SAGITTA_TEST_FIXED_YIELD_APY       (default 0.06)
 *   SAGITTA_TEST_TERM_MONTHS           (default 12)
 *   SAGITTA_TEST_COVERAGE_RATIO        (default 1.25)
 *   COMMITTED_RESERVE_REGISTRY         (path override for registry JSON)
 *   ARC_RPC_URL                        (required when RESERVE_GATE_SOURCE=onchain)
 *   RESERVE_CONTROLLER_ADDRESS         (optional override, Arc default)
 *
 * Receipt written to: out/sagitta-reserve-available-receipt.json
 *
 * Usage:
 *   npm run demo:reserve-available
 *   SAGITTA_TEST_DEPOSIT_AMOUNT=5000 npm run demo:reserve-available
 *   RESERVE_GATE_SOURCE=onchain npm run demo:reserve-available
 */

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { readOnchainReserve } from "./onchainReserve.js";
import { readCommittedReserve, type CommittedReserveResult } from "./committedReserve.js";
import { checkReserveGate } from "./reserveGate.js";

// ---------------------------------------------------------------------------
// Config helpers
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

function usd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Sagitta Available Reserve Gate Demo");
  console.log("=".repeat(60));
  console.log();

  const reserveGateSource = (process.env.RESERVE_GATE_SOURCE ?? "env").toLowerCase();
  const fixedYieldApy = envFloat("SAGITTA_TEST_FIXED_YIELD_APY", 0.06);
  const termMonths = envInt("SAGITTA_TEST_TERM_MONTHS", 12);
  const coverageRatio = envFloat("SAGITTA_TEST_COVERAGE_RATIO", 1.25);
  const requestedDepositAmountUsd = envFloat("SAGITTA_TEST_DEPOSIT_AMOUNT", 1000);

  // ── Step 1: Total NAV reserve ─────────────────────────────────────────────
  console.log("── Step 1: Total on-chain NAV reserve ──");

  let navReserveUsd: number;
  let onchainMeta: Awaited<ReturnType<typeof readOnchainReserve>> | null = null;

  if (reserveGateSource === "onchain") {
    console.log("  Source: on-chain (RESERVE_GATE_SOURCE=onchain)");
    try {
      onchainMeta = await readOnchainReserve();
      navReserveUsd = onchainMeta.reserveAmountUsd;
      console.log(`  RPC:         ${process.env.ARC_RPC_URL}`);
      console.log(`  Contract:    ${onchainMeta.contract}`);
      console.log(`  Chain:       ${onchainMeta.chain} (id 5042002)`);
      console.log(`  Raw value:   ${onchainMeta.rawValue} (uint256, ${onchainMeta.decimals} decimals)`);
      console.log(`  Read at:     ${onchainMeta.readAt}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n✗ On-chain reserve read FAILED — approval blocked.\n  ${message}`);
      process.exitCode = 1;
      return;
    }
  } else {
    // env mode: default to $500,000 to match normalised on-chain demo value
    navReserveUsd = envFloat("SAGITTA_TEST_RESERVE_AMOUNT", 500_000);
    console.log(`  Source: env (RESERVE_GATE_SOURCE=env — demo mode)`);
    console.log(`  navReserveUsd = $${usd(navReserveUsd)}`);
  }
  console.log(`  navReserveUsd:       $${usd(navReserveUsd)}`);
  console.log();

  // ── Step 2: Committed reserve ─────────────────────────────────────────────
  console.log("── Step 2: Committed reserve (active FD registry) ──");

  let committed: CommittedReserveResult;
  try {
    committed = await readCommittedReserve();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Committed reserve read FAILED — approval blocked.\n  ${message}`);
    process.exitCode = 1;
    return;
  }

  if (committed.activeDepositCount === 0) {
    console.log("  No active deposits found — committedReserveUsd = $0.00");
  } else {
    console.log(`  Active deposits:     ${committed.activeDepositCount}`);
    committed.commitments.forEach((c, i) => {
      console.log(
        `  [${i + 1}] ${c.sagittaTermDepositId}  ` +
          `FD#${c.fineractAccountId}  ` +
          `$${usd(c.principalAmountUsd)} × ${(c.fixedYieldApy * 100).toFixed(2)}% × ` +
          `${c.termMonths}mo × ${c.coverageRatio}x = $${usd(c.requiredReserveUsd)}`,
      );
    });
    console.log(`  committedReserveUsd: $${usd(committed.committedReserveUsd)}`);
  }
  console.log();

  // ── Step 3: Available reserve ─────────────────────────────────────────────
  console.log("── Step 3: Available reserve ──");
  const availableReserveUsd = Math.round((navReserveUsd - committed.committedReserveUsd) * 100) / 100;
  console.log(`  navReserveUsd:       $${usd(navReserveUsd)}`);
  console.log(`  committedReserveUsd: $${usd(committed.committedReserveUsd)}`);
  console.log(`  availableReserveUsd: $${usd(availableReserveUsd)}`);
  console.log();

  // ── Step 4: Gate check (new deposit against available reserve) ────────────
  console.log("── Step 4: Reserve gate (new deposit vs available reserve) ──");
  const gate = checkReserveGate({
    reserveAmountUsd: navReserveUsd,
    availableReserveUsd,
    fixedYieldApy,
    termMonths,
    coverageRatio,
    requestedDepositAmountUsd,
  });

  console.log(`  Deposit requested:   $${usd(gate.requestedDepositAmountUsd)}`);
  console.log(`  Fixed yield APY:      ${(gate.fixedYieldApy * 100).toFixed(2)}%`);
  console.log(`  Term:                ${gate.termMonths} months`);
  console.log(`  Coverage ratio:      ${gate.coverageRatio}x`);
  console.log(`  Promised yield:      $${usd(gate.promisedYield)}`);
  console.log(`  Required reserve:    $${usd(gate.requiredReserveUsd)}`);
  console.log(`  Available reserve:   $${usd(gate.availableReserveUsd)}`);
  console.log(`  Max deposit (avail): $${usd(gate.maxSupportedDepositAmountUsd)}`);
  console.log();

  console.log("─".repeat(60));
  console.log(`Decision: ${gate.approved ? "✓ APPROVED" : "✗ REJECTED"}`);
  if (!gate.approved) {
    console.log(
      `  Need $${usd(gate.requiredReserveUsd)} available, ` +
        `but only $${usd(gate.availableReserveUsd)} is free ` +
        `($${usd(committed.committedReserveUsd)} is committed to active deposits).`,
    );
  }
  console.log("─".repeat(60));
  console.log();

  // ── Step 5: Write receipt ─────────────────────────────────────────────────
  const receiptPath = "out/sagitta-reserve-available-receipt.json";

  const receipt = {
    demoRunAt: new Date().toISOString(),
    reserveGateSource,
    // On-chain metadata (null in env mode)
    onchainRead: onchainMeta
      ? {
          source: onchainMeta.source,
          chain: onchainMeta.chain,
          contract: onchainMeta.contract,
          rawValue: onchainMeta.rawValue,
          decimals: onchainMeta.decimals,
          readAt: onchainMeta.readAt,
        }
      : null,
    // Reserve accounting
    reserveAccounting: {
      navReserveUsd,
      committedReserveUsd: committed.committedReserveUsd,
      availableReserveUsd,
      activeDepositCount: committed.activeDepositCount,
      commitments: committed.commitments,
    },
    // Gate result (new deposit shape)
    reserveGate: {
      navReserveUsd,
      committedReserveUsd: committed.committedReserveUsd,
      availableReserveUsd,
      requestedDepositAmountUsd: gate.requestedDepositAmountUsd,
      requiredReserveUsd: gate.requiredReserveUsd,
      approved: gate.approved,
    },
    // Gate detail (full formula breakdown)
    reserveGateDetail: {
      fixedYieldApy: gate.fixedYieldApy,
      termMonths: gate.termMonths,
      coverageRatio: gate.coverageRatio,
      promisedYield: gate.promisedYield,
      maxSupportedDepositAmountUsd: gate.maxSupportedDepositAmountUsd,
    },
  };

  await mkdir("out", { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), "utf8");
  console.log(`Receipt written to: ${receiptPath}`);
  console.log();
  console.log(JSON.stringify(receipt.reserveGate, null, 2));

  if (!gate.approved) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
