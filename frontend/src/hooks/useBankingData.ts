import { useCallback, useEffect, useState } from 'react';

import type {
  BankingDashboardState,
  BankingDepositRequest,
  BankingDepositResponse,
} from '../lib/banking/types';
import {
  applyBankingDeposit,
  applyIncomingWire,
  BANKING_STORAGE_KEY,
  createSeedBankingState,
} from '../lib/banking/demoStore';

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
      const storedState = readStoredState();
      if (storedState) {
        setState(storedState);
        return;
      }
      const response = await fetch('/api/banking/state');
      const payload = await readJson<BankingDashboardState>(response);
      persistState(payload);
      setState(payload);
    } catch (err: any) {
      const fallbackState = createSeedBankingState();
      persistState(fallbackState);
      setState(fallbackState);
      setError(String(err?.message || err));
    } finally {
      setLoading(false);
    }
  }, [persistState, readStoredState]);

  const createDeposit = useCallback(async (request: BankingDepositRequest) => {
    const currentState = state ?? readStoredState() ?? createSeedBankingState();
    const payload: BankingDepositResponse = applyBankingDeposit(currentState, request);
    persistState(payload.state);
    setState(payload.state);
    return payload;
  }, [persistState, readStoredState, state]);

  const receiveWire = useCallback((amountUsd = 1000) => {
    const currentState = state ?? readStoredState() ?? createSeedBankingState();
    const nextState = applyIncomingWire(currentState, amountUsd);
    persistState(nextState);
    setState(nextState);
    setError(null);
    return nextState;
  }, [persistState, readStoredState, state]);

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
  };
}
