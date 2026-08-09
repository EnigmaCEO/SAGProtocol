// Browser-wallet session.
//
// AUTHENTICATION MODEL
//   The wallet proves control of an address by signing a nonce-bound challenge
//   (EIP-4361 "Sign-In with Ethereum" shape, verified with ethers.verifyMessage).
//   The nonce is issued by the server, stored in a signed HttpOnly cookie, and
//   is single-use — a signature captured from one login cannot start another
//   session.
//
//   Authority is NOT derived from the address alone. `walletAuthority.ts`
//   resolves the address against the on-chain role authority registry and the
//   configured wallet allowlists; an unknown wallet gets `viewer` (read-only).
//
// CSRF
//   Session cookies are `SameSite=Strict`, and `csrf.ts` additionally requires
//   a same-origin `Origin`/`Sec-Fetch-Site` on every unsafe method. Two
//   independent controls, neither of which requires call sites to thread a
//   token through every fetch.

import crypto from 'node:crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { frontendSecurityConfig } from './config';
import { ROLE_SCOPES, type Scope } from '../../../../services/shared/routeAuthority';

// `__Host-` locks the cookie to this exact origin: the browser refuses to
// accept it with a Domain attribute or a non-root Path, so a subdomain cannot
// set or overwrite it. It requires Secure, which is why development — served
// over plain http — falls back to an unprefixed name.
export function sessionCookieName(): string {
  return frontendSecurityConfig().isProtected ? '__Host-sagitta_session' : 'sagitta_session';
}

export function nonceCookieName(): string {
  return frontendSecurityConfig().isProtected ? '__Host-sagitta_nonce' : 'sagitta_nonce';
}

export type WalletRole = 'viewer' | 'operator' | 'admin';

export interface WalletSession {
  /** Lowercase 0x address. */
  address: string;
  role: WalletRole;
  scopes: Scope[];
  /** Institution the wallet is bound to, when it is tenant-scoped. */
  institutionId?: string;
  issuedAt: number;
  expiresAt: number;
}

// ─── Cookie signing ───────────────────────────────────────────────────────────

function sign(value: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function serialize(payload: unknown, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

function deserialize<T>(cookie: string | undefined, secret: string): T | null {
  if (!cookie || typeof cookie !== 'string') return null;
  const [body, mac] = cookie.split('.');
  if (!body || !mac) return null;

  const expected = Buffer.from(sign(body, secret), 'utf8');
  const provided = Buffer.from(mac, 'utf8');
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;

  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function readCookie(req: NextApiRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function setCookie(res: NextApiResponse, name: string, value: string, maxAgeSeconds: number): void {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (frontendSecurityConfig().isProtected) attributes.push('Secure');

  const existing = res.getHeader('Set-Cookie');
  const next = Array.isArray(existing) ? [...existing, attributes.join('; ')]
    : existing ? [String(existing), attributes.join('; ')]
    : [attributes.join('; ')];
  res.setHeader('Set-Cookie', next);
}

function clearCookie(res: NextApiResponse, name: string): void {
  setCookie(res, name, '', 0);
}

// ─── Login nonce ──────────────────────────────────────────────────────────────

interface NoncePayload {
  nonce: string;
  issuedAt: number;
}

const NONCE_TTL_SECONDS = 300;

/** Issue a single-use login nonce and bind it to a signed cookie. */
export function issueNonce(res: NextApiResponse): string {
  const config = frontendSecurityConfig();
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload: NoncePayload = { nonce, issuedAt: Math.floor(Date.now() / 1000) };
  setCookie(res, nonceCookieName(), serialize(payload, config.sessionSecret), NONCE_TTL_SECONDS);
  return nonce;
}

/**
 * Consume the browser-binding half of the login nonce.
 * Atomic single-use is enforced separately by nonceStore.claim(); this proves
 * the challenge was issued to THIS browser.
 * Returns false if it is absent, expired, or does not
 * match what the client signed. Always clears the cookie, so a nonce cannot be
 * used twice even on a failed attempt.
 */
export function consumeNonceCookie(req: NextApiRequest, res: NextApiResponse, presented: string): boolean {
  const config = frontendSecurityConfig();
  const payload = deserialize<NoncePayload>(readCookie(req, nonceCookieName()), config.sessionSecret);
  clearCookie(res, nonceCookieName());

  if (!payload?.nonce) return false;
  if (Math.floor(Date.now() / 1000) - payload.issuedAt > NONCE_TTL_SECONDS) return false;

  const a = Buffer.from(payload.nonce, 'utf8');
  const b = Buffer.from(String(presented ?? ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Session lifecycle ────────────────────────────────────────────────────────

export function issueSession(
  res: NextApiResponse,
  params: { address: string; role: WalletRole; institutionId?: string },
): WalletSession {
  const config = frontendSecurityConfig();
  const now = Math.floor(Date.now() / 1000);
  const session: WalletSession = {
    address: params.address.toLowerCase(),
    role: params.role,
    scopes: [...ROLE_SCOPES[params.role]],
    ...(params.institutionId ? { institutionId: params.institutionId } : {}),
    issuedAt: now,
    expiresAt: now + config.sessionTtlSeconds,
  };
  setCookie(res, sessionCookieName(), serialize(session, config.sessionSecret), config.sessionTtlSeconds);
  return session;
}

/** Read and validate the session. Returns null when absent, tampered, or expired. */
export function readSession(req: NextApiRequest): WalletSession | null {
  const config = frontendSecurityConfig();
  const session = deserialize<WalletSession>(readCookie(req, sessionCookieName()), config.sessionSecret);
  if (!session?.address || !session.expiresAt) return null;
  if (Math.floor(Date.now() / 1000) >= session.expiresAt) return null;
  if (!Array.isArray(session.scopes)) return null;
  return session;
}

export function clearSession(res: NextApiResponse): void {
  clearCookie(res, sessionCookieName());
}

/** Public view of a session. Contains nothing that could reconstruct the cookie. */
export function publicSessionView(session: WalletSession | null) {
  if (!session) return { authenticated: false as const };
  return {
    authenticated: true as const,
    address: session.address,
    role: session.role,
    scopes: session.scopes,
    institutionId: session.institutionId ?? null,
    expiresAt: session.expiresAt,
  };
}
