import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getActiveChain, PROTOCOL_CHAIN_CHANGED_EVENT } from "./config/chains";
import { getActiveDeployment, getDeploymentAddress, type ContractAddressKey } from "./config/deployments";
import { isFeatureEnabledForChain } from "./config/features";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type RuntimeAddressKey = Extract<
  ContractAddressKey,
  | "ProtocolDAO"
  | "Vault"
  | "Treasury"
  | "InvestmentEscrow"
  | "ExecutionRouteRegistry"
  | "ReserveController"
  | "GoldOracle"
  | "UsdcOracle"
  | "MockUSDC"
  | "MockGOLD"
  | "ReceiptNFT"
  | "PortfolioRegistry"
>;

const STORAGE_PREFIX = "sagitta.runtimeAddress.";
const GENERATED_SIGNATURE_KEY = `${STORAGE_PREFIX}generatedSignature`;
const GENERATED_CHAIN_KEY = `${STORAGE_PREFIX}generatedChainId`;
export const ADDRESSES_UPDATED_EVENT = "sagitta:addresses-updated";

const MANAGED_KEYS: RuntimeAddressKey[] = [
  "ProtocolDAO",
  "Vault",
  "Treasury",
  "InvestmentEscrow",
  "ExecutionRouteRegistry",
  "ReserveController",
  "GoldOracle",
  "UsdcOracle",
  "MockUSDC",
  "MockGOLD",
  "ReceiptNFT",
  "PortfolioRegistry",
];

const PROTOCOL_DAO_ABI = [
  "function getAllAddresses() external view returns (string[] memory keys, address[] memory addrs)",
];

const onChainCacheByChain = new Map<string, Map<string, string>>();
const onChainFetchPromiseByChain = new Map<string, Promise<void>>();

function currentChainKey(): string {
  return getActiveChain().key;
}

function storageKeyFor(key: RuntimeAddressKey): string {
  return `${STORAGE_PREFIX}${currentChainKey()}.${key}`;
}

function generatedSignatureKey(): string {
  return `${GENERATED_SIGNATURE_KEY}.${currentChainKey()}`;
}

function generatedChainKey(): string {
  return `${GENERATED_CHAIN_KEY}.${currentChainKey()}`;
}

function isZeroAddress(value: string): boolean {
  return value.toLowerCase() === ZERO_ADDRESS.toLowerCase();
}

export function isValidAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isLocalRuntimeOverrideEnabled(): boolean {
  return isFeatureEnabledForChain("runtimeAddressOverrides", currentChainKey());
}

export function getDefaultAddress(key: RuntimeAddressKey): string {
  const raw = getDeploymentAddress(key, currentChainKey());
  return isValidAddress(raw) ? raw : ZERO_ADDRESS;
}

async function fetchOnChainAddressesForActiveChain(): Promise<void> {
  const chain = getActiveChain();
  const daoAddress = getDefaultAddress("ProtocolDAO");
  if (!isValidAddress(daoAddress) || isZeroAddress(daoAddress)) return;

  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);

    const dao = new ethers.Contract(daoAddress, PROTOCOL_DAO_ABI, provider);
    const [keys, addrs]: [string[], string[]] = await dao.getAllAddresses();

    const cache = new Map<string, string>();
    for (let i = 0; i < keys.length; i++) {
      if (isValidAddress(addrs[i])) cache.set(keys[i], addrs[i]);
    }
    onChainCacheByChain.set(chain.key, cache);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
    }
  } catch (e) {
    console.warn(`ProtocolDAO address fetch failed for ${chain.key}, using deployment registry:`, e);
  }
}

export function initOnChainAddresses(): void {
  if (typeof window === "undefined") return;
  if (isLocalRuntimeOverrideEnabled()) return;

  const chainKey = currentChainKey();
  if (onChainFetchPromiseByChain.has(chainKey)) return;
  const promise = fetchOnChainAddressesForActiveChain();
  onChainFetchPromiseByChain.set(chainKey, promise);
}

