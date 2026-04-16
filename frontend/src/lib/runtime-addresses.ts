import { useEffect, useState } from "react";
import { CONTRACT_ADDRESSES } from "./addresses";
import { IS_LOCAL_CHAIN } from "./network";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type RuntimeAddressKey =
  | "Vault"
  | "Treasury"
  | "InvestmentEscrow"
  | "ReserveController"
  | "GoldOracle"
  | "MockUSDC"
  | "ReceiptNFT"
  | "PortfolioRegistry";

const STORAGE_PREFIX = "sagitta.runtimeAddress.";
const GENERATED_SIGNATURE_KEY = `${STORAGE_PREFIX}generatedSignature`;
const GENERATED_CHAIN_KEY = `${STORAGE_PREFIX}generatedChainId`;
const ADDRESSES_UPDATED_EVENT = "sagitta:addresses-updated";

const MANAGED_KEYS: RuntimeAddressKey[] = [
  "Vault",
  "Treasury",
  "InvestmentEscrow",
  "ReserveController",
  "GoldOracle",
  "MockUSDC",
  "ReceiptNFT",
  "PortfolioRegistry",
];

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

export function isValidAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function getDefaultAddress(key: RuntimeAddressKey): string {
  const raw = (CONTRACT_ADDRESSES as any)?.[key];
  return isValidAddress(raw) ? raw : ZERO_ADDRESS;
}

// ---------------------------------------------------------------------------
// localStorage-backed overrides — LOCAL DEV ONLY
//
// On non-local chains (IS_LOCAL_CHAIN === false) the entire localStorage layer
// is bypassed. All public functions return addresses sourced exclusively from
// addresses.ts (bundled at build time). This prevents a user from injecting
// arbitrary contract addresses via localStorage manipulation.
// ---------------------------------------------------------------------------

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

  // Signature matches — localStorage already reflects the current addresses.ts. No-op.
  if (!force && currentSignature === nextSignature) return;

  const generatedChainId = Number((CONTRACT_ADDRESSES as any)?.chainId ?? 0);
  const storedChainId = Number(window.localStorage.getItem(GENERATED_CHAIN_KEY) ?? 0);

  // If localStorage was set for a different chain (e.g. testnet addresses while
  // addresses.ts was regenerated for localhost), skip the overwrite so manually-set
  // addresses aren't silently wiped. force=true (user clicked "Load Generated") bypasses this.
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

  // Notify any subscribers (e.g. useRuntimeAddress hooks) that addresses changed.
  window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
}

/**
 * Force-writes all addresses from addresses.ts into localStorage and notifies
 * subscribers. No-op on non-local chains (addresses come from addresses.ts directly).
 */
export function loadGeneratedRuntimeAddresses(): void {
  if (!IS_LOCAL_CHAIN || typeof window === "undefined") return;
  syncRuntimeAddressBookIfNeeded(true);
}

/**
 * Returns the active contract address for the given key.
 *
 * - Non-local chains: always returns the address bundled in addresses.ts.
 *   localStorage is never consulted, so user-side manipulation has no effect.
 * - Local chains: returns the localStorage override if present, otherwise
 *   falls back to addresses.ts. Useful for switching between local deployments
 *   without rebuilding.
 */
export function getRuntimeAddress(key: RuntimeAddressKey): string {
  if (!IS_LOCAL_CHAIN) return getDefaultAddress(key);
  if (typeof window === "undefined") return getDefaultAddress(key);
  // No session gate — the signature check inside is the idempotency guard.
  // This means HMR-reloaded addresses.ts constants are picked up automatically.
  syncRuntimeAddressBookIfNeeded();
  const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  if (isValidAddress(stored)) return stored;
  return getDefaultAddress(key);
}

/**
 * Persists a runtime address override in localStorage.
 * No-op and returns false on non-local chains.
 */
export function setRuntimeAddress(key: RuntimeAddressKey, address: string): boolean {
  if (!IS_LOCAL_CHAIN) return false;
  if (!isValidAddress(address)) return false;
  if (typeof window === "undefined") return false;
  syncRuntimeAddressBookIfNeeded();
  window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, address);
  window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
  return true;
}

/**
 * Record the active chain ID alongside any manually-saved addresses.
 * Call this after saving a batch of addresses via setRuntimeAddress so the
 * auto-sync guard knows which network those addresses belong to and won't
 * overwrite them when addresses.ts is regenerated for a different network.
 * No-op on non-local chains.
 */
export function markRuntimeChainId(chainId: number): void {
  if (!IS_LOCAL_CHAIN || typeof window === "undefined") return;
  window.localStorage.setItem(GENERATED_CHAIN_KEY, String(chainId));
}

/**
 * React hook — returns the current address for the given key and re-renders
 * automatically whenever addresses are updated.
 *
 * On non-local chains the hook returns the build-time address from addresses.ts
 * and never subscribes to any events (the value cannot change at runtime).
 */
export function useRuntimeAddress(key: RuntimeAddressKey): string {
  const [address, setAddress] = useState<string>(() => getRuntimeAddress(key));

  useEffect(() => {
    // On non-local chains the address is immutable — no subscriptions needed.
    if (!IS_LOCAL_CHAIN) return;

    const handler = () => setAddress(getRuntimeAddress(key));
    window.addEventListener(ADDRESSES_UPDATED_EVENT, handler);

    // Also react to updates from other tabs via the native storage event.
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
