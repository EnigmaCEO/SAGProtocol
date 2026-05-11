import { useCallback, useEffect, useState } from 'react';

import { createSeedBankingState } from '../lib/banking/demoStore';
import type { BankingDashboardState, BankingDepositRequest } from '../lib/banking/types';

const BANKING_STORAGE_KEY = 'sagitta:banking-state';
const PUBLIC_BANKING_API_URL = process.env.NEXT_PUBLIC_BANKING_API_URL?.replace(/\/$/, '');
const BANKING_API_PREFIXES = [
  ...(PUBLIC_BANKING_API_URL ? [`${PUBLIC_BANKING_API_URL}/banking`] : []),
  '/api/banking',
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

export default function useBankingData() {
  const [state, setState] = useState<BankingState | null>(() => readStoredState());
  const [loading, setLoading] = useState(!state);
  const [error, setError] = useState<string | null>(null);

  const setAndPersistState = useCallback((nextState: unknown) => {
    const normalizedState = normalizeBankingState(nextState);
    setState(normalizedState);
    persistState(normalizedState);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await bankingFetch('/state');
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
  }, [setAndPersistState]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const createDeposit = useCallback(
    async (request: BankingDepositRequest) => {
      const response = await bankingFetch('/deposit', jsonPost(request));
      const result = await readJsonResponse<BankingDepositResult>(response);
      const nextState = result.state || result.dashboardState;
      if (nextState) setAndPersistState(nextState);
      return result;
    },
    [setAndPersistState]
  );

  const receiveWire = useCallback(async () => {
    const response = await bankingFetch('/wire');
    return readJsonResponse<any>(response);
  }, []);

  const simulateCheckingWire = useCallback(
    async (amountUsd: number) => {
      const response = await bankingFetch('/wires/simulate', jsonPost({ amountUsd }));
      const nextState = await readJsonResponse<BankingState>(response);
      setAndPersistState(nextState);
      return nextState;
    },
    [setAndPersistState]
  );

  const createTreasuryBatch = useCallback(async (request: unknown) => {
    const response = await bankingFetch('/treasury/batches', jsonPost(request));
    return readJsonResponse(response);
  }, []);

  const retryCircleFunding = useCallback(
    async (termPositionId: string) => {
      const response = await bankingFetch(`/term-positions/${termPositionId}/register-funding`, jsonPost());
      const nextState = await readJsonResponse<BankingState>(response);
      setAndPersistState(nextState);
      return nextState;
    },
    [setAndPersistState]
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
  };
}
