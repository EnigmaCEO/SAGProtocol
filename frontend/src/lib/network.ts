import { getChainById, getChainByKeyOrDefault, getDefaultChain, getStoredProtocolChainKey } from './config/chains';

export function getActiveChainConfig() {
  return typeof window === 'undefined'
    ? getDefaultChain()
    : getChainByKeyOrDefault(getStoredProtocolChainKey());
}

export function getActiveRpcUrl(): string {
  return getActiveChainConfig().rpcUrl;
}

export function getActiveChainId(): number {
  return getActiveChainConfig().chainId;
}

export function isLocalChainId(chainId: number): boolean {
  return !!getChainById(chainId)?.isLocal;
}

export function isActiveLocalChain(): boolean {
  return !!getActiveChainConfig().isLocal;
}

export const RPC_URL: string = getActiveRpcUrl();
export const CHAIN_ID: number = getActiveChainId();
export const IS_LOCAL_CHAIN: boolean = isActiveLocalChain();

export function getViemActiveChain() {
  const chain = getActiveChainConfig();
  return {
    id: chain.chainId,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: [chain.rpcUrl] },
      public: { http: [chain.rpcUrl] },
    },
    blockExplorers: chain.explorerUrl
      ? { default: { name: `${chain.shortName} Explorer`, url: chain.explorerUrl } }
      : undefined,
  } as const;
}

export const ACTIVE_CHAIN = getViemActiveChain();
