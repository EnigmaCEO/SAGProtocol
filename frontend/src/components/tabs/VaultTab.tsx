import { Clock, Lock, Users, Layers, Repeat } from 'lucide-react';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import useVaultMetrics from '../../hooks/useVaultMetrics';

export default function VaultTab() {
  const metrics = useVaultMetrics();

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
    </div>
  );
}
