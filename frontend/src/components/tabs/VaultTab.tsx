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
      <div className="sagitta-hero">
        <div className="sagitta-cell">
          <h2 style={{ marginBlockStart: '0.3em' }}>Vault Status</h2>
          <div className="text-slate-400 text-sm mt-1">Monitor vault deposits in real time.</div>
          <div style={{ height: 12 }} />
          <Clock size={16} />
          <span> Last updated: {metrics.updatedAt ? new Date(metrics.updatedAt).toLocaleTimeString() : '—'} </span>
          <div style={{ height: 12 }} />
          {/* show runtime errors from the hook */}
          {metrics.error && (
            <div className="text-sm text-red-400 bg-red-900/10 p-3 rounded-md">
              Error loading vault metrics: {metrics.error}
            </div>
          )}
          <div style={{ height: 12 }} />
          {/* show loading indicator */}
          {metrics.loading && (
            <div className="text-sm text-slate-400">Loading vault metrics...</div>
          )}
        </div>
      </div>

      <div className="sagitta-grid" style={{ gridTemplateColumns: 'repeat(4, 2fr)' }}>
        {/* Cell 1 */}
        <div className="sagitta-cell">
        <h3>Total Value Locked (USD)</h3>
          <MetricGrid>
          <MetricCard title="" value={metrics.tvlUsd} tone="success" icon={<Lock />} />
          
            </MetricGrid>
        </div>
        {/* Cell 2 */}
        <div className="sagitta-cell">
          <h3>Active Locks (NFTs)</h3>
          <MetricCard
            title=""
            value={String(metrics.activeLocks)}
            tone="neutral"
            icon={<Layers />}
          />
        </div>
        {/* Cell 3 */}
        <div className="sagitta-cell">
          <h3>Unique Depositors</h3>
          <MetricCard
          title=""
          value={String(metrics.uniqueDepositors)}
          tone="neutral"
          icon={<Users />}
        />
        </div>
        {/* Cell 4 */}
        <div className="sagitta-cell">
          <h3>Auto-Return Success Rate</h3>
          <MetricCard
          title=""
          value={`${metrics.autoReturnRatePct.toFixed(2)}% success rate`}
          tone={metrics.autoReturnRatePct >= 50 ? 'success' : 'danger'}
          icon={<Repeat />}
        />
        </div>
        {/* Cell 5*/}
        <div className="sagitta-cell">
          <h3>Matured Deposits (USD)</h3>
          <div className="mt-2 text-2xl font-mono text-sky-400">{metrics.maturedCount}</div>
          <div className="text-sm text-slate-300 mt-1">{metrics.maturedUsd}</div>
        </div>
        {/* Cell 6*/}
        <div className="sagitta-cell" style={{ gridColumn: 'span 3' }}>
          <h3>Admin Controls</h3>
          <div className="flex flex-col gap-3 p-2">
            <label className="text-slate-300 font-medium mb-1">Manual Return (receipt ID) </label>
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
              Calls Vault.autoReturn(tokenId). Caller uses the local test signer (Hardhat default).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
