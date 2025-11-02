import { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
}

const variantClasses = {
  primary: 'bg-sky-600 hover:bg-sky-700 text-white',
  ghost: 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-200',
  danger: 'bg-rose-600 hover:bg-rose-700 text-white',
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
        px-4 py-2 rounded-lg font-medium transition-all duration-300
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
