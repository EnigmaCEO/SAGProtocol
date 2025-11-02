import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, Scale, Gem } from 'lucide-react';

export default function ReserveTab() {
  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          Reserve Status
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <MetricGrid>
        <MetricCard title="Net Asset Value (NAV)" value="$1.0012" tone="success" />
        <MetricCard title="Gold Balance" value="1,250 oz" tone="neutral" icon={<Gem />} />
        <MetricCard title="Oracle Price" value="$1.0010" tone="neutral" />
        <MetricCard title="Coverage Ratio" value="105.2%" tone="success" icon={<Scale />} />
      </MetricGrid>

      <div className="max-w-md">
        <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">Operator: Set Price</h3>
          <input type="text" placeholder="New Oracle Price" className="w-full px-4 py-3 rounded-full bg-slate-900/70 border border-slate-700 mb-4 focus:ring-2 focus:ring-amber-500/50 outline-none" />
          <button className="w-full px-6 py-3 rounded-full bg-amber-600 text-white font-bold transition-all duration-300 hover:bg-amber-500 hover:shadow-[0_0_20px_theme(colors.amber.500)]">Set Price</button>
        </div>
      </div>
    </div>
  );
}
