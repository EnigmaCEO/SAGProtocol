import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  PROTOCOL_CHAIN_CHANGED_EVENT,
  getChainById,
  getChainByKey,
  getChainByKeyOrDefault,
  getDefaultChain,
  getStoredProtocolChainKey,
  getSupportedChains,
  getWalletAddEthereumChainParams,
  setStoredProtocolChainKey,
  toHexChainId,
  type ChainKey,
  type ProtocolChainConfig,
} from '../lib/config/chains';
import { getDeploymentByChainKey, hasConfiguredProtocolDao, type ProtocolDeployment } from '../lib/config/deployments';
import { getFeaturesForChain, type ProtocolFeature } from '../lib/config/features';
import { ADDRESSES_UPDATED_EVENT } from '../lib/runtime-addresses';
import { emitUiRefresh } from '../lib/ui-refresh';

type WalletSwitchStatus = 'idle' | 'switching' | 'success' | 'error';

interface ProtocolChainContextValue {
  selectedChain: ProtocolChainConfig;
  supportedChains: ProtocolChainConfig[];
  walletChainId: number | null;
  walletChain: ProtocolChainConfig | null;
  walletMismatch: boolean;
  activeDeployment: ProtocolDeployment;
  features: Record<ProtocolFeature, boolean>;
  switchStatus: WalletSwitchStatus;
  switchError: string | null;
  setSelectedChainKey: (key: ChainKey) => void;
  switchWalletToSelectedChain: () => Promise<boolean>;
}

const ProtocolChainContext = createContext<ProtocolChainContextValue | undefined>(undefined);

async function readWalletChainId(): Promise<number | null> {
  if (typeof window === 'undefined') return null;
  const eth = (window as any).ethereum;
  if (!eth?.request) return null;

  try {
    const chainId = await eth.request({ method: 'eth_chainId' });
    return Number.parseInt(String(chainId), 16);
  } catch {
    return null;
  }
}

function errorMessage(error: any): string {
  return String(error?.shortMessage || error?.message || error || 'Wallet network switch failed.');
}

