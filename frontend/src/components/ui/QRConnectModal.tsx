import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X, Wallet, Scan, Copy, CheckCircle, AlertCircle } from 'lucide-react';

export type WalletMode = 'demo' | 'injected';

export interface ConnectedWallet {
  address: string;
  mode: WalletMode;
  label: string;
}

interface QRConnectModalProps {
  currentWallet: ConnectedWallet;
  onConnect: (wallet: ConnectedWallet) => void;
  onClose: () => void;
}

const DEMO_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const DEMO_LABEL = 'Demo (Hardhat #0)';

export function makeEthereumQRUri(address: string): string {
  // EIP-681 address URI — scannable by most mobile wallets to identify the address
  return `ethereum:${address}`;
}

export default function QRConnectModal({ currentWallet, onConnect, onClose }: QRConnectModalProps) {
  const [tab, setTab] = useState<'qr' | 'browser'>('qr');
  const [copied, setCopied] = useState(false);
  const [browserStatus, setBrowserStatus] = useState<'idle' | 'connecting' | 'error'>('idle');
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [injectedAddress, setInjectedAddress] = useState<string | null>(null);
  const [hasInjected, setHasInjected] = useState(false);

  // Detect MetaMask / injected wallet on mount
  useEffect(() => {
    setHasInjected(typeof window !== 'undefined' && !!window.ethereum);
  }, []);

  const qrUri = makeEthereumQRUri(currentWallet.address);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentWallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard not available
    }
  }

  async function handleConnectBrowser() {
    if (!window.ethereum) {
      setBrowserError('No injected wallet detected. Install MetaMask or another Web3 browser extension.');
      setBrowserStatus('error');
      return;
    }
    setBrowserStatus('connecting');
    setBrowserError(null);
    try {
      const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned.');
      const addr = accounts[0];
      setInjectedAddress(addr);
      setBrowserStatus('idle');
    } catch (err: any) {
      setBrowserError(err?.message ?? 'Connection rejected.');
      setBrowserStatus('error');
    }
  }

  function handleUseInjected() {
    if (!injectedAddress) return;
    onConnect({ address: injectedAddress, mode: 'injected', label: 'Browser Wallet' });
  }

  function handleUseDemo() {
    onConnect({ address: DEMO_ADDRESS, mode: 'demo', label: DEMO_LABEL });
  }

  return (
    <div className="qr-modal-backdrop" onClick={onClose}>
      <div className="qr-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="qr-modal__header">
          <span className="qr-modal__title">Connect Wallet</span>
          <button className="qr-modal__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Current wallet banner */}
        <div className="qr-modal__current">
          <span className="qr-modal__current-label">Currently using</span>
          <span className="qr-modal__current-address">
            {currentWallet.address.slice(0, 6)}…{currentWallet.address.slice(-4)}
          </span>
          <span className="qr-modal__current-mode">{currentWallet.label}</span>
        </div>

        {/* Tabs */}
        <div className="qr-modal__tabs">
          <button
            className={`qr-modal__tab${tab === 'qr' ? ' qr-modal__tab--active' : ''}`}
            onClick={() => setTab('qr')}
          >
            <Scan size={14} /> QR Code
          </button>
          <button
            className={`qr-modal__tab${tab === 'browser' ? ' qr-modal__tab--active' : ''}`}
            onClick={() => setTab('browser')}
          >
            <Wallet size={14} /> Browser Wallet
          </button>
        </div>

        {/* QR tab */}
        {tab === 'qr' && (
          <div className="qr-modal__body">
            <p className="qr-modal__hint">
              Scan with a mobile wallet (MetaMask Mobile, Trust Wallet, etc.) to identify this address.
            </p>
            <div className="qr-modal__qr-wrap">
              <QRCodeSVG
                value={qrUri}
                size={200}
                bgColor="#0a111c"
                fgColor="#ebf2ff"
                level="M"
                includeMargin
              />
            </div>
            <div className="qr-modal__address-row">
              <span className="qr-modal__address-text">{currentWallet.address}</span>
              <button className="qr-modal__copy-btn" onClick={handleCopy} title="Copy address">
                {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="qr-modal__uri-label">URI: {qrUri}</div>
          </div>
        )}

        {/* Browser wallet tab */}
        {tab === 'browser' && (
          <div className="qr-modal__body">
            {!hasInjected && (
              <div className="qr-modal__notice qr-modal__notice--warn">
                <AlertCircle size={14} />
                No injected wallet detected. Install MetaMask or another Web3 extension, then refresh.
              </div>
            )}

            {hasInjected && !injectedAddress && (
              <>
                <p className="qr-modal__hint">
                  Connect your MetaMask or browser wallet to use it as the active account.
                </p>
                <button
                  className="action-button action-button--primary qr-modal__connect-btn"
                  onClick={handleConnectBrowser}
                  disabled={browserStatus === 'connecting'}
                >
                  {browserStatus === 'connecting' ? 'Connecting…' : 'Connect MetaMask'}
                </button>
              </>
            )}

            {browserStatus === 'error' && browserError && (
              <div className="qr-modal__notice qr-modal__notice--danger">
                <AlertCircle size={14} />
                {browserError}
              </div>
            )}

            {injectedAddress && (
              <div className="qr-modal__injected-result">
                <CheckCircle size={16} className="qr-modal__injected-icon" />
                <div className="qr-modal__injected-address">{injectedAddress}</div>
                <p className="qr-modal__hint">Wallet connected. Use this address for all reads.</p>
                <button
                  className="action-button action-button--success qr-modal__connect-btn"
                  onClick={handleUseInjected}
                >
                  Use This Wallet
                </button>
              </div>
            )}

            <div className="qr-modal__divider" />

            <div className="qr-modal__demo-row">
              <span className="qr-modal__demo-label">Or switch back to demo account</span>
              <button
                className="action-button action-button--ghost"
                onClick={handleUseDemo}
                disabled={currentWallet.mode === 'demo'}
              >
                {currentWallet.mode === 'demo' ? 'Active' : 'Use Demo'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
