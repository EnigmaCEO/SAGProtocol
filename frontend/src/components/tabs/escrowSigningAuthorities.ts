import {
  EscrowAuthorityRole,
  EscrowSigningAuthority,
  EscrowSigningRequestActionType,
} from '../../lib/escrow/batches';
import {
  getContinuityAuthority,
  getEscrowAuthority,
  getTreasuryVaultAuthority,
} from '../../lib/escrow/roleAuthorityRegistry';

const DEFAULT_ALLOWED_ACTIONS: EscrowSigningRequestActionType[] = [
  'create_wallet',
  'verify_funding',
  'deploy_batch',
  'settle_batch',
  'retire_wallet',
  'emergency_action',
];

const CREATED_AT = '2026-06-01T00:00:00.000Z';

function registryStatusToAuthorityStatus(status: string): EscrowSigningAuthority['status'] {
  if (status === 'active') return 'active';
  if (status === 'frozen' || status === 'retired') return 'suspended';
  return 'inactive';
}

function buildAuthority(
  authorityId: string,
  role: EscrowAuthorityRole,
  displayName: string,
  registryRecord: { expectedSignerAddress: string; custodyDomain: string; status: string; roleId: string },
): EscrowSigningAuthority {
  return {
    authorityId,
    role,
    displayName,
    publicSignerAddress: registryRecord.expectedSignerAddress,
    keyRef: `external-role:${registryRecord.roleId}`,
    custodyDomain: registryRecord.custodyDomain,
    custodyMode: 'external_role_reference',
    status: registryStatusToAuthorityStatus(registryRecord.status),
    allowedActions: [...DEFAULT_ALLOWED_ACTIONS],
    createdAt: CREATED_AT,
  };
}

export const DEFAULT_ESCROW_SIGNING_AUTHORITIES: EscrowSigningAuthority[] = [
  buildAuthority('authority-treasury', 'treasury', 'Treasury Authority', getTreasuryVaultAuthority()),
  buildAuthority('authority-escrow', 'escrow', 'Escrow Authority', getEscrowAuthority()),
  buildAuthority('authority-continuity', 'continuity', 'Continuity Authority', getContinuityAuthority()),
];

export function getDefaultEscrowSigningAuthorities() {
  return DEFAULT_ESCROW_SIGNING_AUTHORITIES.map((authority) => ({
    ...authority,
    allowedActions: [...authority.allowedActions],
  }));
}

export function getSigningAuthorityByRole(role: EscrowAuthorityRole) {
  return DEFAULT_ESCROW_SIGNING_AUTHORITIES.find((authority) => authority.role === role);
}
