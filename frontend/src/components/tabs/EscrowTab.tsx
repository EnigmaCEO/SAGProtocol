import React from 'react';
import MetricGrid from '../ui/MetricGrid';
import MetricCard from '../ui/MetricCard';
import { Clock, ShieldCheck, Handshake } from 'lucide-react';

export default function EscrowTab() {
  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          Escrow Management
        </h2>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Clock size={16} />
          <span>Last updated: {new Date().toLocaleTimeString()}</span>
        </div>
      </div>

      <MetricGrid>
        <MetricCard title="Total Escrowed" value="$850,000" tone="neutral" icon={<ShieldCheck />} />
        <MetricCard title="Active Deals" value="42" tone="success" icon={<Handshake />} />
        <MetricCard title="Total Returned" value="$1,200,000" tone="neutral" />
      </MetricGrid>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">Open Investment</h3>
          <input type="text" placeholder="Amount" className="w-full px-4 py-3 rounded-full bg-slate-900/70 border border-slate-700 mb-4 focus:ring-2 focus:ring-sky-500/50 outline-none" />
          <button className="w-full px-6 py-3 rounded-full bg-gradient-to-r from-sky-500 to-indigo-600 text-white font-bold transition-all duration-300 hover:shadow-[0_0_20px_theme(colors.sky.500)]">Open</button>
        </div>
        <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">Close Investment</h3>
          <input type="text" placeholder="Investment ID" className="w-full px-4 py-3 rounded-full bg-slate-900/70 border border-slate-700 mb-4 focus:ring-2 focus:ring-slate-500/50 outline-none" />
          <button className="w-full px-6 py-3 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold transition-colors">Close</button>
        </div>
      </div>

      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg p-6 border border-slate-700/50">
        <h3 className="text-lg font-semibold mb-4 text-slate-200">Your Investments</h3>
        <p className="text-slate-400">Investment history will be displayed here.</p>
      </div>
    </div>
  );
}
