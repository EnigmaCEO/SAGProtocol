// Shared service-to-service authorization primitives.
//
// Dependency-free (node:crypto only) so it can be compiled into the banking
// server, every signer service, the wallet factory, and the Next.js frontend
// without adding a package to any of them.
//
// SECURITY CONTRACT
//   - Deny by default. Every helper here fails closed.
//   - Never log a secret, an assertion token, a MAC, or an Authorization header.
//   - Assertions are bound to audience + method + path so a token minted for a
//     read cannot be replayed against a write, and a token minted for one
//     service cannot be presented to another.
//
// Token format (compact, URL-safe, no external JWT dependency):
//   sag1.<base64url(JSON claims)>.<base64url(HMAC-SHA256)>
// The MAC covers the literal string `sag1.<payload>` — prefix included, so a
// future `sag2` format cannot be downgraded onto a v1 verifier.

import crypto from 'node:crypto';

export const ASSERTION_PREFIX = 'sag1';

/** Header the banking server and internal services read assertions from. */
export const ASSERTION_HEADER = 'x-sagitta-assertion';

/** Header carrying the caller-supplied request id (echoed into audit events). */
export const REQUEST_ID_HEADER = 'x-sagitta-request-id';

// ─── Authority classes ────────────────────────────────────────────────────────

/**
 * Who is allowed to call a route.
 *
 *  public   — no credential; safe methods only.
 *  user     — a browser-wallet session verified at the Next.js layer, forwarded
 *             to the backend as a signed assertion with cls='user'.
 *  internal — service-to-service (lifecycle workers, automation, reconciliation).
 *  admin    — repair / retry / settlement finalization / dev administration.
 *  webhook  — provider callback authenticated by provider signature, not by us.
 *  signer   — privileged signature or transaction production. Callers must be
 *             an approved service identity; never a browser.
 */
export type AuthorityClass = 'public' | 'user' | 'internal' | 'admin' | 'webhook' | 'signer';

export const AUTHORITY_CLASSES: readonly AuthorityClass[] = [
  'public', 'user', 'internal', 'admin', 'webhook', 'signer',
];

// ─── Claims ───────────────────────────────────────────────────────────────────

