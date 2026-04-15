import { CONTRACT_ADDRESSES } from "./addresses";

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
let hasSessionSynced = false;

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

  for (const key of MANAGED_KEYS) {
    const defaultAddress = getDefaultAddress(key);
    const storageKey = `${STORAGE_PREFIX}${key}`;
    if (isValidAddress(defaultAddress) && !isZeroAddress(defaultAddress)) {
      window.localStorage.setItem(storageKey, defaultAddress);
    } else {
      window.localStorage.removeItem(storageKey);
    }
  }

  window.localStorage.setItem(GENERATED_SIGNATURE_KEY, nextSignature);
}

function ensureRuntimeSync(): void {
  if (typeof window === "undefined" || hasSessionSynced) return;
  hasSessionSynced = true;
  syncRuntimeAddressBookIfNeeded();
}

export function loadGeneratedRuntimeAddresses(): void {
  if (typeof window === "undefined") return;
  syncRuntimeAddressBookIfNeeded(true);
}

export function getRuntimeAddress(key: RuntimeAddressKey): string {
  if (typeof window === "undefined") return getDefaultAddress(key);
  ensureRuntimeSync();
  const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  if (isValidAddress(stored)) return stored;
  return getDefaultAddress(key);
}

export function setRuntimeAddress(key: RuntimeAddressKey, address: string): boolean {
  if (!isValidAddress(address)) return false;
  if (typeof window === "undefined") return false;
  ensureRuntimeSync();
  window.localStorage.setItem(`${STORAGE_PREFIX}${key}`, address);
  return true;
}
