import useRoleAccess from '../../hooks/useRoleAccess';

interface TopBarProps {
  chainId?: number;
  address?: string;
  ownerAddress?: string;
  onSwitch?: () => void;
}

function roleLabel(role: 'viewer' | 'operator' | 'owner' | 'dao-council') {
  if (role === 'owner') return 'Owner';
  if (role === 'operator') return 'Operator';
  if (role === 'dao-council') return 'DAO Council';
  return 'Viewer';
}

export default function TopBar({ address, ownerAddress }: TopBarProps) {
  void address;
  void ownerAddress;
  const {
    address: activeAddress,
    role,
    actualRole,
    isActualOwner,
    setRolePreview,
  } = useRoleAccess();

  return (
    <div className="topbar-row">
      <span className="topbar-tagline">Trustless Capital Management</span>

      <div className="topbar-right">
        <span className="data-chip">
          Role: {roleLabel(role)}
        </span>

        {isActualOwner && role !== actualRole ? (
          <span className="data-chip" data-tone="warning">
            Actual: {roleLabel(actualRole)}
          </span>
        ) : null}

        {isActualOwner ? (
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{
              border: '1px solid rgba(180,140,20,0.22)',
              background: 'rgba(180,136,26,0.08)',
              color: 'var(--gold-300)',
            }}
          >
            <span style={{ color: 'var(--text-500)' }}>View As</span>
            <select
              value={role}
              onChange={e => setRolePreview(e.target.value as 'viewer' | 'operator' | 'owner')}
              style={{ background: 'transparent', color: 'var(--gold-300)', outline: 'none', border: 'none' }}
            >
              <option value="owner">Owner</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
        ) : null}

        <div
          className="px-4 py-1.5 rounded-full text-sm kpi-value"
          style={{
            border: '1px solid rgba(180,140,20,0.2)',
            background: 'rgba(5,11,22,0.85)',
            color: 'var(--text-300)',
          }}
        >
          {activeAddress
            ? `${activeAddress.slice(0, 6)}…${activeAddress.slice(-4)}`
            : 'Not Connected'}
        </div>
      </div>
    </div>
  );
}
