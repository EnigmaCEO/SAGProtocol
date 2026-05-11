import { formatChainStatus, type ChainKey } from '../../lib/config/chains';
import { useProtocolChain } from '../../context/ProtocolChainContext';

function shortChainLabel(chainId: number | null, fallback: string): string {
  if (!chainId) return fallback;
  return fallback || `Chain ${chainId}`;
}

export default function ChainSelector({ compact = false }: { compact?: boolean }) {
  const {
    selectedChain,
    supportedChains,
    walletChainId,
    walletChain,
    walletMismatch,
    switchStatus,
    switchError,
    setSelectedChainKey,
    switchWalletToSelectedChain,
  } = useProtocolChain();

  return (
    <div className="chain-selector" data-compact={compact ? 'true' : 'false'}>
      <div className="chain-selector__row">
        <label className="chain-selector__label">
          <span>Protocol Chain</span>
          <select
            value={selectedChain.key}
            onChange={(event) => setSelectedChainKey(event.target.value as ChainKey)}
            className="chain-selector__select"
          >
            {supportedChains.map((chain) => (
              <option key={chain.key} value={chain.key} disabled={chain.status === 'disabled'}>
                {chain.name}
              </option>
            ))}
          </select>
        </label>

        <span className="chain-selector__badge" data-status={selectedChain.status}>
          {formatChainStatus(selectedChain.status)}
        </span>
      </div>

      <div className="chain-selector__meta">
        <span>Wallet: {shortChainLabel(walletChainId, walletChain?.shortName || (walletChainId ? '' : 'Not connected'))}</span>
        {walletMismatch ? <span className="chain-selector__mismatch">Mismatch</span> : null}
      </div>

      {walletMismatch ? (
        <button
          type="button"
          className="chain-selector__switch"
          onClick={() => void switchWalletToSelectedChain()}
          disabled={switchStatus === 'switching'}
        >
          {switchStatus === 'switching' ? 'Switching...' : `Switch wallet to ${selectedChain.shortName}`}
        </button>
      ) : null}

      {switchError ? <div className="chain-selector__error">{switchError}</div> : null}
    </div>
  );
}
