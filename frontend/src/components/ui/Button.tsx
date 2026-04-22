import { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  className?: string;
}

const variantClasses = {
  primary: 'border border-[rgba(212,168,48,0.4)] text-[rgba(255,238,170,0.95)] bg-[linear-gradient(135deg,rgba(198,154,36,0.95),rgba(148,104,16,0.92))] hover:border-[rgba(212,168,48,0.6)] hover:brightness-110 shadow-[0_8px_20px_rgba(80,50,0,0.3)]',
  ghost: 'border border-[rgba(180,140,20,0.2)] bg-[rgba(8,13,24,0.8)] hover:bg-[rgba(12,20,34,0.9)] hover:border-[rgba(180,140,20,0.36)] text-[var(--text-300)] hover:text-[var(--text-100)]',
  danger: 'border border-[rgba(220,80,80,0.4)] text-rose-100 bg-[linear-gradient(135deg,rgba(175,60,60,0.96),rgba(135,35,35,0.93))] hover:border-rose-400/55 hover:brightness-110',
};

export default function Button({
  children,
  onClick,
  loading,
  variant = 'primary',
  disabled,
  className,
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`
        px-4 py-2 rounded-lg font-semibold transition-all duration-200
        hover:translate-y-[-1px]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none
        ${variantClasses[variant]}
        ${className ?? ''}
      `}
    >
      {loading ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
          <span>Loading...</span>
        </div>
      ) : (
        children
      )}
    </button>
  );
}
