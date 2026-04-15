import { ReactNode } from 'react';

interface TagProps {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}

const toneClasses = {
  neutral: 'bg-slate-900/75 border border-slate-600/45 text-slate-200',
  success: 'bg-amber-950/55 border border-amber-600/40 text-amber-300',
  warning: 'bg-amber-950/55 border border-amber-500/45 text-amber-300',
  danger: 'bg-rose-950/55 border border-rose-500/45 text-rose-300',
};

export default function Tag({ tone = 'neutral', children }: TagProps) {
  return (
    <span className={`px-3 py-1 rounded-full text-[11px] uppercase tracking-[0.16em] font-semibold ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}
