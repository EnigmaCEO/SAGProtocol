import { useRouter } from 'next/router';
import {
  PortfolioIcon,
  VaultIcon,
  TreasuryIcon,
  EscrowIcon,
  ReserveIcon,
  DAOIcon,
  ProtocolActiveIcon,
} from '../icons/SagittaIcons';

type Tab = 'user' | 'vault' | 'treasury' | 'escrow' | 'reserve' | 'dao';

interface SidebarTabsProps {
  active: Tab;
  paused?: boolean;
  network?: string;
  onChange: (tab: Tab) => void;
}

const tabs = [
  { id: 'user'     as Tab, label: 'Portfolio', Icon: PortfolioIcon },
  { id: 'vault'    as Tab, label: 'Vault',     Icon: VaultIcon     },
  { id: 'treasury' as Tab, label: 'Treasury',  Icon: TreasuryIcon  },
  { id: 'escrow'   as Tab, label: 'Escrow',    Icon: EscrowIcon    },
  { id: 'reserve'  as Tab, label: 'Reserve',   Icon: ReserveIcon   },
  { id: 'dao'      as Tab, label: 'DAO',        Icon: DAOIcon       },
];

export default function SidebarTabs({ active, paused, network, onChange }: SidebarTabsProps) {
  const router = useRouter();

  const handleTabClick = (tabId: Tab) => {
    onChange(tabId);
    router.push(`/?tab=${tabId}`, undefined, { shallow: true });
  };

  return (
    <div className="sidebar-inner">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo__icon">
          <img alt="SAGITTA icon" src="/images/icon.png" width={40} height={40} />
        </div>
        <div className="sidebar-logo__text">
          <span className="sidebar-logo__name">SAGITTA</span>
          <span className="sidebar-logo__sub">PROTOCOL</span>
        </div>
        <span className="sidebar-logo__badge">v0.1</span>
      </div>

      <div className="sidebar-divider" />

      {/* Nav */}
      <nav className="sidebar-nav">
        <div className="sidebar-nav__label">Navigation</div>
        {tabs.map(({ id, label, Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleTabClick(id)}
              className={`sidebar-tab${isActive ? ' sidebar-tab--active' : ''}`}
            >
              <Icon size={16} className="sidebar-tab__icon" />
              <span className="sidebar-tab__label">{label}</span>
              {isActive && <span className="sidebar-tab__pip" />}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-divider" style={{ marginBottom: '0.75rem' }} />
        <div className="sidebar-footer__row">
          <span className="sidebar-footer__dot" />
          <span className="sidebar-footer__net">{network || 'Localhost'}</span>
        </div>
        <div className={`sidebar-footer__status ${paused ? 'sidebar-footer__status--paused' : 'sidebar-footer__status--active'}`}>
          {paused ? (
            <span className="sidebar-footer__pulse" />
          ) : (
            <ProtocolActiveIcon size={13} className="sidebar-footer__pulse--live shrink-0" style={{ color: 'var(--tone-success)' } as React.CSSProperties} />
          )}
          {paused ? 'Protocol Paused' : 'Protocol Active'}
        </div>
      </div>
    </div>
  );
}
