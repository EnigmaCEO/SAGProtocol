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
    <div>
      {/* Logo/Title + inline nav */}
      <header
        className="px-2 py-2"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '9rem',
          flexWrap: 'nowrap',     // prevent wrapping
          overflowX: 'auto'      // allow horizontal scroll if needed
        }}
      >
        <h1
          className="text-2xl font-bold"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}
        >
          <img alt="SAGITTA icon" src="/images/icon.png" width={28} /> 
          SAGITTA
        </h1>

        <nav
          className="flex items-center"
          style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', whiteSpace: 'nowrap' }}
        >
          {tabs.map(({ id, label, icon: Icon }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                onClick={() => handleTabClick(id)}
                className={isActive ? 'text-sky-300' : 'text-slate-400'}
                style={{
                  color: 'white',
                  backgroundColor: isActive? '#030316' : 'transparent',
                  border: 'none',
                  borderBottom: isActive? '2px solid white' : '2px solid transparent',
                  display: 'inline-flex',   // override any global display:block
                  alignItems: 'center',
                  cursor: 'pointer',
                  gap: '0.5rem',
                  padding: '0.5rem 0.5rem',
                  width: 'auto',            // ensure not full width
                  whiteSpace: 'nowrap'      // prevent label wrap
                }}
              >
                <Icon size={18} className={isActive ? 'text-sky-400' : 'text-slate-500'} />
                <span className="text-sm whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </nav>
      </header>
    </div>
  );
}
