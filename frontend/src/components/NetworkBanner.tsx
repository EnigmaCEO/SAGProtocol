import { useProtocolChain } from '../context/ProtocolChainContext';

export default function NetworkBanner() {
  const {
    selectedChain,
    walletChainId,
    walletMismatch,
    switchStatus,
    switchError,
    switchWalletToSelectedChain,
  } = useProtocolChain();

  if (!walletMismatch) return null;

  return (
    <div className="bg-yellow-600 text-white px-4 py-3 mb-4 rounded flex flex-wrap items-center gap-3 justify-between">
      <span className="font-medium text-sm">
        Wallet network ({walletChainId ?? 'unknown'}) differs from selected protocol chain {selectedChain.name} ({selectedChain.chainId}).
      </span>
      <div className="flex items-center gap-2">
        {switchError ? <span className="text-xs text-white/90">{switchError}</span> : null}
        <button
          onClick={() => void switchWalletToSelectedChain()}
          disabled={switchStatus === 'switching'}
          className="bg-white text-yellow-700 px-4 py-1 rounded font-medium hover:bg-gray-100 disabled:opacity-60 text-sm"
        >
          {switchStatus === 'switching' ? 'Switching...' : `Switch to ${selectedChain.shortName}`}
        </button>
      </div>
    </div>
  );
}
