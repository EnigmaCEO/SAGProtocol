import { useEffect, useState } from 'react';

const VALID_CHAIN_IDS = [1337, 1287];

export default function NetworkBanner() {
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);
  const [chainId, setChainId] = useState<number | null>(null);

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
    try {
      await (window as any).ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x507' }],
      });
    } catch (err: any) {
      alert(err.message || 'Failed to switch network');
    }
  };

  if (!isWrongNetwork) return null;

  return (
    <div className="bg-yellow-600 text-white px-4 py-3 mb-4 rounded flex items-center justify-between">
      <span className="font-medium">Wrong network ({chainId ?? 'unknown'}) - switch to Moonbase Alpha (1287) or Local (1337)</span>
      <button
        onClick={switchToMoonbase}
        className="bg-white text-yellow-700 px-4 py-1 rounded font-medium hover:bg-gray-100"
      >
        Switch to Moonbase Alpha
      </button>
    </div>
  );
}
