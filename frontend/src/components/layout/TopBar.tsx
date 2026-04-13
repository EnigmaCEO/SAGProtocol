import useRoleAccess from '../../hooks/useRoleAccess';

interface TopBarProps {
  chainId?: number;
  address?: string;
  ownerAddress?: string;
  onSwitch?: () => void;
}

function roleLabel(role: 'viewer' | 'operator' | 'owner') {
  if (role === 'owner') return 'Owner';
  if (role === 'operator') return 'Operator';
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
      <div className="topbar-right">
        <span className="data-chip">Role: {roleLabel(role)}</span>
        {isActualOwner && role !== actualRole ? (
          <span className="data-chip" data-tone="warning">Actual: {roleLabel(actualRole)}</span>
        ) : null}
        {isActualOwner ? (
          <label className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-600/60 bg-slate-900/65 text-xs text-slate-300">
            <span>View As</span>
            <select
              value={role}
              onChange={e => setRolePreview(e.target.value as 'viewer' | 'operator' | 'owner')}
              className="bg-transparent text-slate-100 outline-none"
            >
              <option value="owner">Owner</option>
              <option value="operator">Operator</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
        ) : null}
        <div className="px-5 py-2 rounded-full border border-slate-600/60 bg-slate-900/65 text-sm kpi-value text-slate-200">
          {activeAddress ? `Wallet ${activeAddress.slice(0, 6)}...${activeAddress.slice(-4)}` : "Wallet Not Connected"}
        </div>
      </div>
    </div>
  );
}