function isLocalRuntimeHost(hostname: string | null | undefined): boolean {
  return !!hostname && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function getRuntimeAllowsLocalChains(): boolean {
  if (typeof window === 'undefined') return false;
  return isLocalRuntimeHost(window.location.hostname);
}

function isSelectableChain(chain: ProtocolChainConfig, allowLocalChains: boolean): boolean {
  return chain.status !== 'disabled' && !!chain.rpcUrl && hasConfiguredProtocolDao(chain.key) && (!chain.isLocal || allowLocalChains);
}

function getSelectableChains(allowLocalChains: boolean): ProtocolChainConfig[] {
  return getSupportedChains().filter((chain) => isSelectableChain(chain, allowLocalChains));
}

function getSelectableChainByKeyOrDefault(key: ChainKey | string | null | undefined, allowLocalChains: boolean): ProtocolChainConfig {
  const chain = getChainByKey(key);
  if (chain && isSelectableChain(chain, allowLocalChains)) return chain;
  return getDefaultChain();
}

export function ProtocolChainProvider({ children }: { children: React.ReactNode }) {
  const [selectedChainKey, setSelectedChainKeyState] = useState<ChainKey>(() => getDefaultChain().key);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [switchStatus, setSwitchStatus] = useState<WalletSwitchStatus>('idle');
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [allowLocalChains, setAllowLocalChains] = useState(false);

  const selectedChain = useMemo(
    () => getSelectableChainByKeyOrDefault(selectedChainKey, allowLocalChains),
    [allowLocalChains, selectedChainKey]
  );
  const supportedChains = useMemo(() => getSelectableChains(allowLocalChains), [allowLocalChains]);
  const walletChain = useMemo(() => getChainById(walletChainId), [walletChainId]);
  const walletMismatch = walletChainId !== null && walletChainId !== selectedChain.chainId;
  const activeDeployment = useMemo(() => getDeploymentByChainKey(selectedChain.key), [selectedChain.key]);
  const features = useMemo(() => getFeaturesForChain(selectedChain.key), [selectedChain.key]);

  const syncWalletChain = useCallback(() => {
    readWalletChainId().then(setWalletChainId).catch(() => setWalletChainId(null));
  }, []);

  const setSelectedChainKey = useCallback((key: ChainKey) => {
    const chain = getSelectableChainByKeyOrDefault(key, allowLocalChains);
    setStoredProtocolChainKey(chain.key);
    setSelectedChainKeyState(chain.key);
    setSwitchError(null);
  }, [allowLocalChains]);

  const switchWalletToSelectedChain = useCallback(async () => {
    if (typeof window === 'undefined') return false;
    const eth = (window as any).ethereum;
    if (!eth?.request) {
      setSwitchStatus('error');
      setSwitchError('No injected wallet is available.');
      return false;
    }

    setSwitchStatus('switching');
    setSwitchError(null);

    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: toHexChainId(selectedChain.chainId) }],
      });
      setWalletChainId(selectedChain.chainId);
      setSwitchStatus('success');
      return true;
    } catch (switchError: any) {
      if (switchError?.code !== 4902) {
        setSwitchStatus('error');
        setSwitchError(errorMessage(switchError));
        return false;
      }

      try {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [getWalletAddEthereumChainParams(selectedChain)],
        });
        await eth.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: toHexChainId(selectedChain.chainId) }],
        });
        setWalletChainId(selectedChain.chainId);
        setSwitchStatus('success');
        return true;
      } catch (addError: any) {
        setSwitchStatus('error');
        setSwitchError(errorMessage(addError));
        return false;
      }
    }
  }, [selectedChain]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const nextAllowLocalChains = getRuntimeAllowsLocalChains();
    setAllowLocalChains(nextAllowLocalChains);
    setSelectedChainKeyState(getSelectableChainByKeyOrDefault(getStoredProtocolChainKey(), nextAllowLocalChains).key);
    syncWalletChain();

    const eth = (window as any).ethereum;
    const handleChainChanged = (chainId: string) => {
      setWalletChainId(Number.parseInt(String(chainId), 16));
    };
    const handleStoredChainChanged = () => {
      const allowLocalChains = getRuntimeAllowsLocalChains();
      setAllowLocalChains(allowLocalChains);
      setSelectedChainKeyState(getSelectableChainByKeyOrDefault(getStoredProtocolChainKey(), allowLocalChains).key);
    };

    eth?.on?.('chainChanged', handleChainChanged);
    window.addEventListener(PROTOCOL_CHAIN_CHANGED_EVENT, handleStoredChainChanged as EventListener);
    window.addEventListener('storage', handleStoredChainChanged);

    return () => {
      eth?.removeListener?.('chainChanged', handleChainChanged);
      window.removeEventListener(PROTOCOL_CHAIN_CHANGED_EVENT, handleStoredChainChanged as EventListener);
      window.removeEventListener('storage', handleStoredChainChanged);
    };
  }, [syncWalletChain]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(ADDRESSES_UPDATED_EVENT));
    emitUiRefresh('protocol-chain-changed');
  }, [selectedChain.key]);

  const value = useMemo<ProtocolChainContextValue>(
    () => ({
      selectedChain,
      supportedChains,
      walletChainId,
      walletChain,
      walletMismatch,
      activeDeployment,
      features,
      switchStatus,
      switchError,
      setSelectedChainKey,
      switchWalletToSelectedChain,
    }),
    [
      activeDeployment,
      features,
      selectedChain,
      setSelectedChainKey,
      supportedChains,
      switchError,
      switchStatus,
      switchWalletToSelectedChain,
      walletChain,
      walletChainId,
      walletMismatch,
    ]
  );

  return <ProtocolChainContext.Provider value={value}>{children}</ProtocolChainContext.Provider>;
}

export function useProtocolChain(): ProtocolChainContextValue {
  const context = useContext(ProtocolChainContext);
  if (!context) {
    throw new Error('useProtocolChain must be used within ProtocolChainProvider');
  }
  return context;
}
