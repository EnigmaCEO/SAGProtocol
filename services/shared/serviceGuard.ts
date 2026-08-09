// Caller authentication for the private services: signer-treasury,
// signer-escrow, and wallet-factory.
//
// WHY THESE SERVICES NEED THIS AT ALL
//   Confirmed finding #6: all three relied on CORS alone. CORS is a browser
//   policy — it does nothing against curl, a server-side fetch, or anything
//   that is not a browser. These services hold role signer private keys and
//   produce signatures that the protocol contracts accept as authority. Any
//   unauthenticated caller that can reach the port can mint that authority.
//
// The guard is intentionally typed structurally rather than against express, so
// this file compiles into every service without a shared dependency graph.

import {
  ASSERTION_HEADER,
  verifyAssertion,
  claimAssertion,
  assertUsableSecret,
  secretFingerprint,
  WeakSecretError,
  type AuthorityClass,
  type AssertionClaims,
  type AssertionContext,
} from './serviceAuth';
import { createReplayStore, type ReplayStore } from './replayStore';
import { ROUTE_AUTHORITY_REGISTRY, type ServiceId, type RouteAuthority } from './routeAuthority';

// ─── Minimal HTTP shapes ──────────────────────────────────────────────────────

export interface GuardRequest {
  method?: string;
  path?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Exact received bytes, captured by express.json's `verify` hook. */
  rawBody?: Buffer;
  body?: unknown;
  serviceCaller?: ServiceCaller;
}

export interface GuardResponse {
  status(code: number): GuardResponse;
  json(body: unknown): unknown;
}

export interface ServiceCaller {
  /** Issuing service id from the verified assertion. */
  service: string;
  subject: string;
  scopes: string[];
  requestId: string;
}

// ─── Startup validation ───────────────────────────────────────────────────────

export interface ServiceSecurityConfig {
  serviceId: ServiceId;
  environment: string;
  isDevelopment: boolean;
  secret: string;
  /** Issuing service ids permitted to call this service. */
  allowedCallers: string[];
  /** Paths served without authentication. Health and readiness only. */
  publicPaths: string[];
  /** Durable, shared single-use claim store. Postgres in any protected env. */
  replayStore: ReplayStore;
}

export class ServiceSecurityConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Service security configuration is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ServiceSecurityConfigError';
    this.problems = problems;
  }
}

const VALID_ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

/**
 * Validate the security configuration for a private service.
 * Throws in any protected environment when the configuration cannot fail closed
 * — callers must exit non-zero rather than expose a signer on an open port.
 */
