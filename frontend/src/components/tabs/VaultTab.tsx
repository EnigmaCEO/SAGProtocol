import { Clock, Lock, BarChart, Percent } from 'lucide-react';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';

export default function VaultTab() {
  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          Vault Status
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <MetricGrid>
        <MetricCard title="Total Value Locked" value="$1,234,567" tone="success" icon={<Lock />} />
        <MetricCard title="Active Locks" value="4,321" tone="neutral" icon={<BarChart />} />
        <MetricCard title="Average Lock Time" value="180 Days" tone="neutral" />
        <MetricCard title="Current Yield Rate" value="8.75%" hint="APY" tone="success" icon={<Percent />} />
      </MetricGrid>

      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg border border-slate-700/50 overflow-hidden">
        <h3 className="text-lg font-semibold text-slate-200 p-6">Vault Operations</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-sky-700/40">
              <tr className="text-sm text-slate-400">
                <th className="p-4">Operation</th>
                <th className="p-4">User</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              <tr className="hover:bg-slate-800/40 transition-colors duration-300 border-t border-slate-800">
                <td className="p-4 text-emerald-400">Lock</td>
                <td className="p-4 font-mono">0xabc...123</td>
                <td className="p-4 font-mono text-amber-300">1,000 SAG</td>
                <td className="p-4">2023-10-27 10:30 AM</td>
              </tr>
              <tr className="bg-slate-900/20 hover:bg-slate-800/40 transition-colors duration-300 border-t border-slate-800">
                <td className="p-4 text-sky-400">Extend Lock</td>
                <td className="p-4 font-mono">0xdef...456</td>
                <td className="p-4 font-mono text-amber-300">500 SAG</td>
                <td className="p-4">2023-10-27 09:15 AM</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
