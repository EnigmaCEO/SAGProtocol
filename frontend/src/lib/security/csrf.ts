// Cross-site request forgery defence for cookie-authenticated routes.
//
// Two independent controls, either of which alone stops a classic CSRF:
//   1. The session cookie is `SameSite=Strict`, so a cross-site navigation or
//      form post carries no session at all (session.ts).
//   2. This module requires a same-origin `Origin` header — or, where the
//      browser sends it, `Sec-Fetch-Site: same-origin` — on every request to a
//      non-public route.
//
// Origin checking is chosen over a synchronizing token because it protects
// every existing call site immediately: no UI fetch has to be rewritten to
// thread a token, which means no write path is left unprotected because someone
// forgot to update it.

import type { NextApiRequest } from 'next';

export interface OriginCheck {
  ok: boolean;
  /** Present only when `ok` is false. */
  reason?: 'missing_origin' | 'origin_not_allowed' | 'cross_site_fetch';
}

function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value || value === 'null') return undefined;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return undefined;
  }
}

function headerOf(req: NextApiRequest, name: string): string | undefined {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * Verify the request originated from an approved origin.
 *
 * Safe methods are allowed through — they carry no state change, and blocking
 * them would break ordinary navigation.
 */
export function assertSameOrigin(req: NextApiRequest, allowedOrigins: string[]): OriginCheck {
  const method = String(req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { ok: true };

  // Fetch metadata, where the browser provides it, is the most direct signal.
  const fetchSite = headerOf(req, 'sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return { ok: false, reason: 'cross_site_fetch' };
  }

  const allowed = new Set(allowedOrigins.map(o => normalizeOrigin(o)).filter(Boolean) as string[]);

  // Prefer Origin; fall back to Referer, which browsers send on same-origin
  // XHR even in the rare configurations that suppress Origin.
  const origin = normalizeOrigin(headerOf(req, 'origin')) ?? normalizeOrigin(headerOf(req, 'referer'));
  if (!origin) {
    // A browser always sends one of these on a cross-origin unsafe request.
    // Absence means a non-browser client — which cannot be CSRF'd, but also
    // cannot present a cookie it never received. Requiring it keeps the rule simple.
    return { ok: false, reason: 'missing_origin' };
  }
  if (!allowed.has(origin)) return { ok: false, reason: 'origin_not_allowed' };

  return { ok: true };
}
