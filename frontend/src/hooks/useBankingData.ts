import { useCallback, useEffect, useState } from 'react';

import { createSeedBankingState } from '../lib/banking/demoStore';
import type { BankingDashboardState, BankingDepositRequest } from '../lib/banking/types';

const BANKING_STORAGE_KEY = 'sagitta:banking-state';
const PUBLIC_BANKING_API_URL = process.env.NEXT_PUBLIC_BANKING_API_URL?.replace(/\/$/, '');
const BANKING_API_PREFIXES = [
  '/api/banking',
  ...(PUBLIC_BANKING_API_URL ? [`${PUBLIC_BANKING_API_URL}/banking`] : []),
  '/banking',
];

type BankingState = BankingDashboardState;
type BankingDepositResult = {
  state?: BankingState;
  dashboardState?: BankingState;
  createdPosition?: any;
  [key: string]: any;
};
type StoredBankingStateEnvelope = {
  contextKey: string;
  state: BankingState;
};

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object';
}

function unwrapBankingState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.state || value.dashboardState || value;
}

function normalizeBankingState(value: unknown): BankingState {
  const seed = createSeedBankingState();
  const candidate = unwrapBankingState(value);
  if (!isRecord(candidate)) return seed;

  const capitalAccount = isRecord(candidate.capitalAccount) ? candidate.capitalAccount : {};
  const protectionStatus = isRecord(candidate.protectionStatus) ? candidate.protectionStatus : {};
  const vaultBridge = isRecord(candidate.vaultBridge) ? candidate.vaultBridge : {};

  return {
    ...seed,
    ...candidate,
    accounts: Array.isArray(candidate.accounts) ? candidate.accounts : seed.accounts,
    capitalAccount: {
      ...seed.capitalAccount,
      ...capitalAccount,
      transactions: Array.isArray(capitalAccount.transactions) ? capitalAccount.transactions : seed.capitalAccount.transactions,
    },
    fundingInstructions: Array.isArray(candidate.fundingInstructions) ? candidate.fundingInstructions : seed.fundingInstructions,
    maturitySchedules: Array.isArray(candidate.maturitySchedules) ? candidate.maturitySchedules : seed.maturitySchedules,
    termPositions: Array.isArray(candidate.termPositions) ? candidate.termPositions : seed.termPositions,
    protectionStatus: {
      ...seed.protectionStatus,
      ...protectionStatus,
    },
    settlementEvents: Array.isArray(candidate.settlementEvents) ? candidate.settlementEvents : seed.settlementEvents,
    vaultBridge: {
      ...seed.vaultBridge,
      ...vaultBridge,
    },
    institutionPolicies: Array.isArray(candidate.institutionPolicies) ? candidate.institutionPolicies : seed.institutionPolicies,
    treasuryLots: Array.isArray(candidate.treasuryLots) ? candidate.treasuryLots : seed.treasuryLots,
    escrowExecutionOrders: Array.isArray(candidate.escrowExecutionOrders)
      ? candidate.escrowExecutionOrders
      : seed.escrowExecutionOrders,
    escrowAllocationPlans: Array.isArray(candidate.escrowAllocationPlans)
      ? candidate.escrowAllocationPlans
      : seed.escrowAllocationPlans,
    escrowAllocationLegs: Array.isArray(candidate.escrowAllocationLegs)
      ? candidate.escrowAllocationLegs
      : seed.escrowAllocationLegs,
  };
}

function bankingStateContextKey(institutionId?: string, customerRef?: string): string {
  return `institution:${institutionId ?? ''}|customer:${customerRef ?? ''}`;
}

function persistState(nextState: BankingState, institutionId?: string, customerRef?: string) {
  if (typeof window === 'undefined' || !nextState) return;
  const envelope: StoredBankingStateEnvelope = {
    contextKey: bankingStateContextKey(institutionId, customerRef),
    state: nextState,
  };
  window.localStorage.setItem(BANKING_STORAGE_KEY, JSON.stringify(envelope));
}

function readStoredState(institutionId?: string, customerRef?: string): BankingState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BANKING_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredBankingStateEnvelope | BankingState;
    const requestedKey = bankingStateContextKey(institutionId, customerRef);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'state' in parsed &&
      'contextKey' in parsed
    ) {
      return parsed.contextKey === requestedKey
        ? normalizeBankingState(parsed.state)
        : null;
    }
    // Legacy cache format had no institution/customer scoping.
    // Never hydrate it into a filtered bank/customer view.
    return !institutionId && !customerRef ? normalizeBankingState(parsed) : null;
  } catch {
    window.localStorage.removeItem(BANKING_STORAGE_KEY);
    return null;
  }
}