export interface AssertionClaims {
  /** Format version. Only 1 is accepted. */
  v: 1;
  /** Issuing service id, e.g. 'protocol-frontend'. */
  iss: string;
  /** Intended audience service id, e.g. 'banking-server'. Verified, not advisory. */
  aud: string;
  /** Authority class this assertion carries. */
  cls: AuthorityClass;
  /**
   * Actor identity.
   *   cls='user'      → lowercase 0x wallet address
   *   cls='internal'  → issuing service id
   *   cls='admin'     → lowercase 0x wallet address, or 'admin-token' for the
   *                     break-glass header path
   *   cls='signer'    → calling service id
   */
  sub: string;
  /** Tenant / institution scope. Absent means protocol-wide authority. */
  org?: string;
  /** Granted scopes. Route policies require a subset of these. */
  scp: string[];
  /** Uppercase HTTP method this assertion authorizes. */
  mth: string;
  /** Canonical request path (pathname only, no query, no trailing slash). */
  pth: string;
  /**
   * SHA-256 (hex) of the EXACT request bytes this assertion authorizes.
   * Method and path binding alone still permits body substitution on first
   * use: an attacker who intercepts a token for POST /banking/deposit could
   * swap the amount. Binding the body digest closes that.
   * The digest of an empty body is the SHA-256 of the empty string.
   */
  bdy: string;
  /** Content-Type the digest was computed under. Prevents type confusion. */
  cty: string;
  /**
   * Operation context for privileged signer calls: which chain, which
   * operation, which contract, which resource. A signer assertion is only
   * valid for the exact on-chain action it names.
   */
  ctx?: AssertionContext;
  /** Correlation id, surfaced in audit events on both sides. */
  rid: string;
  /** Unique token id — the replay-protection key. */
  jti: string;
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

/** Operation context bound into a signer-class assertion. */
export interface AssertionContext {
  /** EVM chain id the operation targets. */
  chainId?: number;
  /** Logical operation name, e.g. 'anchor', 'deploy-leg'. */
  op?: string;
  /** Contract address the operation touches, lowercase. */
  contract?: string;
  /** Primary resource identifier, e.g. sourceBatchId. */
  resource?: string;
}

export interface MintOptions {
  /** Lifetime in seconds. Clamped to [5, 300]; default 120. */
  ttlSeconds?: number;
  /** Override issued-at, for tests. */
  nowSeconds?: number;
}

export interface VerifyExpectations {
  /** This service's own id. An assertion for a different audience is rejected. */
  audience: string;
  /** Uppercase HTTP method of the request being authorized. */
  method: string;
  /** Path of the request being authorized; canonicalized before comparison. */
  path: string;
  /** If set, the assertion's class must be one of these. */
  allowedClasses?: readonly AuthorityClass[];
  /** If set, every scope listed here must be present in the assertion. */
  requiredScopes?: readonly string[];
  /**
   * Exact received request bytes. When provided, the digest must match the
   * one bound into the assertion. Omit ONLY in a pre-body authentication pass
   * that does not consume the replay claim.
   */
  body?: string | Buffer;
  /** Content-Type of the received request. Compared to the bound value. */
  contentType?: string;
  /** Required operation context. Every field present here must match. */
  context?: AssertionContext;
  /** Accepted clock skew in seconds. Default 30. */
  clockSkewSeconds?: number;
  /** Override current time, for tests. */
  nowSeconds?: number;
}

export type VerifyResult =
  | { outcome: 'verified'; claims: AssertionClaims }
  | { outcome: 'denied'; reason: VerifyFailureReason };

export type VerifyFailureReason =
  | 'missing'
  | 'malformed'
  | 'bad_signature'
  | 'unsupported_version'
  | 'audience_mismatch'
  | 'method_mismatch'
  | 'path_mismatch'
  | 'expired'
  | 'not_yet_valid'
  | 'replayed'
  | 'class_not_allowed'
  | 'insufficient_scope'
  | 'body_mismatch'
  | 'content_type_mismatch'
  | 'context_mismatch'
  | 'replay_store_unavailable';

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function b64uEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function b64uDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/**
 * Canonical path form used for assertion binding.
 * Strips query/fragment, collapses duplicate slashes, drops a trailing slash,
 * and lowercases — so `/Banking/Deposit/` and `/banking/deposit?x=1` agree.
 */
export function canonicalizePath(path: string): string {
  const withoutQuery = String(path ?? '').split('?')[0].split('#')[0];
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/');
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
  return (trimmed || '/').toLowerCase();
}

/** Constant-time string comparison that does not leak length via early return. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  // Hash both sides first so differing lengths still take the same path.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB) && bufA.length === bufB.length;
}

// ─── Mint ─────────────────────────────────────────────────────────────────────

const MIN_TTL_SECONDS = 5;
const MAX_TTL_SECONDS = 300;
const DEFAULT_TTL_SECONDS = 120;

export interface MintInput {
  iss: string;
  aud: string;
  cls: AuthorityClass;
  sub: string;
  org?: string;
  scp?: readonly string[];
  mth: string;
  pth: string;
  rid?: string;
  /** Exact bytes that will be sent. Digested and bound into the assertion. */
  body?: string | Buffer;
  /** Content-Type the body will be sent with. Defaults to application/json. */
  contentType?: string;
  ctx?: AssertionContext;
}

/**
 * Produce a signed, short-lived, method+path+audience-bound assertion.
 * Throws if the secret is too weak — a weak secret must never silently produce
 * a token that looks authoritative.
 */
