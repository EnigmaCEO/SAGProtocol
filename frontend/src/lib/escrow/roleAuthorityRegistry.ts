export type RoleAuthorityStatus = 'active' | 'rotation_pending' | 'frozen' | 'retired';

export type RoleAuthorityId =
  | 'treasury_vault_authority'
  | 'escrow_authority'
  | 'continuity_sce_authority';

export type RoleAuthorityRecord = {
  roleId: RoleAuthorityId;
  roleLabel: string;
  expectedSignerAddress: string;
  custodyDomain: string;
  status: RoleAuthorityStatus;
  allowedActions: string[];
  registryVersion: string;
  updatedAt: string;
};

// Signer addresses are configured via environment variables and registered on-chain
// via setRoleAuthority(roleId, address, Active) on InvestmentEscrow.
// The on-chain registry is always the authoritative source — these env-var values
// are used as the local display fallback when on-chain data hasn't been loaded yet.
// If the env vars are not set, the address is empty: the "Role signers: Local-dev fallback"
// badge will show, and signing will be blocked until on-chain roles are confirmed.
const TREASURY_SIGNER_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_SIGNER_ADDRESS ?? '';
const ESCROW_SIGNER_ADDRESS = process.env.NEXT_PUBLIC_ESCROW_SIGNER_ADDRESS ?? '';
const CONTINUITY_SIGNER_ADDRESS = process.env.NEXT_PUBLIC_CONTINUITY_SIGNER_ADDRESS ?? '';

const REGISTRY_VERSION = process.env.NEXT_PUBLIC_DAO_SYSTEM_REGISTRY_VERSION ?? 'v1.0.0-arc-testnet';

export const ROLE_AUTHORITY_REGISTRY: readonly RoleAuthorityRecord[] = [
  {
    roleId: 'treasury_vault_authority',
    roleLabel: 'Treasury/Vault Authority',
    expectedSignerAddress: TREASURY_SIGNER_ADDRESS,
    custodyDomain: 'Treasury Custody Domain',
    status: 'active',
    allowedActions: ['create_wallet', 'verify_funding', 'deploy_batch', 'settle_batch', 'retire_wallet', 'emergency_action'],
    registryVersion: REGISTRY_VERSION,
    updatedAt: '',
  },
  {
    roleId: 'escrow_authority',
    roleLabel: 'Escrow Authority',
    expectedSignerAddress: ESCROW_SIGNER_ADDRESS,
    custodyDomain: 'Escrow Custody Domain',
    status: 'active',
    allowedActions: ['create_wallet', 'verify_funding', 'deploy_batch', 'settle_batch', 'retire_wallet', 'emergency_action'],
    registryVersion: REGISTRY_VERSION,
    updatedAt: '',
  },
  {
    roleId: 'continuity_sce_authority',
    roleLabel: 'Continuity / SCE Authority',
    expectedSignerAddress: CONTINUITY_SIGNER_ADDRESS,
    custodyDomain: 'Continuity / SCE Custody Domain',
    status: 'active',
    allowedActions: ['create_wallet', 'verify_funding', 'deploy_batch', 'settle_batch', 'retire_wallet', 'emergency_action'],
    registryVersion: REGISTRY_VERSION,
    updatedAt: '',
  },
] as const;

export function getRoleAuthority(roleId: RoleAuthorityId): RoleAuthorityRecord | undefined {
  return ROLE_AUTHORITY_REGISTRY.find((r) => r.roleId === roleId);
}

export function getTreasuryVaultAuthority(): RoleAuthorityRecord {
  return ROLE_AUTHORITY_REGISTRY[0];
}

export function getEscrowAuthority(): RoleAuthorityRecord {
  return ROLE_AUTHORITY_REGISTRY[1];
}

export function getContinuityAuthority(): RoleAuthorityRecord {
  return ROLE_AUTHORITY_REGISTRY[2];
}

export function isRoleSigningAllowed(record: RoleAuthorityRecord): { allowed: boolean; reason?: string } {
  if (record.status === 'frozen') return { allowed: false, reason: 'Role is frozen' };
  if (record.status === 'retired') return { allowed: false, reason: 'Role is retired' };
  return { allowed: true };
}

export function detectRoleAuthorityDrift(
  role: 'treasury' | 'escrow',
  storedSignerAddress: string | undefined,
): { hasDrift: boolean; currentExpected: string; storedExpected: string | undefined } {
  const record = role === 'treasury' ? getTreasuryVaultAuthority() : getEscrowAuthority();
  const hasDrift = Boolean(
    storedSignerAddress &&
    record.expectedSignerAddress &&
    record.expectedSignerAddress.toLowerCase() !== storedSignerAddress.toLowerCase(),
  );
  return { hasDrift, currentExpected: record.expectedSignerAddress, storedExpected: storedSignerAddress };
}
