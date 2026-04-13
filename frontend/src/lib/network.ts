/**
 * Centralised network configuration.
 *
 * Set these in .env.local (dev) or Vercel environment variables (prod):
 *   NEXT_PUBLIC_RPC_URL   – JSON-RPC endpoint
 *   NEXT_PUBLIC_CHAIN_ID  – numeric chain ID (1337 = localhost, 1287 = Moonbase Alpha)
 *
 * Defaults to localhost when variables are absent.
 */

export const RPC_URL: string =
  process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8545";

export const CHAIN_ID: number = parseInt(
  process.env.NEXT_PUBLIC_CHAIN_ID || "1337",
  10
);

/** True only for local Hardhat/Anvil chains that support evm_mine / evm_increaseTime. */
export const IS_LOCAL_CHAIN: boolean = CHAIN_ID === 1337 || CHAIN_ID === 31337;

/** viem-compatible chain object derived from env vars. */
export const ACTIVE_CHAIN = {
  id: CHAIN_ID,
  name: IS_LOCAL_CHAIN ? `Localhost ${CHAIN_ID}` : "Moonbase Alpha",
  nativeCurrency: IS_LOCAL_CHAIN
    ? { name: "Ether", symbol: "ETH", decimals: 18 }
    : { name: "DEV", symbol: "DEV", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
} as const;