async function bankingFetch(path: string, init?: RequestInit): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let lastResponse: Response | null = null;

  for (const prefix of BANKING_API_PREFIXES) {
    const response = await fetch(`${prefix}${normalizedPath}`, init);
    const contentType = response.headers.get('content-type') || '';

    if (
      response.status === 404 &&
      !contentType.includes('application/json') &&
      prefix !== BANKING_API_PREFIXES[BANKING_API_PREFIXES.length - 1]
    ) {
      lastResponse = response;
      continue;
    }

    return response;
  }

  return lastResponse || fetch(`${BANKING_API_PREFIXES[0]}${normalizedPath}`, init);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as T;
    if (!response.ok) {
      const message = (payload as any)?.error || (payload as any)?.message || `Banking API request failed (${response.status}).`;
      throw new Error(message);
    }
    return payload;
  }

  const text = await response.text();
  const detail = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  throw new Error(
    response.ok
      ? `Banking API returned a non-JSON response${detail ? `: ${detail}` : '.'}`
      : `Banking API request failed (${response.status})${detail ? `: ${detail}` : '.'}`
  );
}

function jsonPost(body?: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

// ── Banking account record (localStorage) ────────────────────────────────────

export const BANKING_ACCOUNT_KEY = 'sagitta:banking-account';
const BANKING_ACCOUNTS_KEY = 'sagitta:banking-accounts';

export interface BankingAccountRecord {
  institutionId: string;
  customerRef: string;
  fineractClientId: number | null;
  savingsAccountId: number | null;
  fineractOnboarded: boolean;
  openedAt: string;
}

type BankingAccountStore = {
  selectedInstitutionId?: string;
  records: Record<string, BankingAccountRecord>;
};

function normalizeBankingAccountStore(value: unknown): BankingAccountStore | null {
  if (!isRecord(value)) return null;
  const records = isRecord(value.records) ? value.records : null;
  if (!records) return null;

  const normalizedEntries = Object.entries(records).filter(([, record]) => isRecord(record));
  return {
    selectedInstitutionId:
      typeof value.selectedInstitutionId === 'string' && value.selectedInstitutionId.trim().length > 0
        ? value.selectedInstitutionId
        : undefined,
    records: Object.fromEntries(normalizedEntries) as Record<string, BankingAccountRecord>,
  };
}

function readBankingAccountStore(): BankingAccountStore | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BANKING_ACCOUNTS_KEY);
  if (!raw) return null;

  try {
    return normalizeBankingAccountStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeBankingAccountStore(store: BankingAccountStore): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BANKING_ACCOUNTS_KEY, JSON.stringify(store));
}

function migrateLegacyBankingAccount(): BankingAccountRecord | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BANKING_ACCOUNT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as BankingAccountRecord; } catch { return null; }
}

export function readSelectedBankingInstitutionId(): string | undefined {
  const store = readBankingAccountStore();
  if (store?.selectedInstitutionId) return store.selectedInstitutionId;
  return migrateLegacyBankingAccount()?.institutionId;
}

export function saveSelectedBankingInstitutionId(institutionId?: string): void {
  if (typeof window === 'undefined') return;
  const legacy = migrateLegacyBankingAccount();
  const store = readBankingAccountStore() ?? {
    records: legacy ? { [legacy.institutionId]: legacy } : {},
  };
  if (institutionId && institutionId.trim().length > 0) {
    store.selectedInstitutionId = institutionId;
  } else {
    delete store.selectedInstitutionId;
  }
  writeBankingAccountStore(store);
}

export function readBankingAccount(institutionId?: string): BankingAccountRecord | null {
  const store = readBankingAccountStore();
  if (store) {
    if (institutionId) {
      const record = store.records[institutionId];
      if (record) return record;
    }
    if (store.selectedInstitutionId && store.records[store.selectedInstitutionId]) {
      return store.records[store.selectedInstitutionId];
    }
    const records = Object.values(store.records).sort((left, right) => right.openedAt.localeCompare(left.openedAt));
    if (records[0]) return records[0];
  }

  const legacy = migrateLegacyBankingAccount();
  if (!legacy) return null;
  if (institutionId && legacy.institutionId !== institutionId) return null;
  return legacy;
}

export function saveBankingAccount(record: BankingAccountRecord): void {
  if (typeof window === 'undefined') return;
  const store = readBankingAccountStore() ?? { records: {} };
  store.records[record.institutionId] = record;
  store.selectedInstitutionId = record.institutionId;
  writeBankingAccountStore(store);
  window.localStorage.setItem(BANKING_ACCOUNT_KEY, JSON.stringify(record));
}

export function clearBankingAccount(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(BANKING_ACCOUNT_KEY);
  window.localStorage.removeItem(BANKING_ACCOUNTS_KEY);
}

export async function openCustomerAccount(
  institutionId: string,
  customerRef: string,
  accountTypes: string[]
): Promise<BankingAccountRecord> {
  const response = await bankingFetch('/customers/open-account', jsonPost({ institutionId, customerRef, accountTypes }));
  const envelope = await readJsonResponse<{ data?: BankingAccountRecord } | BankingAccountRecord>(response);
  const record = ((envelope as any).data ?? envelope) as BankingAccountRecord;
  saveBankingAccount(record);
  return record;
}

