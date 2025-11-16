import { Clock, Lock, Users, Layers, Repeat } from 'lucide-react';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import useVaultMetrics from '../../hooks/useVaultMetrics';
import { CONTRACT_ADDRESSES } from '../../lib/addresses';
import { useState } from 'react';
import { Wallet, Contract, JsonRpcProvider } from 'ethers';
import VAULT_ABI from '../../lib/abis/Vault.json';

// derive vault address from frontend addresses artifact
const VAULT_ADDRESS = CONTRACT_ADDRESSES.Vault;
// local test private key (Hardhat default) — keep local to avoid depending on a config module
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
// local provider (consistent with other tabs)
const LOCALHOST_RPC = "http://127.0.0.1:8545";
const provider = new JsonRpcProvider(LOCALHOST_RPC);

export default function VaultTab() {
  const metrics = useVaultMetrics();

  // Add local state for manual return control
  const [returnTokenId, setReturnTokenId] = useState<string>('');
  const [returnLoading, setReturnLoading] = useState(false);

  // NEW: manual return handler
  async function handleReturnDeposit() {
    if (!provider) return;
    const id = Number(returnTokenId);
    if (!Number.isFinite(id) || id < 0) {
      console.log(`[return] invalid token id: ${returnTokenId}`);
      return;
    }
    setReturnLoading(true);
    try {
      const signer = new Wallet(TEST_PRIVATE_KEY, provider);
      const vaultWrite = new Contract(VAULT_ADDRESS, VAULT_ABI, signer);
      // Try normal owner-as-user autoReturn first (will revert if still locked)
      try {
        const tx = await vaultWrite.autoReturn(id);
        await tx.wait();
        console.log(`[return] autoReturn(${id}) tx=${tx.hash}`);
        try { (metrics as any)?.refresh?.(); } catch {}
        setReturnLoading(false);
        return;
      } catch (err: any) {
        const msg = String(err?.message || err);
        console.warn('[return] autoReturn failed:', msg);
        // If revert reason indicates lock and signer is owner, try admin fallback
        if (msg.includes('Deposit still locked') || msg.includes('still locked')) {
          try {
            // attempt owner-only forced return
            if (typeof vaultWrite.adminForceReturn === 'function') {
              const tx2 = await vaultWrite.adminForceReturn(id);
              await tx2.wait();
              console.log(`[return] adminForceReturn(${id}) tx=${tx2.hash}`);
              try { (metrics as any)?.refresh?.(); } catch {}
              setReturnLoading(false);
              return;
            } else {
              console.warn('[return] adminForceReturn() not available on Vault ABI');
            }
          } catch (adminErr: any) {
            console.error('[return] adminForceReturn failed:', String(adminErr?.message || adminErr));
            // fall through to rethrow original
          }
        }
        // rethrow original to outer catch if fallback not performed or failed
        throw err;
      }
    } catch (e:any) {
      console.error('[return ERROR]', String(e?.message || e));
    } finally {
      setReturnLoading(false);
    }
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          Vault Status
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>
            Last updated:{' '}
            {metrics.updatedAt ? new Date(metrics.updatedAt).toLocaleTimeString() : '—'}
          </span>
        </div>
      </div>

      {/* show runtime errors from the hook */}
      {metrics.error && (
        <div className="text-sm text-red-400 bg-red-900/10 p-3 rounded-md">
          Error loading vault metrics: {metrics.error}
        </div>
      )}

      {/* show loading indicator */}
      {metrics.loading && (
        <div className="text-sm text-slate-400">Loading vault metrics...</div>
      )}

      <MetricGrid>
        <MetricCard title="Total Value Locked" value={metrics.tvlUsd} tone="success" icon={<Lock />} />
        <MetricCard
          title="Active Locks (NFTs)"
          value={String(metrics.activeLocks)}
          tone="neutral"
          icon={<Layers />}
        />
        <MetricCard
          title="Unique Depositors"
          value={String(metrics.uniqueDepositors)}
          tone="neutral"
          icon={<Users />}
        />
        <MetricCard
          title="Auto-Return Success Rate"
          value={`${metrics.autoReturnRatePct.toFixed(2)}%`}
          hint="success rate"
          tone={metrics.autoReturnRatePct >= 50 ? 'success' : 'danger'}
          icon={<Repeat />}
        />
      </MetricGrid>

      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg border border-slate-700/50 overflow-hidden p-6">
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Active vs Matured Deposits</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-slate-900/30 rounded-lg">
            <div className="text-sm text-slate-400">Active Deposits</div>
            <div className="mt-2 text-2xl font-mono text-amber-300">{metrics.activeCount}</div>
            <div className="text-sm text-slate-300 mt-1">{metrics.activeUsd}</div>
          </div>

          <div className="p-4 bg-slate-900/30 rounded-lg">
            <div className="text-sm text-slate-400">Matured Deposits</div>
            <div className="mt-2 text-2xl font-mono text-sky-400">{metrics.maturedCount}</div>
            <div className="text-sm text-slate-300 mt-1">{metrics.maturedUsd}</div>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* NEW: Manual Return Deposit control */}
        <h3 className="text-lg font-semibold text-slate-200 mb-4">Admin Controls</h3>
        <div className="flex flex-col gap-3 p-2">
          <label className="text-slate-300 font-medium mb-1">Manual Return (receipt ID)</label>
          <input
            type="number"
            min="1"
            className="px-3 py-2 rounded bg-slate-900 border border-slate-700 text-slate-100"
            value={returnTokenId}
            onChange={e => setReturnTokenId(e.target.value)}
            placeholder="receipt token id"
          />
          <button
            className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
            onClick={handleReturnDeposit}
            disabled={returnLoading || metrics.loading}
          >
            {returnLoading ? 'Returning...' : 'Return Deposit'}
          </button>
          <div className="text-xs text-slate-500 mt-2">
            Calls Vault.autoReturn(tokenId). Caller uses the local test signer (Hardhat default). Only works if signer owns the receipt or contract logic permits.
          </div>
        </div>
      </div>
    </div>
  );
}