export function mintAssertion(secret: string, input: MintInput, options: MintOptions = {}): string {
  assertUsableSecret(secret);

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.min(
    MAX_TTL_SECONDS,
    Math.max(MIN_TTL_SECONDS, options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  );

  const claims: AssertionClaims = {
    v: 1,
    iss: input.iss,
    aud: input.aud,
    cls: input.cls,
    sub: input.sub,
    ...(input.org ? { org: input.org } : {}),
    scp: [...(input.scp ?? [])],
    mth: String(input.mth ?? '').toUpperCase(),
    pth: canonicalizePath(input.pth),
    bdy: bodyDigest(input.body),
    cty: normalizeContentType(input.contentType),
    ...(input.ctx ? { ctx: normalizeContext(input.ctx) } : {}),
    rid: input.rid || crypto.randomUUID(),
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + ttl,
  };

  const payload = b64uEncode(JSON.stringify(claims));
  const signingInput = `${ASSERTION_PREFIX}.${payload}`;
  const mac = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64uEncode(mac)}`;
}

// ─── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify an assertion against this service's expectations.
 *
 * Order matters: signature is checked before any claim is trusted, and the
 * replay guard is consumed last so a token rejected for another reason does not
 * burn its jti (which would let an attacker grief a legitimate retry).
 */
export function verifyAssertion(
  secret: string,
  token: string | undefined | null,
  expectations: VerifyExpectations,
): VerifyResult {
  if (!token || typeof token !== 'string') return { outcome: 'denied', reason: 'missing' };
  assertUsableSecret(secret);

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== ASSERTION_PREFIX) {
    return { outcome: 'denied', reason: 'malformed' };
  }
  const [, payload, mac] = parts;

  const signingInput = `${ASSERTION_PREFIX}.${payload}`;
  const expectedMac = crypto.createHmac('sha256', secret).update(signingInput).digest();
  let providedMac: Buffer;
  try {
    providedMac = b64uDecode(mac);
  } catch {
    return { outcome: 'denied', reason: 'malformed' };
  }
  if (providedMac.length !== expectedMac.length || !crypto.timingSafeEqual(providedMac, expectedMac)) {
    return { outcome: 'denied', reason: 'bad_signature' };
  }

  let claims: AssertionClaims;
  try {
    claims = JSON.parse(b64uDecode(payload).toString('utf8')) as AssertionClaims;
  } catch {
    return { outcome: 'denied', reason: 'malformed' };
  }

  if (claims.v !== 1) return { outcome: 'denied', reason: 'unsupported_version' };
  if (!claims.jti || !claims.iss || !claims.aud || !claims.sub) return { outcome: 'denied', reason: 'malformed' };
  if (!AUTHORITY_CLASSES.includes(claims.cls)) return { outcome: 'denied', reason: 'malformed' };
  if (!Array.isArray(claims.scp)) return { outcome: 'denied', reason: 'malformed' };
  if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number') {
    return { outcome: 'denied', reason: 'malformed' };
  }

  if (claims.aud !== expectations.audience) return { outcome: 'denied', reason: 'audience_mismatch' };

  if (claims.mth !== String(expectations.method ?? '').toUpperCase()) {
    return { outcome: 'denied', reason: 'method_mismatch' };
  }
  if (claims.pth !== canonicalizePath(expectations.path)) {
    return { outcome: 'denied', reason: 'path_mismatch' };
  }

  const skew = expectations.clockSkewSeconds ?? 30;
  const now = expectations.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (now > claims.exp + skew) return { outcome: 'denied', reason: 'expired' };
  if (now < claims.iat - skew) return { outcome: 'denied', reason: 'not_yet_valid' };
  // An over-long lifetime is treated as forged: a legitimate minter clamps TTL.
  if (claims.exp - claims.iat > MAX_TTL_SECONDS) return { outcome: 'denied', reason: 'expired' };

  if (expectations.allowedClasses && !expectations.allowedClasses.includes(claims.cls)) {
    return { outcome: 'denied', reason: 'class_not_allowed' };
  }

  const required = expectations.requiredScopes ?? [];
  if (required.length > 0) {
    const granted = new Set(claims.scp);
    for (const scope of required) {
      if (!granted.has(scope)) return { outcome: 'denied', reason: 'insufficient_scope' };
    }
  }

  // ── Request-body binding ────────────────────────────────────────────────
  // Only checked when the caller supplies the received bytes. The banking
  // server runs a first pass WITHOUT them (before body parsing, so anonymous
  // writes are rejected without reading a body) and a second pass WITH them.
  if (expectations.body !== undefined) {
    if (typeof claims.bdy !== 'string' || claims.bdy !== bodyDigest(expectations.body)) {
      return { outcome: 'denied', reason: 'body_mismatch' };
    }
    if (normalizeContentType(expectations.contentType) !== normalizeContentType(claims.cty)) {
      return { outcome: 'denied', reason: 'content_type_mismatch' };
    }
  }

  // ── Operation context ───────────────────────────────────────────────────
  if (expectations.context && !contextMatches(claims.ctx, expectations.context)) {
    return { outcome: 'denied', reason: 'context_mismatch' };
  }

  return { outcome: 'verified', claims };
}

/**
 * Atomically claim an assertion's single use.
 *
 * Deliberately separate from `verifyAssertion` so a token rejected for another
 * reason does not burn its `jti` — that would let an attacker grief a
 * legitimate retry by replaying a token they know will fail a later check.
 * Call this LAST, only once every other check has passed.
 *
 * A store failure is a DENIAL, never an allow: without a working claim store we
 * cannot prove the token is fresh.
 */
export async function claimAssertion(
  store: { claim(jti: string, expiresAtSeconds: number): Promise<boolean> },
  claims: AssertionClaims,
): Promise<{ outcome: 'verified' } | { outcome: 'denied'; reason: VerifyFailureReason }> {
  let claimed: boolean;
  try {
    claimed = await store.claim(claims.jti, claims.exp);
  } catch {
    return { outcome: 'denied', reason: 'replay_store_unavailable' };
  }
  return claimed ? { outcome: 'verified' } : { outcome: 'denied', reason: 'replayed' };
}

// ─── Body and context binding helpers ─────────────────────────────────────────

/** SHA-256 (hex) of the exact request bytes. An absent body digests as empty. */
export function bodyDigest(body: string | Buffer | undefined | null): string {
  const buffer = body === undefined || body === null
    ? Buffer.alloc(0)
    : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Content-Type without parameters, lowercased. `application/json; charset=utf-8` → `application/json`. */
export function normalizeContentType(value: string | undefined | null): string {
  const raw = String(value ?? 'application/json').split(';')[0].trim().toLowerCase();
  return raw || 'application/json';
}

function normalizeContext(context: AssertionContext): AssertionContext {
  return {
    ...(context.chainId !== undefined ? { chainId: Number(context.chainId) } : {}),
    ...(context.op ? { op: String(context.op).toLowerCase() } : {}),
    ...(context.contract ? { contract: String(context.contract).toLowerCase() } : {}),
    ...(context.resource ? { resource: String(context.resource) } : {}),
  };
}

/**
 * Every field the verifier requires must be present in the assertion and equal.
 * A missing field on the assertion side is a mismatch, not a pass — otherwise
 * omitting `chainId` would bypass the chain check.
 */
function contextMatches(actual: AssertionContext | undefined, expected: AssertionContext): boolean {
  if (!actual) return false;
  const a = normalizeContext(actual);
  const e = normalizeContext(expected);
  for (const key of Object.keys(e) as Array<keyof AssertionContext>) {
    if (a[key] === undefined || a[key] !== e[key]) return false;
  }
  return true;
}

// ─── Replay protection ────────────────────────────────────────────────────────
//
// The single-use claim lives in `replayStore.ts` and is backed by Postgres, so
// it is shared across instances and survives restarts. `claimAssertion()` above
// is the only entry point. There is deliberately no in-memory guard exported
// from this module any more — leaving one available made it too easy to reach
// for the option that only protects a single process.

// ─── Secret handling ──────────────────────────────────────────────────────────

export const MIN_SECRET_LENGTH = 32;

export class WeakSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeakSecretError';
  }
}

/** Throws unless the secret is present and long enough to be a real secret. */
export function assertUsableSecret(secret: string | undefined | null): asserts secret is string {
  if (!secret || typeof secret !== 'string' || secret.length < MIN_SECRET_LENGTH) {
    throw new WeakSecretError(
      `Assertion secret must be at least ${MIN_SECRET_LENGTH} characters. ` +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
}

/**
 * Stable, non-reversible fingerprint of a secret.
 * Used by /ready and startup logs to prove two services share a secret without
 * printing any part of it.
 */
export function secretFingerprint(secret: string | undefined | null): string {
  if (!secret) return 'unset';
  return crypto.createHash('sha256').update(`sagitta-fingerprint:${secret}`).digest('hex').slice(0, 12);
}

/** Compare an incoming bearer/header credential to a configured one, fail-closed. */
export function checkStaticCredential(configured: string | undefined, presented: unknown): boolean {
  if (!configured) return false; // absent config never authorizes — no "allow when unset"
  if (typeof presented !== 'string' || !presented) return false;
  return timingSafeEqualStr(configured, presented);
}