// ── Institution types ─────────────────────────────────────────────────────────

export interface BankInstitution {
  institutionId: string;
  displayName: string;
  fineractClientId: number | null;
  fineractSavingsAccountId: number | null;
  fineractOnboarded: boolean;
  settlementAccount?: {
    id: string;
    institutionId: string;
    settlementType: string;
    asset: string;
    chainId: string;
    settlementWalletAddress: string | null;
    externalAccountRef: string | null;
    destinationLabel: string | null;
    status: string;
    approvalStatus: string;
    approvedDestinationHash: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  distributionEligible?: boolean;
  distribution_eligible?: boolean;
  distributionEligibilityReason?: string;
}

/** Fetch the list of onboarded institutions from the banking server. */
export async function fetchInstitutions(): Promise<BankInstitution[]> {
  try {
    const response = await bankingFetch('/institutions');
    const payload = await readJsonResponse<{ data?: BankInstitution[]; items?: BankInstitution[] } | BankInstitution[]>(response);
    if (Array.isArray(payload)) return payload;
    return (payload as any).data ?? (payload as any).items ?? [];
  } catch {
    return [];
  }
}

/** POST to /banking/institutions/onboard to register a new bank in Fineract. */
export async function onboardInstitution(institutionId: string, displayName: string): Promise<BankInstitution> {
  const response = await bankingFetch('/institutions/onboard', jsonPost({ institutionId, displayName }));
  const payload = await readJsonResponse<{ data?: BankInstitution } | BankInstitution>(response);
  return ((payload as any).data ?? payload) as BankInstitution;
}

export default function useBankingData(institutionId?: string, customerRef?: string) {
  const [state, setState] = useState<BankingState | null>(() => readStoredState(institutionId, customerRef));
  const [loading, setLoading] = useState(!state);
  const [error, setError] = useState<string | null>(null);

  const setAndPersistState = useCallback((nextState: unknown) => {
    const normalizedState = normalizeBankingState(nextState);
    setState(normalizedState);
    persistState(normalizedState, institutionId, customerRef);
  }, [customerRef, institutionId]);

  useEffect(() => {
    const cachedState = readStoredState(institutionId, customerRef);
    setState(cachedState);
    setLoading(!cachedState);
    setError(null);
  }, [customerRef, institutionId]);

  const stateUrl = (() => {
    const params = new URLSearchParams();
    if (institutionId) params.set('institutionId', institutionId);
    if (customerRef) params.set('customerRef', customerRef);
    const qs = params.toString();
    return qs ? `/state?${qs}` : '/state';
  })();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await bankingFetch(stateUrl);
      const nextState = await readJsonResponse<BankingState>(response);
      setAndPersistState(nextState);
      return nextState;
    } catch (err: any) {
      const message = String(err?.message || err);
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [setAndPersistState, stateUrl]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const createDeposit = useCallback(
    async (request: BankingDepositRequest) => {
      const body = {
        ...request,
        ...(customerRef ? { customerRef } : {}),
        ...(institutionId ? { institutionId } : {}),
      };
      const response = await bankingFetch('/deposit', jsonPost(body));
      const result = await readJsonResponse<BankingDepositResult>(response);
      await refresh();
      return result;
    },
    [refresh, customerRef, institutionId]
  );

  const receiveWire = useCallback(async () => {
    const response = await bankingFetch('/wire');
    return readJsonResponse<any>(response);
  }, []);

  const simulateCheckingWire = useCallback(
    async (amountUsd: number) => {
      const body: Record<string, unknown> = { amountUsd };
      if (customerRef) body.customer_ref = customerRef;
      if (institutionId) body.institutionId = institutionId;
      await bankingFetch('/wires/simulate', jsonPost(body));
      return refresh();
    },
    [refresh, customerRef, institutionId]
  );

  const createTreasuryBatch = useCallback(async (request: unknown) => {
    const response = await bankingFetch('/treasury/batches', jsonPost(request));
    return readJsonResponse(response);
  }, []);

  const retryCircleFunding = useCallback(
    async (termPositionId: string) => {
      await bankingFetch(`/term-positions/${termPositionId}/register-funding`, jsonPost());
      return refresh();
    },
    [refresh]
  );

  const reconcileFineract = useCallback(
    async () => {
      const body = institutionId ? { institutionId } : {};
      await bankingFetch('/fineract/reconcile', jsonPost(body));
      return refresh();
    },
    [refresh, institutionId]
  );

  return {
    state,
    loading,
    error,
    refresh,
    createDeposit,
    receiveWire,
    simulateCheckingWire,
    createTreasuryBatch,
    retryCircleFunding,
    reconcileFineract,
  };
}
