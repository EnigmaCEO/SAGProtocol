import { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}

const variantClasses = {
  primary: 'border border-sky-500/40 text-slate-100 bg-[linear-gradient(120deg,rgba(39,121,178,0.95),rgba(34,83,129,0.92))] hover:border-sky-400/55 hover:brightness-110',
  ghost: 'border border-slate-600/55 bg-slate-900/65 hover:bg-slate-800/75 text-slate-200',
  danger: 'border border-rose-500/45 text-rose-100 bg-[linear-gradient(120deg,rgba(176,53,53,0.95),rgba(130,37,37,0.92))] hover:border-rose-400/55 hover:brightness-110',
};

export default function Button({ 
  children, 
  onClick, 
  loading, 
  variant = 'primary',
  disabled 
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`
        px-4 py-2 rounded-lg font-medium transition-all duration-200
        shadow-[0_8px_20px_rgba(6,16,30,0.45)] hover:translate-y-[-1px]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${variantClasses[variant]}
      `}
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      ) : (
        children
      )}
    </button>
  );
}
