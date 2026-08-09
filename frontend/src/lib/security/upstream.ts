// Authenticated calls from the Next.js layer to the banking server.
//
// The public Next.js proxy is NOT a security boundary — the Fly origin remains
// directly reachable (confirmed findings #1 and #8). So this module does not
// "pass the request through"; it mints a fresh, short-lived, method- and
// path-bound assertion describing the *already verified* actor, which the
// banking server verifies independently before executing anything.
//
// Client-supplied credentials are never forwarded. A browser that sends
// `x-admin-token` or `x-sagitta-assertion` gets it dropped on the floor here.

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  mintAssertion,
  ASSERTION_HEADER,
  REQUEST_ID_HEADER,
  type AuthorityClass,
} from '../../../../services/shared/serviceAuth';
import { SERVICE_IDS, type Scope } from '../../../../services/shared/routeAuthority';
import { frontendSecurityConfig } from './config';
import type { WalletSession } from './session';

const PUBLIC_BANKING_API_URL = 'https://sag-banking-server.fly.dev';

export function resolveBankingApiUrl(): string {
  const configured = (process.env.BANKING_API_URL || process.env.BANKING_PUBLIC_API_URL || '').trim().replace(/\/$/, '');
  if (configured) {
    const isFlyInternal = /\.internal(?::\d+)?$/i.test(configured) || /\.internal[:/]/i.test(configured);
    if (!isFlyInternal || process.env.FLY_APP_NAME) return configured;
  }
  if (process.env.NODE_ENV === 'development') return 'http://localhost:4000';
  return PUBLIC_BANKING_API_URL;
}

/**
 * Headers a browser is never allowed to control on an upstream request.
 * Anything a client sends under these names is dropped, not forwarded.
 */
const CLIENT_CONTROLLED_HEADER_DENYLIST = [
  'authorization',
  'x-sagitta-assertion',
  'x-admin-token',
  'x-admin-identity',
  'x-internal-token',
  'cookie',
];

export interface UpstreamCallOptions {
  method: string;
  /** Path on the banking server, e.g. `/banking/escrow/lifecycle/advance`. */
  path: string;
  body?: unknown;
  /** Query string parameters to append. */
  query?: Record<string, string | string[] | undefined>;
  /** The verified actor. Null mints no assertion (public GET passthrough). */
  session: WalletSession | null;
  /** Authority class to assert. Must match the banking server's declaration. */
  authorityClass: AuthorityClass;
  /** Scopes to assert. Must be a subset of what the session actually holds. */
  scopes: readonly Scope[];
  requestId: string;
  /** Idempotency key forwarded to the banking server for financial routes. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface UpstreamResult {
  status: number;
  data: unknown;
}

/** Call the banking server as an authenticated actor. */
export async function callBankingApi(options: UpstreamCallOptions): Promise<UpstreamResult> {
  const config = frontendSecurityConfig();
  const method = options.method.toUpperCase();

  const url = new URL(`${resolveBankingApiUrl()}${options.path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
    else url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [REQUEST_ID_HEADER]: options.requestId,
  };

  // Serialize ONCE and send exactly these bytes. The assertion binds their
  // SHA-256, so the banking server's second-pass check can only succeed if the
  // body it received is byte-identical to the one authorized here.
  const serializedBody = method !== 'GET' && method !== 'HEAD'
    ? JSON.stringify(options.body ?? {})
    : undefined;

  if (options.session) {
    // Scopes asserted can never exceed what the session actually holds — a
    // handler asking for more than the wallet has is a bug, and silently
    // widening authority here would defeat the whole scope model.
    const granted = new Set(options.session.scopes);
    const asserted = options.scopes.filter(scope => granted.has(scope));
    if (asserted.length !== options.scopes.length) {
      throw new Error('Refusing to mint an assertion with scopes the session does not hold.');
    }

    headers[ASSERTION_HEADER] = mintAssertion(config.internalAssertionSecret, {
      iss: SERVICE_IDS.frontend,
      aud: SERVICE_IDS.banking,
      cls: options.authorityClass,
      sub: options.session.address,
      org: options.session.institutionId,
      scp: asserted,
      mth: method,
      pth: options.path,
      rid: options.requestId,
      body: serializedBody,
      contentType: 'application/json',
    }, { ttlSeconds: 60 });
  }

  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const upstream = await fetch(url, {
      method,
      headers,
      ...(serializedBody !== undefined ? { body: serializedBody } : {}),
      signal: controller.signal,
    });

    const raw = await readBounded(upstream, config.maxBodyBytes);
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      // Never echo an unparsed upstream body — it could contain anything.
      data = { error: `Upstream returned HTTP ${upstream.status}` };
    }
    return { status: upstream.status, data };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { status: 504, data: { error: 'Banking API timed out.', code: 'upstream_timeout' } };
    }
    console.error('[security] Upstream call failed', {
      requestId: options.requestId,
      path: options.path,
      message: String(err?.message ?? err),
    });
    return { status: 502, data: { error: 'Banking API unavailable.', code: 'upstream_unavailable' } };
  } finally {
    clearTimeout(timeout);
  }
}

/** Read a response body, refusing anything over the configured limit. */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('Upstream response exceeds the configured size limit.');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error('Upstream response exceeds the configured size limit.');
  }
  return text;
}

/**
 * Strip headers a browser must not control before any forwarding decision.
 * Call this on every proxy path — it is the mechanical form of "never accept
 * client-supplied internal or administrative credentials".
 */
export function stripClientControlledHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (CLIENT_CONTROLLED_HEADER_DENYLIST.includes(key.toLowerCase())) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/** Send an upstream result to the browser without leaking upstream headers. */
export function sendUpstream(res: NextApiResponse, result: UpstreamResult): void {
  res.status(result.status).json(result.data ?? {});
}

/** Convenience: read a single query parameter as a string. */
export function queryString(req: NextApiRequest, key: string): string | undefined {
  const value = req.query[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first ? first : undefined;
}
