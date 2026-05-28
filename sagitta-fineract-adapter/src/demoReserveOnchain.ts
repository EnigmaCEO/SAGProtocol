/**
 * Standalone demo: read the Sagitta ReserveController on-chain and run the
 * reserve capacity gate — without touching Fineract at all.
 *
 * Requires:
 *   ARC_RPC_URL=https://rpc.testnet.arc.network   (or your local node)
 *   RESERVE_CONTROLLER_ADDRESS=0x23856AAcc3BCC07D25FDbc4D0aa54f6F6C5f78cd
 *
 * Optional gate tuning (same as demo:reserve-check):
 *   SAGITTA_TEST_DEPOSIT_AMOUNT=1000
 *   SAGITTA_TEST_FIXED_YIELD_APY=0.06
 *   SAGITTA_TEST_TERM_MONTHS=12
 *   SAGITTA_TEST_COVERAGE_RATIO=1.25
 *
 * Exits 0 if the gate approves, exits 1 if it rejects or the RPC call fails.
 *
 * Usage:
 *   npm run demo:reserve-onchain
 */

import "dotenv/config";
import { readOnchainReserve } from "./onchainReserve.js";
import { checkReserveGate } from "./reserveGate.js";

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

async function main(): Promise<void> {
  console.log("=".repeat(56));
  console.log("Sagitta On-Chain Reserve Gate Demo");
  console.log("=".repeat(56));

  // ── 1. Read reserve from chain ──────────────────────────────────────────
  console.log("\n── Step 1: Reading navReserveUsd() from ReserveController ──");
  let onchain;
  try {
    onchain = await readOnchainReserve();
  } catch (err) {
    console.error("\n✗ On-chain read failed:");
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  console.log(`  RPC:          ${process.env.ARC_RPC_URL}`);
  console.log(`  Contract:     ${onchain.contract}`);
  console.log(`  Chain:        ${onchain.chain} (id 5042002)`);
  console.log(`  Raw value:    ${onchain.rawValue} (uint256)`);
  console.log(`  Decimals:     ${onchain.decimals}`);
  console.log(`  reserveUsd:   $${onchain.reserveAmountUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  console.log(`  Read at:      ${onchain.readAt}`);

  // ── 2. Run reserve gate formula ─────────────────────────────────────────
  console.log("\n── Step 2: Reserve capacity gate ──");
  const gateInput = {
    reserveAmountUsd: onchain.reserveAmountUsd,
    fixedYieldApy: envFloat("SAGITTA_TEST_FIXED_YIELD_APY", 0.06),
    termMonths: envInt("SAGITTA_TEST_TERM_MONTHS", 12),
    coverageRatio: envFloat("SAGITTA_TEST_COVERAGE_RATIO", 1.25),
    requestedDepositAmountUsd: envFloat("SAGITTA_TEST_DEPOSIT_AMOUNT", 1000),
  };

  const result = checkReserveGate(gateInput);

  console.log(`  Deposit requested:      $${result.requestedDepositAmountUsd}`);
  console.log(`  Fixed yield APY:         ${(result.fixedYieldApy * 100).toFixed(2)}%`);
  console.log(`  Term:                   ${result.termMonths} months`);
  console.log(`  Promised yield:         $${result.promisedYield}`);
  console.log(`  Coverage ratio:         ${result.coverageRatio}x`);
  console.log(`  Required reserve:       $${result.requiredReserve}`);
  console.log(`  Available reserve:      $${result.reserveAmountUsd} (on-chain)`);
  console.log(`  Max supported deposit:  $${result.maxSupportedDepositAmountUsd}`);

  console.log("\n" + "─".repeat(56));
  console.log(`Decision: ${result.approved ? "✓ APPROVED" : "✗ REJECTED"}`);
  console.log(`Source:   on-chain — ${onchain.contract}`);
  console.log("─".repeat(56) + "\n");

  console.log(
    JSON.stringify(
      {
        source: onchain.source,
        chain: onchain.chain,
        contract: onchain.contract,
        rawValue: onchain.rawValue,
        decimals: onchain.decimals,
        reserveAmountUsd: onchain.reserveAmountUsd,
        readAt: onchain.readAt,
        gate: {
          requestedDepositAmountUsd: result.requestedDepositAmountUsd,
          fixedYieldApy: result.fixedYieldApy,
          termMonths: result.termMonths,
          promisedYield: result.promisedYield,
          requiredReserve: result.requiredReserve,
          coverageRatio: result.coverageRatio,
          maxSupportedDepositAmountUsd: result.maxSupportedDepositAmountUsd,
          approved: result.approved,
        },
      },
      null,
      2,
    ),
  );

  if (!result.approved) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
