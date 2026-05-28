/**
 * Standalone demo: run the Sagitta reserve capacity gate without touching Fineract.
 *
 * Reads all config from environment variables (or .env).
 * Exits 0 if the gate approves, exits 1 if it rejects.
 *
 * Usage:
 *   npm run demo:reserve-check
 *   SAGITTA_TEST_DEPOSIT_AMOUNT=5000 npm run demo:reserve-check
 */

import "dotenv/config";
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

function main(): void {
  const input = {
    reserveAmountUsd: envFloat("SAGITTA_TEST_RESERVE_AMOUNT", 100),
    fixedYieldApy: envFloat("SAGITTA_TEST_FIXED_YIELD_APY", 0.06),
    termMonths: envInt("SAGITTA_TEST_TERM_MONTHS", 12),
    coverageRatio: envFloat("SAGITTA_TEST_COVERAGE_RATIO", 1.25),
    requestedDepositAmountUsd: envFloat("SAGITTA_TEST_DEPOSIT_AMOUNT", 1000),
  };

  const result = checkReserveGate(input);

  console.log("Sagitta Reserve Capacity Gate");
  console.log("─".repeat(44));
  console.log(`Deposit requested:      $${result.requestedDepositAmountUsd}`);
  console.log(`Fixed yield APY:         ${(result.fixedYieldApy * 100).toFixed(2)}%`);
  console.log(`Term:                   ${result.termMonths} months`);
  console.log(`Promised yield:         $${result.promisedYield}`);
  console.log(`Coverage ratio:         ${result.coverageRatio}x`);
  console.log(`Required reserve:       $${result.requiredReserve}`);
  console.log(`Available reserve:      $${result.reserveAmountUsd}`);
  console.log(`Max supported deposit:  $${result.maxSupportedDepositAmountUsd}`);
  console.log("─".repeat(44));
  console.log(`Decision: ${result.approved ? "✓ APPROVED" : "✗ REJECTED"}`);
  console.log();
  console.log(JSON.stringify(result, null, 2));

  if (!result.approved) {
    process.exitCode = 1;
  }
}

main();
