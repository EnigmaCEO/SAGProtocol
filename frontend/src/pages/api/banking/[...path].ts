// Generic banking read proxy.
//
// WHAT THIS USED TO BE
//   A method-transparent tunnel: it forwarded `req.method` verbatim to the
//   banking server for any `/banking/*` path (confirmed finding #7). Combined
//   with a backend that had no global authentication, that made every write
//   route reachable from any browser.
//
// WHAT IT IS NOW
//   GET only, and only for paths on an explicit allowlist derived from the
//   route authority registry. Unsafe methods return 405 — a write must go
//   through its own handler, which performs the session, scope, CSRF, and
//   assertion-minting steps this file deliberately does not.
//
// This proxy never mints an assertion. Every path it serves is declared
// `public` in the registry, so the banking server authorizes it as public too.
// If a path ever needs authority, it needs a dedicated handler, not a flag here.

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  PUBLIC_BANKING_GET_ALLOWLIST,
  matchesAllowlist,
} from '../../../../../services/shared/routeAuthority';
import { callBankingApi, sendUpstream } from '../../../lib/security/upstream';

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const method = String(req.method ?? 'GET').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({
      error: 'This proxy serves read requests only. Write operations require a dedicated, authenticated handler.',
      code: 'method_not_allowed',
    });
    return;
  }

  const segments = Array.isArray(req.query.path)
    ? req.query.path
    : [req.query.path ?? ''].filter(Boolean) as string[];
  const relativePath = `/${segments.join('/')}`;

  if (!matchesAllowlist(relativePath, PUBLIC_BANKING_GET_ALLOWLIST)) {
    // 404, not 403: an undeclared path should not be distinguishable from one
    // that does not exist.
    res.status(404).json({ error: 'Not found.', code: 'not_found' });
    return;
  }

  const query: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key === 'path' || value === undefined) continue;
    query[key] = value as string | string[];
  }

  // `session: null` means no assertion is minted. Client-supplied credentials
  // are never forwarded — callBankingApi builds its own header set.
  const result = await callBankingApi({
    method: 'GET',
    path: `/banking${relativePath}`,
    query,
    session: null,
    authorityClass: 'public',
    scopes: [],
    requestId: `proxy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timeoutMs: 20_000,
  });

  sendUpstream(res, result);
}
