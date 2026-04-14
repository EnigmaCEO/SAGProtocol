import { useEffect, useState } from 'react';

const MOONBASE_CHAIN_ID = 1287;
const MOONBASE_HEX = '0x507';
const VALID_CHAIN_IDS = [1337, MOONBASE_CHAIN_ID];

const MOONBASE_PARAMS = {
  chainId: MOONBASE_HEX,
  chainName: 'Moonbase Alpha',
  nativeCurrency: { name: 'DEV', symbol: 'DEV', decimals: 18 },
  rpcUrls: ['https://rpc.api.moonbase.moonbeam.network'],
  blockExplorerUrls: ['https://moonbase.moonscan.io'],
};

export default function NetworkBanner() {
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'switching'>('idle');

  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).ethereum) return;

    let active = true;
    const ethereum = (window as any).ethereum;

    const refreshChain = async () => {
      try {
        const hexChainId = await ethereum.request({ method: 'eth_chainId' });
        const nextChainId = Number.parseInt(hexChainId, 16);
        if (!active) return;
        setChainId(nextChainId);
        setIsWrongNetwork(!VALID_CHAIN_IDS.includes(nextChainId));
      } catch {
        if (!active) return;
        setChainId(null);
        setIsWrongNetwork(false);
      }
    };

    refreshChain();
    ethereum.on?.('chainChanged', refreshChain);

    return () => {
      active = false;
      ethereum.removeListener?.('chainChanged', refreshChain);
    };
  }, []);

  const switchToMoonbase = async () => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) return;
    setStatus('switching');
    try {
      // Try switching first (works if the network is already added)
      await ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: MOONBASE_HEX }],
      });
    } catch (switchErr: any) {
      // Error 4902 = chain not added yet — add it automatically
      if (switchErr?.code === 4902 || switchErr?.code === -32603) {
        try {
          await ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [MOONBASE_PARAMS],
          });
        } catch (addErr: any) {
          alert(addErr?.message || 'Failed to add Moonbase Alpha network');
        }
      } else {
        alert(switchErr?.message || 'Failed to switch network');
      }
    } finally {
      setStatus('idle');
    }
  };

  if (!isWrongNetwork) return null;

  return (
    <div className="bg-yellow-600 text-white px-4 py-3 mb-4 rounded flex flex-wrap items-center gap-3 justify-between">
      <span className="font-medium text-sm">
        Wrong network ({chainId ?? 'unknown'}) — switch to Moonbase Alpha (1287) to use the protocol.
      </span>
      <div className="flex items-center gap-2">
        <a
          href="https://faucet.moonbase.moonbeam.network/"
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white/20 hover:bg-white/30 text-white px-3 py-1 rounded text-sm font-medium border border-white/40"
        >
          Get DEV tokens ↗
        </a>
        <button
          onClick={switchToMoonbase}
          disabled={status === 'switching'}
          className="bg-white text-yellow-700 px-4 py-1 rounded font-medium hover:bg-gray-100 disabled:opacity-60 text-sm"
        >
          {status === 'switching' ? 'Switching…' : 'Switch to Moonbase Alpha'}
        </button>
      </div>
    </div>
  );
}
