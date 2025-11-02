import { useEffect, useState } from 'react';
import { useNetwork, useSwitchNetwork } from 'wagmi';

const VALID_CHAIN_IDS = [1337, 1287]; // Local and Moonbase Alpha

export default function NetworkBanner() {
  const { chain } = useNetwork();
  const { switchNetwork } = useSwitchNetwork();
  const [isWrongNetwork, setIsWrongNetwork] = useState(false);

  useEffect(() => {
    if (chain?.id) {
      setIsWrongNetwork(!VALID_CHAIN_IDS.includes(chain.id));
    }
  }, [chain?.id]);

  const switchToMoonbase = async () => {
    if (switchNetwork) {
      switchNetwork(1287);
    } else {
      // Fallback for manual switch
      try {
        await (window as any).ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x507' }], // 1287 in hex
        });
      } catch (err: any) {
        alert(err.message || 'Failed to switch network');
      }
    }
  };

  if (!isWrongNetwork) return null;

  return (
    <div className="bg-yellow-600 text-white px-4 py-3 mb-4 rounded flex items-center justify-between">
      <span className="font-medium">⚠️ Wrong Network - Please switch to Moonbase Alpha (1287) or Local (1337)</span>
      <button
        onClick={switchToMoonbase}
        className="bg-white text-yellow-700 px-4 py-1 rounded font-medium hover:bg-gray-100"
      >
        Switch to Moonbase Alpha
      </button>
    </div>
  );
}
