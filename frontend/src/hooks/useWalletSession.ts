// Browser-side wallet sign-in.
//
// `useWallet()` connects a wallet — that proves nothing to the server. This hook
// completes the second half: the wallet signs a server-issued challenge, the
// server verifies it and resolves the address's authority, and the browser gets
// an HttpOnly session cookie that authorizes write requests.
//
// Every write API route requires that cookie. A connected-but-not-signed-in
// wallet can read the console but cannot change anything.

import { useCallback, useEffect, useState } from 'react';
import { buildLoginMessage } from '../lib/security/loginMessage';

export type WalletRole = 'viewer' | 'operator' | 'admin';

export interface SessionState {
  authenticated: boolean;
  address?: string;
  role?: WalletRole;
  scopes?: string[];
  institutionId?: string | null;
  expiresAt?: number;
}

const UNAUTHENTICATED: SessionState = { authenticated: false };

export function useWalletSession() {
  const [session, setSession] = useState<SessionState>(UNAUTHENTICATED);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
      setSession(res.ok ? await res.json() : UNAUTHENTICATED);
    } catch {
      setSession(UNAUTHENTICATED);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  /**
   * Run the sign-in flow for an already-connected address.
   * Returns the resulting session, or null if the user declined or it failed.
   */
  const signIn = useCallback(async (address: string): Promise<SessionState | null> => {
    setError(null);
    const eth = (window as any).ethereum;
    if (!eth?.request) {
      setError('No browser wallet detected.');
      return null;
    }

    try {
      // 1. Server issues a single-use nonce bound to an HttpOnly cookie, and
      //    dictates every other field of the challenge. The client chooses
      //    nothing here — not the chain, not the validity window.
      const nonceRes = await fetch('/api/auth/nonce', { credentials: 'same-origin' });
      if (!nonceRes.ok) throw new Error('Could not start sign-in.');
      const { nonce, chainId, issuedAt, expirationTime } = await nonceRes.json() as {
        nonce: string; chainId: number; issuedAt: string; expirationTime: string;
      };

      // 2. Build the challenge from the SAME builder the server uses, so the
      //    bytes the user signs are exactly the bytes the server verifies.
      const message = buildLoginMessage({
        address,
        nonce,
        domain: window.location.host,
        uri: window.location.origin,
        chainId,
        issuedAt,
        expirationTime,
      });

      // 3. Wallet signs it. personal_sign takes (message, address).
      const signature = await eth.request({
        method: 'personal_sign',
        params: [message, address],
      }) as string;

      // 4. Server verifies the signature and resolves authority.
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, signature, nonce, issuedAt, expirationTime }),
      });

      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Sign-in failed.');
      }

      const next = await verifyRes.json() as SessionState;
      setSession(next);
      return next;
    } catch (err: any) {
      // User rejection is not an error worth shouting about.
      const message = err?.code === 4001 ? 'Sign-in was cancelled.' : String(err?.message ?? err);
      setError(message);
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      setSession(UNAUTHENTICATED);
    }
  }, []);

  const hasScope = useCallback(
    (scope: string) => Boolean(session.authenticated && session.scopes?.includes(scope)),
    [session],
  );

  return { session, loading, error, signIn, signOut, refresh, hasScope };
}
