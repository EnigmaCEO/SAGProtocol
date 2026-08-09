// Resolve what a wallet address is allowed to do.
//
// AUTHORITY SOURCES, in precedence order:
//   1. PROTOCOL_ADMIN_WALLETS    — explicit administrator allowlist.
//   2. On-chain role authority registry (InvestmentEscrow.getRoleAuthority) —
//      the Treasury/Vault, Escrow, and Continuity role signers. A role that is
//      frozen or retired confers nothing; only `active` counts.
//   3. PROTOCOL_OPERATOR_WALLETS — institution operator allowlist.
//   4. Anything else             — `viewer`, read-only.
//
// A connected wallet is NOT an authorized wallet. Connecting proves control of
// an address; it does not grant authority. That distinction is the entire point
// of this module.

import { Contract, JsonRpcProvider } from 'ethers';
import { frontendSecurityConfig } from './config';
import type { WalletRole } from './session';

const ROLE_AUTHORITY_ABI = [
  'function getRoleAuthority(uint8 roleId) view returns (tuple(address signer, uint8 status, uint64 updatedAt, address updatedBy, bool exists))',
];

const ROLE_IDS = [0, 1, 2]; // ROLE_TREASURY_VAULT, ROLE_ESCROW, ROLE_CONTINUITY_SCE
const ROLE_STATUS_ACTIVE = 0;

export interface WalletAuthority {
  role: WalletRole;
  /** Where the authority came from — recorded in the login audit event. */
  source: 'admin-allowlist' | 'onchain-role' | 'operator-allowlist' | 'default-viewer';
  institutionId?: string;
}

// ─── On-chain role cache ──────────────────────────────────────────────────────
// The registry changes rarely and an RPC round trip on every login is wasteful.
// A short TTL keeps a revoked role from lingering for long.

const ROLE_CACHE_TTL_MS = 60_000;

let cachedRoleSigners: { addresses: Set<string>; fetchedAt: number } | null = null;

/** Active role signer addresses from the on-chain registry, lowercase. */
export async function readActiveRoleSigners(): Promise<Set<string>> {
  const config = frontendSecurityConfig();
  const now = Date.now();

  if (cachedRoleSigners && now - cachedRoleSigners.fetchedAt < ROLE_CACHE_TTL_MS) {
    return cachedRoleSigners.addresses;
  }
  if (!config.escrowAddress || !config.rpcUrl) return new Set();

  const addresses = new Set<string>();
  try {
    const provider = new JsonRpcProvider(config.rpcUrl);
    const contract = new Contract(config.escrowAddress, ROLE_AUTHORITY_ABI, provider);

    const results = await Promise.all(
      ROLE_IDS.map(id => contract.getRoleAuthority(id).catch(() => null)),
    );
    for (const raw of results) {
      if (!raw?.exists) continue;
      if (Number(raw.status) !== ROLE_STATUS_ACTIVE) continue; // frozen/retired confer nothing
      const signer = String(raw.signer ?? '').toLowerCase();
      if (/^0x[a-f0-9]{40}$/.test(signer)) addresses.add(signer);
    }
    cachedRoleSigners = { addresses, fetchedAt: now };
  } catch (err: any) {
    // A failed read must not upgrade anyone. Serve the stale set if we have one,
    // otherwise nobody gets on-chain authority this request.
    console.warn('[security] Could not read on-chain role authority registry', {
      message: String(err?.message ?? err),
    });
    if (cachedRoleSigners) return cachedRoleSigners.addresses;
    return new Set();
  }

  return addresses;
}

/** Resolve a verified wallet address to its role. */
export async function resolveWalletAuthority(address: string): Promise<WalletAuthority> {
  const config = frontendSecurityConfig();
  const normalized = String(address ?? '').toLowerCase();

  if (config.adminWallets.includes(normalized)) {
    return { role: 'admin', source: 'admin-allowlist' };
  }

  const roleSigners = await readActiveRoleSigners();
  if (roleSigners.has(normalized)) {
    // A live protocol role signer is an administrator of this console: these are
    // the same addresses the contracts accept as Treasury/Escrow authority.
    return { role: 'admin', source: 'onchain-role' };
  }

  if (config.operatorWallets.includes(normalized)) {
    return { role: 'operator', source: 'operator-allowlist' };
  }

  return { role: 'viewer', source: 'default-viewer' };
}

/** Test hook. */
export function __resetRoleSignerCache(): void {
  cachedRoleSigners = null;
}
