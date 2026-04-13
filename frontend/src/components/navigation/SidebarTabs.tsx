import { User, Vault, Building2, Shield, DollarSign, Users } from 'lucide-react';
import { useRouter } from 'next/router';

type Tab = 'user' | 'vault' | 'treasury' | 'escrow' | 'reserve' | 'dao';

interface SidebarTabsProps {
  active: Tab;
  paused?: boolean;
  network?: string;
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

export default function SidebarTabs({ active, paused, network, onChange }: SidebarTabsProps) {
  const router = useRouter();

  const handleTabClick = (tabId: Tab) => {
    onChange(tabId);
    router.push(`/?tab=${tabId}`, undefined, { shallow: true });
  };

  const networkLabel = network && network !== "unknown" ? network : "localhost";

  return (
    <div className="sagitta-header">
      <div className="sagitta-title">
        <img alt="SAGITTA icon" src="/images/icon.png" width={28} />
        <span>SAGITTA PROTOCOL (v0.1 BETA)</span>
      </div>

      <div className="nav-divider hidden md:block" />

      <nav className="sagitta-nav overflow-x-auto scrollbar-thin pr-1">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleTabClick(id)}
              className={`sagitta-tab ${isActive ? "sagitta-tab--active text-slate-100" : "text-slate-300"}`}
            >
              <Icon size={17} className={isActive ? 'text-sky-300' : 'text-slate-300'} />
              <span className="text-sm font-semibold whitespace-nowrap">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="ml-auto hidden lg:flex items-center gap-2">
      <span className="data-chip">Network: {networkLabel}</span>
      </div>
      <div className="hidden lg:flex items-center gap-2">
      {paused ? (
          <span className="data-chip" data-tone="danger">Protocol Paused</span>
        ) : (
          <span className="data-chip" data-tone="success">Protocol Active</span>
        )}
      </div>
    </div>
  );
}
