import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, ArrowDown, ArrowUp } from 'lucide-react';

export default function UserTab() {
  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          User Dashboard
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <MetricGrid>
        <MetricCard title="Your SAG Balance" value="1,250.75" hint="SAG" tone="success" />
        <MetricCard title="Total Deposited" value="500.00" hint="SAG" tone="neutral" />
        <MetricCard title="Available to Deposit" value="750.75" hint="SAG" tone="neutral" />
        <MetricCard title="Claimable Rewards" value="12.50" hint="+2.5% APY" tone="success" />
      </MetricGrid>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
          <h3 className="text-lg font-semibold mb-4 text-slate-200 flex items-center gap-2"><ArrowDown size={20} className="text-emerald-400"/>Deposit SAG</h3>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="Amount to deposit" 
              className="w-full px-4 py-3 rounded-full bg-slate-900/70 border border-slate-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/50 text-slate-200 placeholder-slate-500 outline-none transition-all"
            />
            <button className="w-full px-6 py-3 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.sky.500)]">
              Deposit
            </button>
          </div>
        </div>

        <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
          <h3 className="text-lg font-semibold mb-4 text-slate-200 flex items-center gap-2"><ArrowUp size={20} className="text-rose-400"/>Withdraw SAG</h3>
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="Amount to withdraw" 
              className="w-full px-4 py-3 rounded-full bg-slate-900/70 border border-slate-700 focus:border-slate-500 focus:ring-2 focus:ring-slate-500/50 text-slate-200 placeholder-slate-500 outline-none transition-all"
            />
            <button className="w-full px-6 py-3 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold transition-colors duration-300">
              Withdraw
            </button>
          </div>
        </div>
      </div>

      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg border border-slate-700/50 overflow-hidden">
        <h3 className="text-lg font-semibold text-slate-200 p-6">Recent Transactions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b-2 border-sky-700/40">
              <tr className="text-sm text-slate-400">
                <th className="p-4">Type</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Date</th>
                <th className="p-4">Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              <tr className="hover:bg-slate-800/40 transition-colors duration-300 border-t border-slate-800">
                <td className="p-4 text-emerald-400">Deposit</td>
                <td className="p-4 font-mono text-amber-300">500.00 SAG</td>
                <td className="p-4">2023-10-27</td>
                <td className="p-4 font-mono text-sky-400 hover:text-sky-300">0x123...abc</td>
              </tr>
              <tr className="bg-slate-900/20 hover:bg-slate-800/40 transition-colors duration-300 border-t border-slate-800">
                <td className="p-4 text-rose-400">Withdraw</td>
                <td className="p-4 font-mono text-amber-300">100.00 SAG</td>
                <td className="p-4">2023-10-26</td>
                <td className="p-4 font-mono text-sky-400 hover:text-sky-300">0x456...def</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
