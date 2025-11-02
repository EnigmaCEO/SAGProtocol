import { ReactNode } from 'react';

interface MetricCardProps {
  title: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
}

const valueToneClasses = {
  neutral: 'text-slate-100',
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-rose-400',
};

export default function MetricCard({ title, value, hint, tone = 'neutral', icon }: MetricCardProps) {
  return (
    <div className="group bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-lg border border-slate-700/50 p-6 transition-all duration-300 ease-in-out hover:scale-[1.02] hover:border-sky-500/30 hover:shadow-sky-500/10">
      <div className="flex justify-between items-start">
        <div className="text-sm text-slate-400">{title}</div>
        {icon && <div className="text-slate-500 group-hover:text-sky-400 transition-colors">{icon}</div>}
      </div>
      <div className={`mt-2 text-3xl font-bold ${valueToneClasses[tone]}`}>{value}</div>
      {hint && <div className="text-xs text-amber-300 mt-1 font-mono">{hint}</div>}
    </div>
  );
}
