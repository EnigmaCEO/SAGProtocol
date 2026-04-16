import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "./addresses";
import { IS_LOCAL_CHAIN, RPC_URL } from "./network";

// ---------------------------------------------------------------------------
// ProtocolDAO bootstrap address.
//
// On non-local chains the ProtocolDAO address is the single address the
// frontend needs at build time. Everything else is fetched from it at runtime.
//
// Resolution order:
//   1. NEXT_PUBLIC_PROTOCOL_DAO_ADDRESS env var  (set in Vercel / .env.local)
//   2. addresses.ts fallback (auto-generated, not committed for non-local)
// ---------------------------------------------------------------------------
const ENV_PROTOCOL_DAO =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_PROTOCOL_DAO_ADDRESS ?? "")
    : "";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type RuntimeAddressKey =
  | "ProtocolDAO"
  | "Vault"
  | "Treasury"
  | "InvestmentEscrow"
  | "ReserveController"
  | "GoldOracle"
  | "UsdcOracle"
  | "MockUSDC"
  | "ReceiptNFT"
  | "PortfolioRegistry";

const STORAGE_PREFIX = "sagitta.runtimeAddress.";
const GENERATED_SIGNATURE_KEY = `${STORAGE_PREFIX}generatedSignature`;
const GENERATED_CHAIN_KEY = `${STORAGE_PREFIX}generatedChainId`;
const ADDRESSES_UPDATED_EVENT = "sagitta:addresses-updated";

const MANAGED_KEYS: RuntimeAddressKey[] = [
  "ProtocolDAO",
  "Vault",
  "Treasury",
  "InvestmentEscrow",
  "ReserveController",
  "GoldOracle",
  "UsdcOracle",
  "MockUSDC",
  "ReceiptNFT",
  "PortfolioRegistry",
];

// ---------------------------------------------------------------------------
// On-chain address cache — non-local chains only.
//
// On testnet / mainnet, the ProtocolDAO contract is the single source of truth
// for all protocol contract addresses. We fetch them once per session and cache
// them here so every getRuntimeAddress() call is synchronous after init.
// ---------------------------------------------------------------------------

const PROTOCOL_DAO_ABI = [
  "function getAllAddresses() external view returns (string[] memory keys, address[] memory addrs)",
];

let _onChainCache: Map<string, string> | null = null;
let _onChainFetchPromise: Promise<void> | null = null;

async function _fetchOnChainAddresses(): Promise<void> {
  const daoAddress = (CONTRACT_ADDRESSES as any)?.ProtocolDAO as string | undefined;
  if (!isValidAddress(daoAddress)) return;

  try {
    const eth = typeof window !== "undefined" ? (window as any).ethereum : null;
    const provider = eth
      ? new ethers.BrowserProvider(eth)
      : new ethers.JsonRpcProvider(RPC_URL);

    const dao = new ethers.Contract(daoAddress, PROTOCOL_DAO_ABI, provider);
    const [keys, addrs]: [string[], string[]] = await dao.getAllAddresses();

    const cache = new Map<string, string>();
    for (let i = 0; i < keys.length; i++) {
      if (isValidAddress(addrs[i])) cache.set(keys[i], addrs[i]);
    }
    _onChainCache = cache;

    // Notify all useRuntimeAddress hooks that on-chain data is available.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
    }
  } catch (e) {
    console.warn("ProtocolDAO address fetch failed, using build-time addresses:", e);
  }
}

/**
 * Trigger the one-time fetch of all addresses from ProtocolDAO.
 * Safe to call multiple times — only one fetch is ever in-flight.
 * No-op on local chains (uses localStorage / addresses.ts instead).
 */
export function initOnChainAddresses(): void {
  if (IS_LOCAL_CHAIN || typeof window === "undefined") return;
  if (_onChainFetchPromise) return;
  _onChainFetchPromise = _fetchOnChainAddresses();
}

// ---------------------------------------------------------------------------
// localStorage-backed overrides — LOCAL DEV ONLY
// ---------------------------------------------------------------------------

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

export function isValidAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function getDefaultAddress(key: RuntimeAddressKey): string {
  // Env var takes precedence for ProtocolDAO — the one address that must be
  // known at build time so everything else can be fetched from chain.
  if (key === "ProtocolDAO" && isValidAddress(ENV_PROTOCOL_DAO)) return ENV_PROTOCOL_DAO;
  const raw = (CONTRACT_ADDRESSES as any)?.[key];
  return isValidAddress(raw) ? raw : ZERO_ADDRESS;
}

