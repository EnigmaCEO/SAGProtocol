import { ethers } from 'ethers';

export type AppRole = 'viewer' | 'operator' | 'owner' | 'dao-council';

const ROLE_BOOK_KEY = 'sagitta.roleBook.v1';
export const ROLES_UPDATED_EVENT = 'sagitta:roles-updated';

type RoleBook = Record<string, AppRole>;

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function normalizeAddress(address: string): string | null {
  if (!address || !ethers.isAddress(address)) return null;
  return ethers.getAddress(address);
}

function emitRolesUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ROLES_UPDATED_EVENT));
}

function readRoleBook(): RoleBook {
  if (!canUseStorage()) return {};
  try {
    const raw = window.localStorage.getItem(ROLE_BOOK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: RoleBook = {};
    for (const [addr, role] of Object.entries(parsed as Record<string, unknown>)) {
      const normalized = normalizeAddress(addr);
      if (!normalized) continue;
      if (role === 'owner' || role === 'operator' || role === 'viewer' || role === 'dao-council') {
        result[normalized.toLowerCase()] = role;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeRoleBook(book: RoleBook): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(ROLE_BOOK_KEY, JSON.stringify(book));
  emitRolesUpdated();
}

export function listRoleAssignments(): Array<{ address: string; role: AppRole }> {
  const book = readRoleBook();
  return Object.entries(book).map(([address, role]) => ({
    address: ethers.getAddress(address),
    role,
  }));
}

export function setAddressRole(address: string, role: AppRole): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  const book = readRoleBook();
  book[normalized.toLowerCase()] = role;
  writeRoleBook(book);
  return true;
}

export function removeAddressRole(address: string): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  const key = normalized.toLowerCase();
  const book = readRoleBook();
  if (!(key in book)) return false;
  delete book[key];
  writeRoleBook(book);
  return true;
}

export function getAssignedRole(address: string): AppRole | null {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const book = readRoleBook();
  return book[normalized.toLowerCase()] ?? null;
}

export function getEffectiveRole(address: string | null | undefined, onChainOwner?: string | null): AppRole {
  if (!address || !ethers.isAddress(address)) return 'viewer';
  const normalized = ethers.getAddress(address);
  if (onChainOwner && ethers.isAddress(onChainOwner) && normalized.toLowerCase() === ethers.getAddress(onChainOwner).toLowerCase()) {
    return 'owner';
  }
  const assigned = getAssignedRole(normalized);
  // dao-council is a governance role only — for UI access-level purposes treat as viewer
  if (assigned && assigned !== 'dao-council') return assigned;
  return 'viewer';
}

export function canOperate(address: string | null | undefined, onChainOwner?: string | null): boolean {
  const role = getEffectiveRole(address, onChainOwner);
  return role === 'owner' || role === 'operator';
}

