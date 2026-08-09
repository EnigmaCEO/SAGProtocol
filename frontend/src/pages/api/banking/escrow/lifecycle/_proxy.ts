/**
 * Read-through helper for the public lifecycle GET routes.
 *
 * WHAT CHANGED
 *   This helper previously forwarded any client-supplied `x-admin-token` and
 *   `x-internal-token` header straight to the banking server, and forwarded
 *   `req.method` verbatim. That let a browser hand the backend whatever
 *   administrative credential it liked and use this file as a write tunnel.
 *
 *   It is now GET-only and mints no credentials. Writes go through their own
 *   handlers, which authenticate the wallet session first and mint a scoped
 *   assertion via `callBankingApi`.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { callBankingApi, sendUpstream } from '../../../../../lib/security/upstream';

export async function proxyReadToServer(
  req: NextApiRequest,
  res: NextApiResponse,
  serverPath: string,
): Promise<void> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path' || value === undefined) continue; // catch-all segment is routing detail
    query[key] = value as string | string[];
  }

  const result = await callBankingApi({
    method: 'GET',
    path: serverPath,
    query,
    session: null,       // public read — no assertion minted
    authorityClass: 'public',
    scopes: [],
    requestId: `lc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timeoutMs: 20_000,
  });

  sendUpstream(res, result);
}
