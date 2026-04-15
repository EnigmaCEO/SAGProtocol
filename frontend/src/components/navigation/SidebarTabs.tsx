import { useRouter } from 'next/router';
import {
  PortfolioIcon,
  WalletIcon,
  VaultIcon,
  TreasuryIcon,
  EscrowIcon,
  ReserveIcon,
  DAOIcon,
  AllocationIcon,
  LayersIcon,
  ExternalLinkIcon,
  ProtocolActiveIcon,
} from '../icons/SagittaIcons';

export type Tab = 'user' | 'vault' | 'treasury' | 'escrow' | 'reserve' | 'dao';

interface SidebarTabsProps {
  active: Tab;
  paused?: boolean;
  network?: string;
  onChange: (tab: Tab) => void;
}

type InternalEntry = { kind: 'internal'; id: Tab; label: string; Icon: React.ComponentType<any> };
type ExternalEntry = { kind: 'external'; href: string; label: string; Icon: React.ComponentType<any> };
type NavEntry = InternalEntry | ExternalEntry;

interface NavGroup {
  label: string;
  entries: NavEntry[];
}

const navGroups: NavGroup[] = [
  {
    label: 'User',
    entries: [
      { kind: 'internal', id: 'user',   label: 'Portfolio', Icon: PortfolioIcon },
      { kind: 'external', href: 'https://wallet.sagitta.systems/',    label: 'Wallet',    Icon: WalletIcon    },
    ],
  },
  {
    label: 'Protocol',
    entries: [
      { kind: 'internal', id: 'vault',    label: 'Vault',    Icon: VaultIcon    },
      { kind: 'internal', id: 'treasury', label: 'Treasury', Icon: TreasuryIcon },
      { kind: 'internal', id: 'escrow',   label: 'Escrow',   Icon: EscrowIcon   },
      { kind: 'internal', id: 'reserve',  label: 'Reserve',  Icon: ReserveIcon  },
      { kind: 'internal', id: 'dao',      label: 'DAO',       Icon: DAOIcon      },
    ],
  },
  {
    label: 'Systems',
    entries: [
      { kind: 'external', href: 'https://aaa.sagitta.systems/', label: 'Allocations', Icon: AllocationIcon },
      { kind: 'external', href: 'https://continuity.sagitta.systems/', label: 'Continuity',  Icon: LayersIcon     },
    ],
  },
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
          <a
            href="/"
          >
          <img alt="SAGITTA logo" src="/logo.png" width={100} height={100} />
          </a>
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
        {navGroups.map((group) => (
          <div key={group.label} className="sidebar-nav__group">
            <div className="sidebar-nav__label">{group.label}</div>
            {group.entries.map((entry) => {
              if (entry.kind === 'external') {
                return (
                  <a
                    key={entry.label}
                    href={entry.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="sidebar-tab sidebar-tab--external"
                  >
                    <entry.Icon size={16} className="sidebar-tab__icon" />
                    <span className="sidebar-tab__label">{entry.label}</span>
                    <ExternalLinkIcon size={11} className="sidebar-tab__ext" />
                  </a>
                );
              }

              const isActive = active === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => handleTabClick(entry.id)}
                  className={`sidebar-tab${isActive ? ' sidebar-tab--active' : ''}`}
                >
                  <entry.Icon size={16} className="sidebar-tab__icon" />
                  <span className="sidebar-tab__label">{entry.label}</span>
                  {isActive && <span className="sidebar-tab__pip" />}
                </button>
              );
            })}
          </div>
        ))}
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
