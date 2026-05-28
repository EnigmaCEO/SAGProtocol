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

function persistState(nextState: BankingState) {
  if (typeof window === 'undefined' || !nextState) return;
  window.localStorage.setItem(BANKING_STORAGE_KEY, JSON.stringify(nextState));
}

function readStoredState(): BankingState | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BANKING_STORAGE_KEY);
  if (!raw) return null;

  try {
    return normalizeBankingState(JSON.parse(raw));
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

export interface BankingAccountRecord {
  institutionId: string;
  customerRef: string;
  fineractClientId: number | null;
  savingsAccountId: number | null;
  fineractOnboarded: boolean;
  openedAt: string;
}

export function readBankingAccount(): BankingAccountRecord | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(BANKING_ACCOUNT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as BankingAccountRecord; } catch { return null; }
}

export function saveBankingAccount(record: BankingAccountRecord): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BANKING_ACCOUNT_KEY, JSON.stringify(record));
}

export function clearBankingAccount(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(BANKING_ACCOUNT_KEY);
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
  return readJsonResponse<BankInstitution>(response);
}

export default function useBankingData(institutionId?: string, customerRef?: string) {
  const [state, setState] = useState<BankingState | null>(() => readStoredState());
  const [loading, setLoading] = useState(!state);
  const [error, setError] = useState<string | null>(null);

  const setAndPersistState = useCallback((nextState: unknown) => {
    const normalizedState = normalizeBankingState(nextState);
    setState(normalizedState);
    persistState(normalizedState);
  }, []);

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
