import { Clock, Lock, Users, Layers, Repeat } from 'lucide-react';
import MetricCard from '../ui/MetricCard';
import useVaultMetrics from '../../hooks/useVaultMetrics';
import { useEffect, useState } from 'react';
import { Wallet, Contract, JsonRpcProvider } from 'ethers';
import VAULT_ABI from '../../lib/abis/Vault.json';
import { getRuntimeAddress, isValidAddress, setRuntimeAddress } from '../../lib/runtime-addresses';
import { emitUiRefresh } from '../../lib/ui-refresh';
import useRoleAccess from '../../hooks/useRoleAccess';
import useProtocolPause from '../../hooks/useProtocolPause';
import PageHeader from '../ui/PageHeader';
import { RPC_URL } from '../../lib/network';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const provider = new JsonRpcProvider(RPC_URL);
const VAULT_ABI_NORM: any = Array.isArray(VAULT_ABI) ? VAULT_ABI : (VAULT_ABI as any)?.abi ?? VAULT_ABI;
const DEFAULT_VAULT_UNLOCK_SECONDS = 365 * 24 * 60 * 60;
const VAULT_UNLOCK_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: '90 days', seconds: 90 * 24 * 60 * 60 },
  { label: '180 days', seconds: 180 * 24 * 60 * 60 },
  { label: '1 year', seconds: 365 * 24 * 60 * 60 },
  { label: '2 years', seconds: 2 * 365 * 24 * 60 * 60 },
];

function formatUsd6(usd6: string): string {
  const n = Number(usd6 || '0');
  if (!Number.isFinite(n)) return '$0.00';
  return `$${(n / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatSecondsLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'N/A';
  if (seconds % (365 * 24 * 60 * 60) === 0) {
    const years = seconds / (365 * 24 * 60 * 60);
    return `${years} year${years === 1 ? '' : 's'}`;
  }
  if (seconds % (30 * 24 * 60 * 60) === 0) {
    const months = seconds / (30 * 24 * 60 * 60);
    return `${months} month${months === 1 ? '' : 's'}`;
  }
  if (seconds % (7 * 24 * 60 * 60) === 0) {
    const weeks = seconds / (7 * 24 * 60 * 60);
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  if (seconds % (24 * 60 * 60) === 0) {
    const days = seconds / (24 * 60 * 60);
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${seconds}s`;
}