export function loadServiceSecurityConfig(params: {
  serviceId: ServiceId;
  env?: Record<string, string | undefined>;
  publicPaths?: string[];
  /** Injected in tests. */
  replayStore?: ReplayStore;
}): ServiceSecurityConfig {
  const env = params.env ?? process.env;
  const problems: string[] = [];

  const rawEnvironment = String(env.SAGITTA_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (!VALID_ENVIRONMENTS.includes(rawEnvironment)) {
    problems.push(
      rawEnvironment
        ? `SAGITTA_ENV/NODE_ENV is "${rawEnvironment}" — must be one of ${VALID_ENVIRONMENTS.join(', ')}.`
        : `SAGITTA_ENV (or NODE_ENV) is not set — must be one of ${VALID_ENVIRONMENTS.join(', ')}.`,
    );
  }
  const environment = VALID_ENVIRONMENTS.includes(rawEnvironment) ? rawEnvironment : 'production';
  const isDevelopment = environment === 'development' || environment === 'test';

  const secret = String(env.SIGNER_ASSERTION_SECRET ?? '').trim();
  if (!secret) {
    problems.push('SIGNER_ASSERTION_SECRET is not set. Required to authenticate callers of this service.');
  } else {
    try {
      assertUsableSecret(secret);
    } catch (err) {
      if (err instanceof WeakSecretError) problems.push(`SIGNER_ASSERTION_SECRET: ${err.message}`);
      else throw err;
    }
  }

  // Caller allowlist. Defaults to the banking server, which is the only
  // legitimate caller in the current topology.
  const allowedCallers = String(env.ALLOWED_CALLER_SERVICES ?? 'banking-server')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (allowedCallers.length === 0) {
    problems.push('ALLOWED_CALLER_SERVICES resolved to an empty list. At least one caller identity must be permitted.');
  }

  if (problems.length > 0) throw new ServiceSecurityConfigError(problems);

  // Replay protection must be durable and shared before we accept any call.
  // A protected environment without DATABASE_URL fails startup rather than
  // silently degrading to a process-local cache.
  let replayStore: ReplayStore;
  try {
    replayStore = params.replayStore ?? createReplayStore({
      databaseUrl: env.DATABASE_URL,
      isDevelopment,
    });
  } catch (err: any) {
    throw new ServiceSecurityConfigError([String(err?.message ?? err)]);
  }

  return {
    serviceId: params.serviceId,
    environment,
    isDevelopment,
    secret,
    allowedCallers,
    publicPaths: params.publicPaths ?? ['/health', '/ready'],
    replayStore,
  };
}

/** Non-secret startup summary. Fingerprint proves secret agreement without revealing it. */
export function serviceSecuritySummary(config: ServiceSecurityConfig) {
  return {
    service: config.serviceId,
    environment: config.environment,
    secretFingerprint: secretFingerprint(config.secret),
    allowedCallers: config.allowedCallers,
    publicPaths: config.publicPaths,
    replayStore: config.replayStore.kind,
  };
}

// ─── Scope resolution from the registry ───────────────────────────────────────

/**
 * Build a resolver that maps (method, live path) to the scopes the route
 * authority registry requires. Returns `undefined` for undeclared routes, which
 * the guard turns into a 404 — a private service must not serve anything the
 * registry does not know about.
 */
export function routeResolverFor(serviceId: ServiceId): (method: string, path: string) => RouteAuthority | undefined {
  const routes = ROUTE_AUTHORITY_REGISTRY.filter(r => r.service === serviceId);

  return (method, path) => {
    const m = String(method ?? '').toUpperCase();
    const liveSegments = String(path ?? '').split('?')[0].split('/').filter(Boolean);
    let best: { route: RouteAuthority; specificity: number } | undefined;

    for (const route of routes) {
      if (route.method !== m) continue;
      const templateSegments = route.path.split('/').filter(Boolean);
      if (templateSegments.length !== liveSegments.length) continue;

      let specificity = 0;
      let matched = true;
      for (let i = 0; i < templateSegments.length; i++) {
        const seg = templateSegments[i];
        if (seg.startsWith(':')) continue;
        if (seg.toLowerCase() !== liveSegments[i].toLowerCase()) { matched = false; break; }
        specificity++;
      }
      if (!matched) continue;
      if (!best || specificity > best.specificity) best = { route, specificity };
    }

    return best?.route;
  };
}

// ─── Guard ────────────────────────────────────────────────────────────────────

const ACCEPTED_CLASSES: readonly AuthorityClass[] = ['signer', 'internal', 'admin'];

/**
 * Express-compatible middleware requiring an authenticated service caller on
 * every route the registry does not declare public.
 *
 * Authority class and required scopes both come from `routeAuthority.ts` via
 * `routeResolver`, so this file never duplicates the registry.
 */
export function createServiceAuthGuard(
  config: ServiceSecurityConfig,
  routeResolver: (method: string, path: string) => RouteAuthority | undefined,
  options: {
    /** Injected in tests; otherwise built from the service's configuration. */
    replayStore?: ReplayStore;
    /**
     * Required operation context per route, e.g. the chain id this service is
     * configured for. A signer assertion that does not name the same chain,
     * operation, and contract is refused.
     */
    requiredContext?: (route: RouteAuthority, req: GuardRequest) => AssertionContext | undefined;
  } = {},
) {
  const replayStore = options.replayStore ?? config.replayStore;

  return function serviceAuthGuard(req: GuardRequest, res: GuardResponse, next: (err?: unknown) => void): void {
    const method = String(req.method ?? 'GET').toUpperCase();
    const path = String(req.path ?? req.url ?? '/').split('?')[0];

    if (config.publicPaths.includes(path)) {
      next();
      return;
    }

    const rawHeader = req.headers[ASSERTION_HEADER];
    const token = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    const route = routeResolver(method, path);
    if (route === undefined) {
      // An undeclared route on a private service is refused outright.
      audit(config, { event: 'call_rejected', reason: 'undeclared_route', method, path });
      res.status(404).json({ error: 'Not found.' });
      return;
    }

    // Registry-declared public reads (e.g. wallet-factory's on-chain binding
    // lookup) need no credential — the data they return is already on-chain.
    if (route.authority === 'public') {
      next();
      return;
    }

    void (async () => {
      // These services mount `express.json({ verify })`, so the exact received
      // bytes are available and the body digest is bound in a single pass.
      const received = req.rawBody ?? Buffer.alloc(0);
      const contentTypeHeader = req.headers['content-type'];
      const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;

      const result = verifyAssertion(config.secret, token, {
        audience: config.serviceId,
        method,
        path,
        allowedClasses: ACCEPTED_CLASSES,
        requiredScopes: route.scopes,
        body: received,
        contentType,
        context: options.requiredContext?.(route, req),
      });

      if (result.outcome === 'denied') {
        audit(config, { event: 'call_rejected', reason: result.reason, method, path });
        const status = result.reason === 'insufficient_scope' || result.reason === 'class_not_allowed' ? 403 : 401;
        res.status(status).json({ error: status === 403 ? 'Insufficient authority.' : 'Authentication required.' });
        return;
      }

      const claims: AssertionClaims = result.claims;
      if (!config.allowedCallers.includes(claims.iss)) {
        // A validly signed assertion from a service that is not approved to call
        // this one. Distinct from a bad signature — this is caller identity.
        audit(config, { event: 'call_rejected', reason: 'caller_not_allowed', method, path, caller: claims.iss });
        res.status(403).json({ error: 'Insufficient authority.' });
        return;
      }

      // Claimed last, and only once everything else passed, so a rejected
      // request never burns a token a legitimate retry would need.
      const claimed = await claimAssertion(replayStore, claims);
      if (claimed.outcome === 'denied') {
        audit(config, { event: 'call_rejected', reason: claimed.reason, method, path, caller: claims.iss });
        const status = claimed.reason === 'replay_store_unavailable' ? 503 : 401;
        res.status(status).json({
          error: status === 503
            ? 'Replay protection is unavailable; this operation was not executed.'
            : 'Authentication required.',
        });
        return;
      }

      req.serviceCaller = {
        service: claims.iss,
        subject: claims.sub,
        scopes: [...claims.scp],
        requestId: claims.rid,
      };

      audit(config, { event: 'call_authorized', method, path, caller: claims.iss, requestId: claims.rid });
      next();
    })();
  };
}

/**
 * Structured audit line. Never includes the assertion, the signature it
 * produces, the signer address, or any request body.
 */
function audit(config: ServiceSecurityConfig, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    kind: 'service_auth',
    service: config.serviceId,
    ...fields,
  }));
}

// ─── Outbound helper ──────────────────────────────────────────────────────────

/** Build the headers a caller must attach when invoking a private service. */
export function serviceCallHeaders(params: {
  secret: string;
  from: ServiceId;
  to: ServiceId;
  method: string;
  path: string;
  scopes: readonly string[];
  requestId?: string;
  mintFn?: typeof import('./serviceAuth').mintAssertion;
}): Record<string, string> {
  // Imported lazily so this module stays usable where only verification is needed.
  const mint = params.mintFn ?? require('./serviceAuth').mintAssertion;
  const token = mint(params.secret, {
    iss: params.from,
    aud: params.to,
    cls: 'signer' as AuthorityClass,
    sub: params.from,
    scp: params.scopes,
    mth: params.method,
    pth: params.path,
    rid: params.requestId,
  });
  return { [ASSERTION_HEADER]: token };
}
