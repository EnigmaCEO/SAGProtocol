import { ReactNode } from 'react';

interface TagProps {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}

const toneClasses = {
  neutral: 'bg-slate-700/60 text-slate-200',
  success: 'bg-emerald-600/30 text-emerald-300',
  warning: 'bg-amber-600/30 text-amber-300',
  danger: 'bg-rose-600/30 text-rose-300',
};

export default function Tag({ tone = 'neutral', children }: TagProps) {
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}