export async function ensureOnChainAddresses(): Promise<void> {
  if (typeof window === "undefined") return;
  if (isLocalRuntimeOverrideEnabled()) return;

  const chainKey = currentChainKey();
  let promise = onChainFetchPromiseByChain.get(chainKey);
  if (!promise) {
    promise = fetchOnChainAddressesForActiveChain();
    onChainFetchPromiseByChain.set(chainKey, promise);
  }
  await promise;
}

function getGeneratedAddressSignature(): string {
  const deployment = getActiveDeployment();
  const snapshot: Record<string, string | number | null> = {
    network: deployment.network,
    chainId: deployment.chainId,
  };
  for (const key of MANAGED_KEYS) {
    snapshot[key] = getDefaultAddress(key).toLowerCase();
  }
  return JSON.stringify(snapshot);
}

function syncRuntimeAddressBookIfNeeded(force = false): void {
  if (typeof window === "undefined" || !isLocalRuntimeOverrideEnabled()) return;

  const nextSignature = getGeneratedAddressSignature();
  const currentSignature = window.localStorage.getItem(generatedSignatureKey());

  if (!force && currentSignature === nextSignature) return;

  const generatedChainId = Number(getActiveDeployment().chainId ?? 0);
  const storedChainId = Number(window.localStorage.getItem(generatedChainKey()) ?? 0);

  if (!force && storedChainId !== 0 && storedChainId !== generatedChainId) {
    return;
  }

  for (const key of MANAGED_KEYS) {
    const defaultAddress = getDefaultAddress(key);
    if (isValidAddress(defaultAddress) && !isZeroAddress(defaultAddress)) {
      window.localStorage.setItem(storageKeyFor(key), defaultAddress);
    } else {
      window.localStorage.removeItem(storageKeyFor(key));
    }
  }

  window.localStorage.setItem(generatedChainKey(), String(generatedChainId));
  window.localStorage.setItem(generatedSignatureKey(), nextSignature);

  window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
}

export function loadGeneratedRuntimeAddresses(): void {
  syncRuntimeAddressBookIfNeeded(true);
}

export function getRuntimeAddress(key: RuntimeAddressKey): string {
  if (!isLocalRuntimeOverrideEnabled()) {
    const cache = onChainCacheByChain.get(currentChainKey());
    if (cache?.has(key)) return cache.get(key)!;
    return getDefaultAddress(key);
  }

  if (typeof window === "undefined") return getDefaultAddress(key);
  syncRuntimeAddressBookIfNeeded();
  const stored = window.localStorage.getItem(storageKeyFor(key));
  if (isValidAddress(stored)) return stored;
  return getDefaultAddress(key);
}

export function setRuntimeAddress(key: RuntimeAddressKey, address: string): boolean {
  if (!isLocalRuntimeOverrideEnabled()) return false;
  if (!isValidAddress(address)) return false;
  if (typeof window === "undefined") return false;
  syncRuntimeAddressBookIfNeeded();
  window.localStorage.setItem(storageKeyFor(key), address);
  window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
  return true;
}

export function markRuntimeChainId(chainId: number): void {
  if (!isLocalRuntimeOverrideEnabled() || typeof window === "undefined") return;
  window.localStorage.setItem(generatedChainKey(), String(chainId));
}

export function useRuntimeAddress(key: RuntimeAddressKey): string {
  const [address, setAddress] = useState<string>(() => getRuntimeAddress(key));

  useEffect(() => {
    const sync = () => {
      initOnChainAddresses();
      setAddress(getRuntimeAddress(key));
    };

    sync();

    if (typeof window === "undefined") return undefined;
    window.addEventListener(ADDRESSES_UPDATED_EVENT, sync);
    window.addEventListener(PROTOCOL_CHAIN_CHANGED_EVENT, sync as EventListener);

    const storageHandler = (event: StorageEvent) => {
      if (event.key === null || event.key === storageKeyFor(key)) {
        setAddress(getRuntimeAddress(key));
      }
    };
    window.addEventListener("storage", storageHandler);

    return () => {
      window.removeEventListener(ADDRESSES_UPDATED_EVENT, sync);
      window.removeEventListener(PROTOCOL_CHAIN_CHANGED_EVENT, sync as EventListener);
      window.removeEventListener("storage", storageHandler);
    };
  }, [key]);

  return address;
}
