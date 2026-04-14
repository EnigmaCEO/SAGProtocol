import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';

import { getEffectiveRole, type AppRole, ROLES_UPDATED_EVENT } from '../lib/roles';
import { getSigner } from '../lib/ethers';
import { getRuntimeAddress, isValidAddress } from '../lib/runtime-addresses';
import { RPC_URL, IS_LOCAL_CHAIN } from '../lib/network';

const LOCALHOST_RPC = RPC_URL;
const ROLE_VIEW_OVERRIDE_KEY = 'sagitta.roleViewOverride.v1';
export const ROLE_VIEW_OVERRIDE_EVENT = 'sagitta:role-view-override';

function normalizeAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !ethers.isAddress(value)) return null;
  return ethers.getAddress(value);
}

const WALLET_STORAGE_KEY = 'sagitta.connectedAccount';

function readSelectedAddress(): string | null {
  if (typeof window === 'undefined') return null;
  const eth = (window as any).ethereum;
  return normalizeAddress(eth?.selectedAddress ?? eth?._selectedAddress ?? null);
}

function readPersistedAddress(): string | null {
  try {
    return typeof window !== 'undefined'
      ? normalizeAddress(window.localStorage.getItem(WALLET_STORAGE_KEY))
      : null;
  } catch { return null; }
}

async function resolveSessionAddress(): Promise<string | null> {
  // 1. MetaMask synchronous selectedAddress (available when wallet is unlocked)
  const injected = readSelectedAddress();
  if (injected) return injected;

  // 2. eth_accounts — non-prompting, returns already-granted accounts after page refresh
  const eth = typeof window !== 'undefined' ? (window as any).ethereum : null;
  if (eth?.request) {
    try {
      const accounts: string[] = await eth.request({ method: 'eth_accounts' });
      const fromEth = Array.isArray(accounts) && accounts.length > 0
        ? normalizeAddress(accounts[0])
        : null;
      if (fromEth) return fromEth;
    } catch { /* wallet locked */ }
  }

  // 3. localStorage — address persisted by useWallet on last connect
  // Skip on local chains: the persisted address is likely a live-network wallet
  // that won't match the local Hardhat deployer, causing the demo to show as viewer.
  if (!IS_LOCAL_CHAIN) {
    const persisted = readPersistedAddress();
    if (persisted) return persisted;
  }

  // 4. Last resort: demo signer (localhost only — gives viewer role on live chains)
  try {
    const signer = await getSigner();
    return normalizeAddress(await signer.getAddress());
  } catch {
    return null;
  }
}

function normalizeRole(value: unknown): AppRole | null {
  return value === 'viewer' || value === 'operator' || value === 'owner' ? value : null;
}

export function getRoleViewOverride(): AppRole | null {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeRole(window.localStorage.getItem(ROLE_VIEW_OVERRIDE_KEY));
  } catch {
    return null;
  }
}

export function setRoleViewOverride(nextRole: AppRole | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (nextRole) {
      window.localStorage.setItem(ROLE_VIEW_OVERRIDE_KEY, nextRole);
    } else {
      window.localStorage.removeItem(ROLE_VIEW_OVERRIDE_KEY);
    }
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(ROLE_VIEW_OVERRIDE_EVENT));
}

export default function useRoleAccess(): {
  address: string | null;
  ownerAddress: string | null;
  actualRole: AppRole;
  role: AppRole;
  roleViewOverride: AppRole | null;
  isOperator: boolean;
  isOwner: boolean;
  isActualOwner: boolean;
  setRolePreview: (nextRole: AppRole | null) => void;
  loading: boolean;
} {
  const [address, setAddress] = useState<string | null>(() => readSelectedAddress());
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [roleViewOverride, setRoleViewOverrideState] = useState<AppRole | null>(() => getRoleViewOverride());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const provider = new ethers.JsonRpcProvider(LOCALHOST_RPC);

    const syncOwner = async () => {
      const vaultAddress = getRuntimeAddress('Vault');
      if (!isValidAddress(vaultAddress)) {
        if (active) {
          setOwnerAddress(null);
          setLoading(false);
        }
        return;
      }

      try {
        const vault = new ethers.Contract(vaultAddress, ['function owner() view returns (address)'], provider);
        const owner = await vault.owner().catch(() => null);
        if (active) setOwnerAddress(normalizeAddress(owner));
      } catch {
        if (active) setOwnerAddress(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    const syncSelectedAddress = async () => {
      if (!active) return;
      const nextAddress = await resolveSessionAddress();
      if (!active) return;
      setAddress(nextAddress);
    };

    const syncRoleViewOverride = () => {
      if (!active) return;
      setRoleViewOverrideState(getRoleViewOverride());
    };

    const syncAccess = () => {
      void syncSelectedAddress();
      syncRoleViewOverride();
      void syncOwner();
    };

    const handleAccountsChanged = (accounts: string[]) => {
      if (!active) return;
      const nextAddress = Array.isArray(accounts) && accounts.length > 0 ? normalizeAddress(accounts[0]) : null;
      if (nextAddress) {
        setAddress(nextAddress);
        return;
      }
      void syncSelectedAddress();
    };

    syncAccess();

    if (typeof window !== 'undefined') {
      const eth = (window as any).ethereum;
      if (eth?.on) {
        eth.on('accountsChanged', handleAccountsChanged);
      }
      window.addEventListener(ROLES_UPDATED_EVENT, syncAccess as EventListener);
      window.addEventListener(ROLE_VIEW_OVERRIDE_EVENT, syncRoleViewOverride as EventListener);
      window.addEventListener('storage', syncAccess);

      return () => {
        active = false;
        if (eth?.removeListener) {
          eth.removeListener('accountsChanged', handleAccountsChanged);
        }
        window.removeEventListener(ROLES_UPDATED_EVENT, syncAccess as EventListener);
        window.removeEventListener(ROLE_VIEW_OVERRIDE_EVENT, syncRoleViewOverride as EventListener);
        window.removeEventListener('storage', syncAccess);
      };
    }

    return () => {
      active = false;
    };
  }, []);

  const actualRole = useMemo<AppRole>(() => getEffectiveRole(address, ownerAddress), [address, ownerAddress]);

  useEffect(() => {
    if (actualRole !== 'owner' && roleViewOverride) {
      setRoleViewOverride(null);
      setRoleViewOverrideState(null);
    }
  }, [actualRole, roleViewOverride]);

  const role = useMemo<AppRole>(() => {
    if (actualRole === 'owner' && roleViewOverride) return roleViewOverride;
    return actualRole;
  }, [actualRole, roleViewOverride]);

  const isOperator = useMemo(() => role === 'owner' || role === 'operator', [role]);

  const setRolePreview = (nextRole: AppRole | null) => {
    if (actualRole !== 'owner') return;
    if (!nextRole || nextRole === 'owner') {
      setRoleViewOverride(null);
      setRoleViewOverrideState(null);
      return;
    }
    setRoleViewOverride(nextRole);
    setRoleViewOverrideState(nextRole);
  };

  return {
    address,
    ownerAddress,
    actualRole,
    role,
    roleViewOverride,
    isOperator,
    isOwner: role === 'owner',
    isActualOwner: actualRole === 'owner',
    setRolePreview,
    loading,
  };
}
