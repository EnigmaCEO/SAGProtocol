import Tag from '../ui/Tag';
import Button from '../ui/Button';

interface TopBarProps {
  network: string;
  chainId?: number;
  address?: string;
  paused?: boolean;
  onSwitch?: () => void;
}

export default function TopBar({ address, paused, network }: TopBarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        {paused && (
          <div className="px-3 py-1 rounded-full bg-rose-500/20 border border-rose-500/30 text-rose-400 text-sm font-medium flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
            </span>
            Protocol Paused
          </div>
        )}
      </div>
      
      <div className="flex items-center gap-4">
        {network && (
          <span className="hidden sm:inline text-sm text-slate-400 capitalize">
            {network}
          </span>
        )}
        <div className="px-4 py-2 rounded-full bg-slate-800/60 border border-slate-700 text-sm font-mono text-slate-300">
          {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Not Connected'}
        </div>
      </div>
    </div>
  );
}
