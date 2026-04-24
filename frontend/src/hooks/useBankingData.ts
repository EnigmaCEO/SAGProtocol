import { useCallback, useEffect, useState } from 'react';

import type {
  BankingDashboardState,
  BankingBatchRequest,
  BankingBatchResponse,
  BankingDepositRequest,
  BankingDepositResponse,
} from '../lib/banking/types';

const BANKING_STORAGE_KEY = 'sagitta:banking-state';

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || 'Request failed');
  }
  return payload as T;
}

export default function useBankingData() {
  const [state, setState] = useState<BankingDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persistState = useCallback((nextState: BankingDashboardState) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(BANKING_STORAGE_KEY, JSON.stringify(nextState));
  }, []);

  const readStoredState = useCallback((): BankingDashboardState | null => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(BANKING_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as BankingDashboardState;
    } catch {
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/banking/state');
      const payload = await readJson<BankingDashboardState>(response);
      persistState(payload);
      setState(payload);
    } catch (err: any) {
      const cached = readStoredState();
      if (cached) setState(cached);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, [persistState, readStoredState]);

  const createDeposit = useCallback(async (request: BankingDepositRequest) => {
    const response = await fetch('/api/banking/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload = await readJson<BankingDepositResponse>(response);
    persistState(payload.state);
    setState(payload.state);
    return payload;
  }, [persistState]);

  const receiveWire = useCallback(async () => {
    const response = await fetch('/api/banking/wire', {
      method: 'GET',
    });
    const instructions = await readJson<any>(response);
    setError(null);
    return instructions;
  }, []);

  const simulateCheckingWire = useCallback(async (amountUsd = 1000) => {
    const response = await fetch('/api/banking/wires/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountUsd }),
    });
    const payload = await readJson<{ state: BankingDashboardState }>(response);
    const nextState = payload.state;
    persistState(nextState);
    setState(nextState);
    setError(null);
    return nextState;
  }, [persistState]);

  const createTreasuryBankBatch = useCallback(async (request: BankingBatchRequest = {}) => {
    const response = await fetch('/api/banking/treasury/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const payload = await readJson<BankingBatchResponse>(response);
    persistState(payload.state);
    setState(payload.state);
    setError(null);
    return payload;
  }, [persistState]);

  const retryCircleFunding = useCallback(async (termPositionId: string) => {
    const response = await fetch(`/api/banking/term-positions/${termPositionId}/register-funding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const nextState = await readJson<BankingDashboardState>(response);
    persistState(nextState);
    setState(nextState);
    setError(null);
    return nextState;
  }, [persistState]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    state,
    loading,
    error,
    refresh,
    createDeposit,
    receiveWire,
    simulateCheckingWire,
    createTreasuryBankBatch,
    retryCircleFunding,
  };
}
