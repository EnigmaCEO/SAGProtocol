import { User, Vault, Building2, Shield, DollarSign, Users } from 'lucide-react';
import { useRouter } from 'next/router';

type Tab = 'user' | 'vault' | 'treasury' | 'escrow' | 'reserve' | 'dao';

interface SidebarTabsProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

const tabs = [
  { id: 'user' as Tab, label: 'User', icon: User },
  { id: 'vault' as Tab, label: 'Vault', icon: Vault },
  { id: 'treasury' as Tab, label: 'Treasury', icon: Building2 },
  { id: 'escrow' as Tab, label: 'Escrow', icon: Shield },
  { id: 'reserve' as Tab, label: 'Reserve', icon: DollarSign },
  { id: 'dao' as Tab, label: 'DAO', icon: Users },
];

export default function SidebarTabs({ active, onChange }: SidebarTabsProps) {
  const router = useRouter();

  const handleTabClick = (tabId: Tab) => {
    onChange(tabId);
    router.push(`/?tab=${tabId}`, undefined, { shallow: true });
  };

  return (
    <div className="space-y-8">
      {/* Logo/Title */}
      <div className="px-2 py-2">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-400 via-indigo-500 to-violet-500 bg-clip-text text-transparent">
          SAG Protocol
        </h1>
        <p className="text-xs text-slate-500 mt-1">Sovereign Treasury Platform</p>
      </div>

      {/* Navigation */}
      <nav className="space-y-2">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className={`
                w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left
                transition-all duration-300 ease-in-out group
                ${isActive
                  ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20 shadow-lg shadow-sky-500/10'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }
              `}
            >
              <Icon size={20} className={`transition-colors duration-300 ${isActive ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
              <span className="font-medium">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
