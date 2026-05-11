export type ChainKey =
  | 'moonbase'
  | 'localhost'
  | 'arc'
  | 'base-sepolia'
  | 'arbitrum-sepolia'
  | 'optimism-sepolia';

export type ChainStatus = 'active' | 'evaluating' | 'disabled';

export interface NativeCurrencyConfig {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ProtocolChainConfig {
  key: ChainKey;
  chainId: number;
  name: string;
  shortName: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: NativeCurrencyConfig;
  status: ChainStatus;
  isLocal?: boolean;
}

export const DEFAULT_CHAIN_KEY: ChainKey = 'moonbase';
export const PROTOCOL_CHAIN_STORAGE_KEY = 'sagitta.protocolChain.v1';
export const PROTOCOL_CHAIN_CHANGED_EVENT = 'sagitta:protocol-chain-changed';

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env[name] : undefined;
}

export const PROTOCOL_CHAINS: ProtocolChainConfig[] = [
  {
    key: 'moonbase',
    chainId: 1287,
    name: 'Moonbase Alpha',
    shortName: 'Moonbase',
    rpcUrl: env('NEXT_PUBLIC_MOONBASE_RPC_URL') || 'https://rpc.api.moonbase.moonbeam.network',
    explorerUrl: 'https://moonbase.moonscan.io',
    nativeCurrency: { name: 'DEV', symbol: 'DEV', decimals: 18 },
    status: 'active',
  },
  {
    key: 'localhost',
    chainId: 1337,
    name: 'Localhost',
    shortName: 'Local',
    rpcUrl: env('NEXT_PUBLIC_LOCALHOST_RPC_URL') || 'http://127.0.0.1:8545',
    explorerUrl: '',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    status: 'evaluating',
    isLocal: true,
  },
  {
    key: 'arc',
    chainId: 5042002,
    name: 'Arc Testnet',
    shortName: 'Arc',
    rpcUrl: env('NEXT_PUBLIC_ARC_RPC_URL') || 'https://rpc.testnet.arc.network',
    explorerUrl: 'https://testnet.arcscan.app',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    status: 'evaluating',
  },
  {
    key: 'base-sepolia',
    chainId: 84532,
    name: 'Base Sepolia',
    shortName: 'Base Sepolia',
    rpcUrl: env('NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL') || 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    status: 'evaluating',
  },
  {
    key: 'arbitrum-sepolia',
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    shortName: 'Arb Sepolia',
    rpcUrl: env('NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL') || 'https://sepolia-rollup.arbitrum.io/rpc',
    explorerUrl: 'https://sepolia.arbiscan.io',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    status: 'evaluating',
  },
  {
    key: 'optimism-sepolia',
    chainId: 11155420,
    name: 'Optimism Sepolia',
    shortName: 'OP Sepolia',
    rpcUrl: env('NEXT_PUBLIC_OPTIMISM_SEPOLIA_RPC_URL') || 'https://sepolia.optimism.io',
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    status: 'evaluating',
  },
];

const CHAIN_BY_KEY = new Map(PROTOCOL_CHAINS.map((chain) => [chain.key, chain]));
const CHAIN_BY_ID = new Map(PROTOCOL_CHAINS.map((chain) => [chain.chainId, chain]));

export const DEV_CHAIN_IDS = PROTOCOL_CHAINS.filter((chain) => chain.isLocal).map((chain) => chain.chainId);
export const TESTNET_CHAIN_IDS = PROTOCOL_CHAINS.filter((chain) => !chain.isLocal).map((chain) => chain.chainId);
export const SUPPORTED_EVM_CHAIN_IDS = PROTOCOL_CHAINS.map((chain) => chain.chainId);

export function getDefaultChain(): ProtocolChainConfig {
  return CHAIN_BY_KEY.get(DEFAULT_CHAIN_KEY)!;
}

export function getSupportedChains(): ProtocolChainConfig[] {
  return PROTOCOL_CHAINS.filter((chain) => chain.status !== 'disabled');
}

export function getChainByKey(key: string | null | undefined): ProtocolChainConfig | null {
  return key ? CHAIN_BY_KEY.get(key as ChainKey) ?? null : null;
}

export function getChainById(chainId: number | string | bigint | null | undefined): ProtocolChainConfig | null {
  if (chainId === null || chainId === undefined) return null;
  const numeric = Number(chainId);
  return Number.isFinite(numeric) ? CHAIN_BY_ID.get(numeric) ?? null : null;
}

export function getChainByKeyOrDefault(key: string | null | undefined): ProtocolChainConfig {
  return getChainByKey(key) ?? getDefaultChain();
}

export function getStoredProtocolChainKey(): ChainKey {
  if (typeof window === 'undefined') return DEFAULT_CHAIN_KEY;
  const stored = window.localStorage.getItem(PROTOCOL_CHAIN_STORAGE_KEY);
  return getChainByKey(stored)?.key ?? DEFAULT_CHAIN_KEY;
}

export function setStoredProtocolChainKey(key: ChainKey): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROTOCOL_CHAIN_STORAGE_KEY, key);
  window.dispatchEvent(new CustomEvent(PROTOCOL_CHAIN_CHANGED_EVENT, { detail: { key } }));
}

export function getActiveChain(): ProtocolChainConfig {
  return getChainByKeyOrDefault(getStoredProtocolChainKey());
}

export function toHexChainId(chainId: number): string {
  return `0x${chainId.toString(16)}`;
}

export function getWalletAddEthereumChainParams(chain: ProtocolChainConfig) {
  return {
    chainId: toHexChainId(chain.chainId),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [chain.rpcUrl],
    blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : undefined,
  };
}

export function formatChainStatus(status: ChainStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'evaluating') return 'Evaluating';
  return 'Unsupported';
}
