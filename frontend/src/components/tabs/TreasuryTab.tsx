import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, Download, Flame, Landmark } from 'lucide-react';

export default function TreasuryTab() {
  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          Treasury Overview
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <MetricGrid>
        <MetricCard title="Treasury Balance" value="$5,678,910" tone="success" icon={<Landmark />} />
        <MetricCard title="Allocated Funds" value="$2,100,000" tone="neutral" />
        <MetricCard title="Available for Grants" value="$3,578,910" tone="success" />
        <MetricCard title="Monthly Burn Rate" value="0.5%" tone="warning" />
      </MetricGrid>

      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
        <h3 className="text-lg font-semibold mb-4 text-slate-200">Treasury Operations</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button className="flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.sky.500)]">
            <Download size={18} />
            <span>Allocate Funds</span>
          </button>
          <button className="flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-amber-600 text-white font-bold transition-all duration-300 hover:bg-amber-500 hover:shadow-[0_0_20px_theme(colors.amber.500)]">
            <Flame size={18} />
            <span>Execute Token Burn</span>
          </button>
        </div>
      </div>
    </div>
  );
}