function getGeneratedAddressSignature(): string {
  const snapshot: Record<string, string | number | null> = {
    network: (CONTRACT_ADDRESSES as any)?.network ?? null,
    chainId: Number((CONTRACT_ADDRESSES as any)?.chainId ?? 0),
  };
  for (const key of MANAGED_KEYS) {
    snapshot[key] = getDefaultAddress(key).toLowerCase();
  }
  return JSON.stringify(snapshot);
}

function syncRuntimeAddressBookIfNeeded(force = false): void {
  if (typeof window === "undefined") return;

  const nextSignature = getGeneratedAddressSignature();
  const currentSignature = window.localStorage.getItem(GENERATED_SIGNATURE_KEY);

  if (!force && currentSignature === nextSignature) return;

  const generatedChainId = Number((CONTRACT_ADDRESSES as any)?.chainId ?? 0);
  const storedChainId = Number(window.localStorage.getItem(GENERATED_CHAIN_KEY) ?? 0);

  if (!force && storedChainId !== 0 && storedChainId !== generatedChainId) {
    return;
  }

  for (const key of MANAGED_KEYS) {
    const defaultAddress = getDefaultAddress(key);
    const storageKey = `${STORAGE_PREFIX}${key}`;
    if (isValidAddress(defaultAddress) && !isZeroAddress(defaultAddress)) {
      window.localStorage.setItem(storageKey, defaultAddress);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  }

  window.localStorage.setItem(GENERATED_CHAIN_KEY, String(generatedChainId));
  window.localStorage.setItem(GENERATED_SIGNATURE_KEY, nextSignature);

  window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
}

export function loadGeneratedRuntimeAddresses(): void {
  if (!IS_LOCAL_CHAIN || typeof window === "undefined") return;
  syncRuntimeAddressBookIfNeeded(true);
}

/**
 * Returns the active contract address for the given key.
 *
 * Priority (non-local chains):
 *   1. ProtocolDAO on-chain cache (fetched async via initOnChainAddresses)
 *   2. Build-time addresses.ts value
 *
 * Priority (local chains):
 *   1. localStorage override
 *   2. addresses.ts value
 */
export function getRuntimeAddress(key: RuntimeAddressKey): string {
  if (!IS_LOCAL_CHAIN) {
    // Return on-chain value if the async cache is already populated.
    if (_onChainCache?.has(key)) return _onChainCache.get(key)!;
    return getDefaultAddress(key);
  }
  if (typeof window === "undefined") return getDefaultAddress(key);
  syncRuntimeAddressBookIfNeeded();
  const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  if (isValidAddress(stored)) return stored;
  return getDefaultAddress(key);
}

export function setRuntimeAddress(key: RuntimeAddressKey, address: string): boolean {
  if (!IS_LOCAL_CHAIN) return false;
  if (!isValidAddress(address)) return false;
  if (typeof window === "undefined") return false;
  syncRuntimeAddressBookIfNeeded();
  window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, address);
  window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
  return true;
}

export function markRuntimeChainId(chainId: number): void {
  if (!IS_LOCAL_CHAIN || typeof window === "undefined") return;
  window.localStorage.setItem(GENERATED_CHAIN_KEY, String(chainId));
}

/**
 * React hook — returns the current address for the given key and re-renders
 * when the on-chain cache populates or localStorage changes.
 */
export function useRuntimeAddress(key: RuntimeAddressKey): string {
  const [address, setAddress] = useState<string>(() => getRuntimeAddress(key));

  useEffect(() => {
    if (!IS_LOCAL_CHAIN) {
      // Kick off the one-time on-chain fetch and re-render when it resolves.
      initOnChainAddresses();
      const handler = () => setAddress(getRuntimeAddress(key));
      window.addEventListener(ADDRESSES_UPDATED_EVENT, handler);
      return () => window.removeEventListener(ADDRESSES_UPDATED_EVENT, handler);
    }

    const handler = () => setAddress(getRuntimeAddress(key));
    window.addEventListener(ADDRESSES_UPDATED_EVENT, handler);

    const storageHandler = (e: StorageEvent) => {
      if (e.key === null || e.key === `${STORAGE_PREFIX}${key}`) {
        setAddress(getRuntimeAddress(key));
      }
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      window.removeEventListener(ADDRESSES_UPDATED_EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [key]);

  return address;
}
