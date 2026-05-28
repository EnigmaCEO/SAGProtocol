/**
 * On-chain reserve reader for the Sagitta ReserveController.
 *
 * Calls navReserveUsd() on the deployed ReserveController contract and returns
 * the result normalised to a USD float.
 *
 * ABI source: frontend/src/lib/abis/ReserveController.json (confirmed 2026-05-27)
 * Decimals:   6  (confirmed from useVaultData.ts: ethers.formatUnits(navReserve, 6))
 * Arc chain:  5042002 — https://rpc.testnet.arc.network
 *
 * Environment variables consumed:
 *   ARC_RPC_URL                  — JSON-RPC endpoint (required when called)
 *   RESERVE_CONTROLLER_ADDRESS   — override the contract address (optional;
 *                                  defaults to the Arc mainnet deployment)
 *
 * This module never falls back silently. If the RPC URL is missing or the call
 * fails it throws — the caller is responsible for deciding whether to proceed.
 */

import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// ABI — minimal subset; only the view function we need.
// Full ABI lives in frontend/src/lib/abis/ReserveController.json.
// ---------------------------------------------------------------------------

const RESERVE_CONTROLLER_ABI = [
  {
    inputs: [],
    name: "navReserveUsd",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Arc mainnet deployment address — matches deployments/arc.json. */
const ARC_RESERVE_CONTROLLER = "0x23856AAcc3BCC07D25FDbc4D0aa54f6F6C5f78cd";

/**
 * navReserveUsd() returns a uint256 with 6 decimal places (USDC-like).
 * Confirmed from useVaultData.ts: ethers.formatUnits(navReserve, 6)
 */
const NAV_RESERVE_DECIMALS = 6;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface OnchainReserveResult {
  /** Always "on-chain" — disambiguates from env-sourced reserve values. */
  source: "on-chain";
  /** Chain identifier. */
  chain: "arc";
  /** Contract address that was queried. */
  contract: string;
  /** Reserve amount in USD as a plain number (decimals already applied). */
  reserveAmountUsd: number;
  /** Raw uint256 value returned by navReserveUsd(), as a decimal string. */
  rawValue: string;
  /** Number of decimal places used to normalise rawValue → reserveAmountUsd. */
  decimals: number;
  /** ISO-8601 timestamp of when the read was performed. */
  readAt: string;
  /** Always false — this is a view call with no state mutation. */
  txRequired: false;
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Read the current NAV reserve USD value from the on-chain ReserveController.
 *
 * Throws if:
 *   - ARC_RPC_URL is not set
 *   - The RPC call fails for any reason (network error, wrong chain, etc.)
 *
 * Never falls back silently to an env value.
 */
export async function readOnchainReserve(): Promise<OnchainReserveResult> {
  const rpcUrl = process.env.ARC_RPC_URL;
  if (!rpcUrl || rpcUrl.trim() === "") {
    throw new Error(
      "ARC_RPC_URL is not set. " +
        "Set it in .env to the Arc JSON-RPC endpoint, e.g.:\n" +
        "  ARC_RPC_URL=https://rpc.testnet.arc.network",
    );
  }

  const contractAddress =
    (process.env.RESERVE_CONTROLLER_ADDRESS ?? "").trim() || ARC_RESERVE_CONTROLLER;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, RESERVE_CONTROLLER_ABI, provider);

  let rawBigInt: bigint;
  try {
    // Use getFunction() for type-safe ethers v6 contract calls under noUncheckedIndexedAccess.
    rawBigInt = (await contract.getFunction("navReserveUsd")()) as bigint;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ReserveController.navReserveUsd() call failed on ${rpcUrl} ` +
        `(contract: ${contractAddress}):\n  ${message}\n` +
        "Fineract approval is blocked. Fix the RPC connection or set RESERVE_GATE_SOURCE=env " +
        "to fall back to the local demo reserve.",
    );
  }

  const reserveAmountUsd = parseFloat(
    ethers.formatUnits(rawBigInt, NAV_RESERVE_DECIMALS),
  );

  return {
    source: "on-chain",
    chain: "arc",
    contract: contractAddress,
    reserveAmountUsd,
    rawValue: rawBigInt.toString(),
    decimals: NAV_RESERVE_DECIMALS,
    readAt: new Date().toISOString(),
    txRequired: false,
  };
}
