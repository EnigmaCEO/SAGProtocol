import { ReactNode } from 'react';

interface MetricCardProps {
  title?: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  icon?: ReactNode;
}

const toneStyles = {
  neutral: {
    value: 'text-slate-100',
    rule: 'from-slate-500/30 to-slate-400/5',
    icon: 'text-slate-400',
  },
  success: {
    value: 'text-emerald-300',
    rule: 'from-emerald-500/50 to-emerald-500/5',
    icon: 'text-emerald-300',
  },
  warning: {
    value: 'text-amber-300',
    rule: 'from-amber-500/50 to-amber-500/5',
    icon: 'text-amber-300',
  },
  danger: {
    value: 'text-rose-300',
    rule: 'from-rose-500/50 to-rose-500/5',
    icon: 'text-rose-300',
  },
};

export default function MetricCard({ title, value, hint, tone = 'neutral', icon }: MetricCardProps) {
  const styles = toneStyles[tone];
  const hasHeader = Boolean(title || icon);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-slate-700/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.005)),rgba(12,20,33,0.88)] p-4 shadow-[0_10px_24px_rgba(2,8,18,0.5)] transition-all duration-200 hover:border-slate-500/45 hover:translate-y-[-1px]">
      <div className={`absolute left-3 right-3 top-0 h-px bg-gradient-to-r ${styles.rule}`} />

      {hasHeader && (
        <div className="flex justify-between items-start gap-2">
          {title ? (
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400 font-semibold">
              {title}
            </div>
          ) : (
            <div />
          )}
          {icon && <div className={`${styles.icon} opacity-90 transition-opacity group-hover:opacity-100`}>{icon}</div>}
        </div>
      )}

      <div className={`${hasHeader ? 'mt-3' : ''} text-2xl sm:text-[1.7rem] leading-tight kpi-value ${styles.value}`}>
        {value}
      </div>

      {hint && <div className="text-xs text-slate-300/90 mt-2 kpi-value">{hint}</div>}
    </div>
  );
}