function shortenAddress(value: string): string {
  if (!isValidAddress(value)) return 'N/A';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function VaultTab() {
  const { isPaused } = useProtocolPause();
  const { isOperator, role } = useRoleAccess();
  const [vaultAddress, setVaultAddressState] = useState<string>(() => getRuntimeAddress('Vault'));
  const metrics = useVaultMetrics(15000, vaultAddress);

  const [vaultAddressInput, setVaultAddressInput] = useState<string>(vaultAddress);
  const [treasuryLinkInput, setTreasuryLinkInput] = useState<string>(() => getRuntimeAddress('Treasury'));
  const [escrowLinkInput, setEscrowLinkInput] = useState<string>(() => getRuntimeAddress('InvestmentEscrow'));
  const [linkedTreasuryAddress, setLinkedTreasuryAddress] = useState<string>('');
  const [linkedEscrowAddress, setLinkedEscrowAddress] = useState<string>('');
  const [linkConfigLoading, setLinkConfigLoading] = useState(false);
  const [linkConfigStatus, setLinkConfigStatus] = useState<string | null>(null);

  const [returnTokenId, setReturnTokenId] = useState<string>('');
  const [returnLoading, setReturnLoading] = useState(false);
  const [lockDurationSeconds, setLockDurationSeconds] = useState<number>(DEFAULT_VAULT_UNLOCK_SECONDS);
  const [lockDurationOnChainSeconds, setLockDurationOnChainSeconds] = useState<number | null>(null);
  const [lockConfigLoading, setLockConfigLoading] = useState(false);
  const [lockConfigLoaded, setLockConfigLoaded] = useState(false);
  const [lockConfigStatus, setLockConfigStatus] = useState<string | null>(null);

  async function postWriteRefresh(reason: string) {
    await Promise.allSettled([
      refreshLockDurationConfig(vaultAddress),
      refreshVaultLinks(vaultAddress),
      (metrics as any)?.refresh?.(),
    ]);
    emitUiRefresh(`vault:${reason}`);
  }

  async function refreshVaultLinks(activeAddress = vaultAddress) {
    if (!isValidAddress(activeAddress)) return;
    try {
      const vaultRead = new Contract(
        activeAddress,
        ['function treasury() view returns (address)', 'function escrow() view returns (address)'],
        provider
      );
      const [treasuryAddr, escrowAddr] = await Promise.all([
        vaultRead.treasury().catch(() => null),
        vaultRead.escrow().catch(() => null),
      ]);
      const safeTreasury = typeof treasuryAddr === 'string' ? treasuryAddr : '';
      const safeEscrow = typeof escrowAddr === 'string' ? escrowAddr : '';
      setLinkedTreasuryAddress(safeTreasury);
      setLinkedEscrowAddress(safeEscrow);
      if (isValidAddress(safeTreasury)) setTreasuryLinkInput(safeTreasury);
      if (isValidAddress(safeEscrow)) setEscrowLinkInput(safeEscrow);
    } catch {
      // ignore link-read errors for non-vault addresses
    }
  }

  async function refreshLockDurationConfig(activeAddress = vaultAddress) {
    try {
      if (!isValidAddress(activeAddress)) return;
      const vaultRead = new Contract(activeAddress, ['function lockDuration() view returns (uint64)'], provider);
      const raw = await vaultRead.lockDuration();
      const secs = Number(raw);
      if (Number.isFinite(secs) && secs > 0) {
        setLockDurationOnChainSeconds(secs);
        if (!lockConfigLoaded) {
          setLockDurationSeconds(secs);
          setLockConfigLoaded(true);
        }
      }
    } catch {
      // ignore config-read failures in UI
    }
  }

  useEffect(() => {
    setVaultAddressInput(vaultAddress);
    refreshLockDurationConfig(vaultAddress);
    refreshVaultLinks(vaultAddress);
  }, [vaultAddress]);

  function handleSaveVaultAddress() {
    const next = vaultAddressInput.trim();
    if (!setRuntimeAddress('Vault', next)) {
      setLinkConfigStatus('Invalid Vault address');
      return;
    }
    setVaultAddressState(next);
    setLinkConfigStatus(`Using Vault ${next}`);
  }

  async function handleSetVaultTreasuryLink() {
    const treasuryAddr = treasuryLinkInput.trim();
    if (!isValidAddress(vaultAddress) || !isValidAddress(treasuryAddr)) {
      setLinkConfigStatus('Invalid Vault or Treasury address');
      return;
    }

    try {
      setLinkConfigLoading(true);
      setLinkConfigStatus(null);
      const signer = new Wallet(TEST_PRIVATE_KEY, provider);
      const vaultWrite = new Contract(vaultAddress, ['function setTreasury(address _treasury) external'], signer);
      const tx = await vaultWrite.setTreasury(treasuryAddr);
      await tx.wait();
      setRuntimeAddress('Treasury', treasuryAddr);
      setLinkedTreasuryAddress(treasuryAddr);
      setLinkConfigStatus('Vault -> Treasury linked');
      await postWriteRefresh('link-treasury');
    } catch (e: any) {
      setLinkConfigStatus(`Link failed: ${String(e?.message || e)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

  async function handleSetVaultEscrowLink() {
    const escrowAddr = escrowLinkInput.trim();
    if (!isValidAddress(vaultAddress) || !isValidAddress(escrowAddr)) {
      setLinkConfigStatus('Invalid Vault or Escrow address');
      return;
    }

    try {
      setLinkConfigLoading(true);
      setLinkConfigStatus(null);
      const signer = new Wallet(TEST_PRIVATE_KEY, provider);
      const vaultWrite = new Contract(vaultAddress, ['function setEscrow(address _escrow) external'], signer);
      const tx = await vaultWrite.setEscrow(escrowAddr);
      await tx.wait();
      setRuntimeAddress('InvestmentEscrow', escrowAddr);
      setLinkedEscrowAddress(escrowAddr);
      setLinkConfigStatus('Vault -> Escrow linked');
      await postWriteRefresh('link-escrow');
    } catch (e: any) {
      setLinkConfigStatus(`Link failed: ${String(e?.message || e)}`);
    } finally {
      setLinkConfigLoading(false);
    }
  }

  async function handleSetLockDuration() {
    try {
      if (!isValidAddress(vaultAddress)) {
        setLockConfigStatus('Invalid Vault address');
        return;
      }
      setLockConfigLoading(true);
      setLockConfigStatus(null);

      const signer = new Wallet(TEST_PRIVATE_KEY, provider);
      const vaultWrite = new Contract(
        vaultAddress,
        ['function setLockDuration(uint64 _duration) external'],
        signer
      );

      const tx = await vaultWrite.setLockDuration(BigInt(lockDurationSeconds));
      await tx.wait();
      setLockDurationOnChainSeconds(lockDurationSeconds);
      setLockConfigLoaded(true);
      setLockConfigStatus(`Updated to ${formatSecondsLabel(lockDurationSeconds)}`);
      await postWriteRefresh('set-lock-duration');
    } catch (e: any) {
      setLockConfigStatus(`Update failed: ${String(e?.message || e)}`);
    } finally {
      setLockConfigLoading(false);
    }
  }

  async function handleReturnDeposit() {
    if (isPaused || !isOperator) return;
    if (!provider || !isValidAddress(vaultAddress)) return;
    const id = Number(returnTokenId);
    if (!Number.isFinite(id) || id < 0) {
      console.log(`[return] invalid token id: ${returnTokenId}`);
      return;
    }

    setReturnLoading(true);
    try {
      const signer = new Wallet(TEST_PRIVATE_KEY, provider);
      const vaultWrite = new Contract(vaultAddress, VAULT_ABI_NORM, signer);

      try {
        const tx = await vaultWrite.autoReturn(id);
        await tx.wait();
        console.log(`[return] autoReturn(${id}) tx=${tx.hash}`);
        await postWriteRefresh('auto-return');
        setReturnTokenId('');
        return;
      } catch (err: any) {
        const msg = String(err?.message || err);
        console.warn('[return] autoReturn failed:', msg);

        if (msg.includes('Deposit still locked') || msg.includes('still locked')) {
          try {
            if (typeof vaultWrite.adminForceReturn === 'function') {
              const tx2 = await vaultWrite.adminForceReturn(id);
              await tx2.wait();
              console.log(`[return] adminForceReturn(${id}) tx=${tx2.hash}`);
              await postWriteRefresh('admin-force-return');
              setReturnTokenId('');
              return;
            }
            console.warn('[return] adminForceReturn() not available on Vault ABI');
          } catch (adminErr: any) {
            console.error('[return] adminForceReturn failed:', String(adminErr?.message || adminErr));
          }
        }

        throw err;
      }
    } catch (e: any) {
      console.error('[return ERROR]', String(e?.message || e));
    } finally {
      setReturnLoading(false);
    }
  }

  const lastUpdated = metrics.updatedAt ? new Date(metrics.updatedAt).toLocaleTimeString() : '--';
  const totalReturns = metrics.autoReturnedCount + metrics.manualReturnedCount;
  const successTone: 'neutral' | 'success' | 'warning' | 'danger' =
    totalReturns === 0
      ? 'warning'
      : metrics.autoReturnRatePct >= 70
        ? 'success'
        : metrics.autoReturnRatePct >= 40
          ? 'warning'
          : 'danger';

  return (
    <div className="tab-screen">
      <PageHeader
        title="Vault Status"
        description="Monitor lock state, reserve-backed capacity, and return execution across the active receipt set."
        meta={
          <>
            <span className="data-chip"><Clock size={12} /> Updated: {lastUpdated}</span>
            <span className="data-chip">Vault: {shortenAddress(vaultAddress)}</span>
            <span className="data-chip">Locked: {formatSecondsLabel(lockDurationOnChainSeconds ?? lockDurationSeconds)}</span>
            <span className="data-chip" data-tone={isOperator ? 'warning' : 'neutral'}>Role: {role}</span>
            <span className="data-chip" data-tone={metrics.loading ? 'warning' : 'success'}>
              {metrics.loading ? 'Syncing' : 'Live'}
            </span>
          </>
        }
      />

      {metrics.error && (
        <div className="sagitta-hero">
          <div className="sagitta-cell status-banner status-banner--danger">
            Error loading vault metrics: {metrics.error}
          </div>
        </div>
      )}

      <section className="sagitta-hero">
        <div className="sagitta-cell">
          <h3 className="section-title">Operational Snapshot</h3>
          <p className="section-subtitle">A fast read on open receipts, current backlog, and the share of returns completed automatically.</p>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Open receipts</div>
              <div className="mt-2 text-2xl font-semibold text-slate-100">{metrics.activeLocks}</div>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Matured backlog</div>
              <div className="mt-2 text-2xl font-semibold text-amber-300">{metrics.maturedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-900/35 p-3 sm:col-span-2 2xl:col-span-1">
              <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Auto return</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-300">{metrics.autoReturnRatePct.toFixed(1)}%</div>
            </div>
          </div>
        </div>
      </section>

      <div className="sagitta-grid sagitta-grid--standard">
        <div className="sagitta-cell">
          <h3 className="section-title">Total Value Locked (USD)</h3>
          <MetricCard
            title="TVL"
            value={metrics.tvlUsd}
            hint={`${metrics.activeCount} open deposits`}
            tone="success"
            icon={<Lock />}
          />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Active Locks (NFTs)</h3>
          <MetricCard
            title="Open receipts"
            value={String(metrics.activeLocks)}
            hint={metrics.activeUsd}
            tone="neutral"
            icon={<Layers />}
          />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Unique Depositors</h3>
          <MetricCard
            title="Active wallets"
            value={String(metrics.uniqueDepositors)}
            hint={`${metrics.activeCount} open deposits`}
            tone="neutral"
            icon={<Users />}
          />
        </div>
        <div className="sagitta-cell">
          <h3 className="section-title">Auto-Return Success Rate</h3>
          <MetricCard
            title="Auto return ratio"
            value={`${metrics.autoReturnRatePct.toFixed(2)}%`}
            hint={`${metrics.autoReturnedCount} auto / ${metrics.manualReturnedCount} manual`}
            tone={successTone}
            icon={<Repeat />}
          />
        </div>
      </div>

      <div className="sagitta-grid sagitta-grid--wide">
        <div className="sagitta-cell h-full">
          <h3 className="section-title">Vault Lifecycle Snapshot</h3>
          <p className="section-subtitle">Balance the active principal, matured backlog, and remaining reserve headroom before forcing any manual returns.</p>
          <div className="panel-stack">
            <div className="panel-row">
              <span className="panel-row__label">Matured deposits</span>
              <span className="panel-row__value">{metrics.maturedCount} ({metrics.maturedUsd})</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Active principal</span>
              <span className="panel-row__value">{metrics.activeUsd}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Reserve capacity remaining</span>
              <span className="panel-row__value">{formatUsd6(metrics.maxAvailableUsd6)}</span>
            </div>
            <div className="panel-row">
              <span className="panel-row__label">Linked treasury / escrow</span>
              <span className="panel-row__value">
                {shortenAddress(linkedTreasuryAddress)} / {shortenAddress(linkedEscrowAddress)}
              </span>
            </div>
          </div>
          <div className="mt-4 panel-note">
            {metrics.maturedCount > 0
              ? 'Matured receipts are pending return execution or manual handling.'
              : 'No matured receipts currently awaiting return.'}
          </div>
        </div>

        <div className="sagitta-cell h-full">
          <h3 className="section-title">Admin Controls</h3>
          {isOperator ? (
            <>
              <p className="section-subtitle">Use the local operator signer for one-off return handling when matured receipts need intervention.</p>
              <div className="flex flex-col gap-3 p-1 mt-2">
                <label className="text-slate-300 font-medium mb-1">Manual Return (receipt ID)</label>
                <input
                  type="number"
                  min="0"
                  className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
                  value={returnTokenId}
                  onChange={e => setReturnTokenId(e.target.value)}
                  placeholder="receipt token id"
                  disabled={isPaused || returnLoading || metrics.loading}
                />

                <button
                  className="action-button action-button--success"
                  onClick={handleReturnDeposit}
                  disabled={isPaused || returnLoading || metrics.loading}
                >
                  {returnLoading ? 'Returning...' : 'Return Deposit'}
                </button>

                <div className="panel-note">
                  {isPaused
                    ? 'Protocol is paused. Manual return actions are disabled until the protocol is resumed.'
                    : 'Executes `Vault.autoReturn(tokenId)` using local test signer. Use only for local/testnet ops.'}
                </div>

                <div className="mt-3 panel-stack">
                  <div className="text-sm font-semibold text-slate-200">Execution Summary</div>
                  <div className="panel-row">
                    <span className="panel-row__label">Auto returns executed</span>
                    <span className="panel-row__value">{metrics.autoReturnedCount}</span>
                  </div>
                  <div className="panel-row">
                    <span className="panel-row__label">Manual returns executed</span>
                    <span className="panel-row__value">{metrics.manualReturnedCount}</span>
                  </div>
                  <div className="panel-row">
                    <span className="panel-row__label">Matured backlog</span>
                    <span className="panel-row__value text-amber-300">{metrics.maturedCount}</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="panel-note mt-3">
              Vault write controls are hidden for viewer wallets. Connect an operator or owner wallet to reveal manual return actions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
