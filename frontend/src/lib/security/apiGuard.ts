// The single entry point for protecting a Next.js API route.
//
// `withAuthority` reads the route's declaration from the shared route authority
// registry and enforces it: method allowlist, CSRF/origin, wallet session,
// scope, and development-only gating. Handlers receive an already-authorized
// context and never repeat any of these checks.
//
// A route whose path is not declared in `routeAuthority.ts` cannot be wrapped —
// `withAuthority` throws at module load, so the omission surfaces at build time
// rather than as an open write path in production.

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  ROUTE_AUTHORITY_REGISTRY,
  SERVICE_IDS,
  type RouteAuthority,
  type Scope,
} from '../../../../services/shared/routeAuthority';
import { frontendSecurityConfig, FrontendSecurityConfigError } from './config';
import { readSession, type WalletSession } from './session';
import { assertSameOrigin } from './csrf';

export interface AuthorizedContext {
  route: RouteAuthority;
  /** Null for routes declared `public` or `webhook`. */
  session: WalletSession | null;
  requestId: string;
}

export type AuthorizedHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: AuthorizedContext,
) => Promise<void> | void;

function findDeclaration(method: string, path: string): RouteAuthority {
  const entry = ROUTE_AUTHORITY_REGISTRY.find(
    r => r.service === SERVICE_IDS.frontend && r.method === method.toUpperCase() && r.path === path,
  );
  if (!entry) {
    throw new Error(
      `Route ${method.toUpperCase()} ${path} has no authority declaration. ` +
      'Add it to services/shared/routeAuthority.ts before serving it.',
    );
  }
  return entry;
}

function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Redacted audit line. Never includes bodies, cookies, or assertion tokens. */
function audit(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), kind: 'security_audit', service: 'protocol-frontend', ...fields }));
}

/**
 * Wrap a Next.js handler with its declared authority policy.
 *
 * @param path      Next.js route path exactly as declared in the registry.
 * @param methods   Methods this file serves. Anything else gets 405.
 */
export function withAuthority(
  path: string,
  methods: Record<string, AuthorizedHandler>,
) {
  // Resolve declarations eagerly so a missing one fails at import, not at runtime.
  const declarations = new Map<string, RouteAuthority>();
  for (const method of Object.keys(methods)) {
    declarations.set(method.toUpperCase(), findDeclaration(method, path));
  }
  const allowedMethods = [...declarations.keys()];

  return async function guardedHandler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
    const requestId = newRequestId();
    const method = String(req.method ?? 'GET').toUpperCase();

    const route = declarations.get(method);
    if (!route) {
      res.setHeader('Allow', allowedMethods.join(', '));
      res.status(405).json({ error: 'Method not allowed.', code: 'method_not_allowed' });
      return;
    }

    // Configuration must be valid before anything is authorized.
    let config: ReturnType<typeof frontendSecurityConfig>;
    try {
      config = frontendSecurityConfig();
    } catch (err) {
      if (err instanceof FrontendSecurityConfigError) {
        res.status(503).json({ error: 'Service is not configured to accept this request.', code: 'security_not_configured' });
        return;
      }
      throw err;
    }

    // Development-only routes are indistinguishable from missing routes elsewhere.
    if (route.devOnly && !config.isDevelopment) {
      res.status(404).json({ error: 'Not found.', code: 'not_found' });
      return;
    }

    // CSRF: every unsafe method must be same-origin, including the public
    // sign-in POST — login CSRF would let an attacker fixate a session.
    // Webhooks are exempt: the provider is not a browser and has no origin.
    if (route.authority !== 'webhook') {
      const origin = assertSameOrigin(req, config.allowedOrigins);
      if (!origin.ok) {
        audit({ requestId, method, path, result: 'denied', reason: origin.reason, authorityClass: route.authority });
        res.status(403).json({ error: 'Cross-site request rejected.', code: 'csrf_rejected' });
        return;
      }
    }

    let session: WalletSession | null = null;

    if (route.authority === 'user' || route.authority === 'admin') {
      session = readSession(req);
      if (!session) {
        audit({ requestId, method, path, result: 'denied', reason: 'no_session', authorityClass: route.authority });
        res.status(401).json({ error: 'Connect and sign in with your wallet to perform this action.', code: 'unauthorized' });
        return;
      }

      if (route.authority === 'admin' && session.role !== 'admin') {
        audit({ requestId, method, path, result: 'denied', reason: 'role_insufficient', subject: session.address, authorityClass: route.authority });
        res.status(403).json({ error: 'This operation requires protocol administrator authority.', code: 'insufficient_authority' });
        return;
      }

      const missing = route.scopes.filter(scope => !session!.scopes.includes(scope as Scope));
      if (missing.length > 0) {
        audit({ requestId, method, path, result: 'denied', reason: 'insufficient_scope', subject: session.address, authorityClass: route.authority });
        res.status(403).json({ error: 'Your wallet does not carry the authority required for this operation.', code: 'insufficient_authority' });
        return;
      }
    }

    if (route.auditRequired) {
      audit({
        requestId, method, path, result: 'allowed',
        authorityClass: route.authority,
        subject: session?.address ?? 'anonymous',
        org: session?.institutionId ?? undefined,
        mutation: route.mutation,
      });
    }

    try {
      await methods[method]?.(req, res, { route, session, requestId });
    } catch (err: any) {
      // Never leak an upstream stack or message shape to the browser.
      console.error('[security] Handler error', { requestId, path, method, message: String(err?.message ?? err) });
      if (!res.writableEnded) {
        res.status(500).json({ error: 'Request failed.', code: 'internal_error', requestId });
      }
    }
  };
}
