// Protocol frontend security configuration.
//
// The Next.js layer is where a browser wallet becomes an authenticated actor.
// It verifies a wallet signature, resolves that wallet's authority from the
// on-chain role registry, and only then mints the short-lived internal
// assertion that the banking server independently verifies.
//
// FAIL-CLOSED: in a protected environment, missing configuration makes every
// authenticated route return 503 rather than falling back to "no auth". There
// is no code path here that grants authority because a secret is absent.

export type DeployEnvironment = 'development' | 'test' | 'staging' | 'production';

const VALID_ENVIRONMENTS: readonly DeployEnvironment[] = ['development', 'test', 'staging', 'production'];

const MIN_SECRET_LENGTH = 32;

export interface FrontendSecurityConfig {
  environment: DeployEnvironment;
  isDevelopment: boolean;
  isProtected: boolean;

  /** Signs the wallet session cookie. Distinct from the assertion secret. */
  sessionSecret: string;
  /** Shared with the banking server; signs internal actor assertions. */
  internalAssertionSecret: string;

  /** Origins accepted on unsafe methods. This is the CSRF boundary. */
  allowedOrigins: string[];

  /** Wallets granted the `admin` role regardless of on-chain role registry state. */
  adminWallets: string[];
  /** Wallets granted the `operator` role. */
  operatorWallets: string[];

  /** InvestmentEscrow address used to read the on-chain role authority registry. */
  escrowAddress: string;
  rpcUrl: string;

  /** Chain id bound into the sign-in challenge. */
  chainId: number;
  sessionTtlSeconds: number;
  /** Max upstream response bytes the proxy will buffer. */
  maxBodyBytes: number;
}

export class FrontendSecurityConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Frontend security configuration is invalid:\n  - ${problems.join('\n  - ')}`);
    this.name = 'FrontendSecurityConfigError';
    this.problems = problems;
  }
}

function parseList(raw: string | undefined): string[] {
  return String(raw ?? '').split(',').map(s => s.trim()).filter(Boolean);
}

function parseWallets(raw: string | undefined): string[] {
  return parseList(raw)
    .map(s => s.toLowerCase())
    .filter(s => /^0x[a-f0-9]{40}$/.test(s));
}

let cached: FrontendSecurityConfig | null = null;
let cachedError: FrontendSecurityConfigError | null = null;

export type EnvSource = Record<string, string | undefined>;

export function loadFrontendSecurityConfig(env: EnvSource = process.env): FrontendSecurityConfig {
  const problems: string[] = [];

  const rawEnv = String(env.SAGITTA_ENV || env.NODE_ENV || '').trim().toLowerCase();
  if (!(VALID_ENVIRONMENTS as readonly string[]).includes(rawEnv)) {
    problems.push(
      rawEnv
        ? `SAGITTA_ENV/NODE_ENV is "${rawEnv}" — must be one of ${VALID_ENVIRONMENTS.join(', ')}.`
        : `SAGITTA_ENV (or NODE_ENV) is not set — must be one of ${VALID_ENVIRONMENTS.join(', ')}.`,
    );
  }
  const environment = ((VALID_ENVIRONMENTS as readonly string[]).includes(rawEnv)
    ? rawEnv
    : 'production') as DeployEnvironment;
  const isDevelopment = environment === 'development' || environment === 'test';
  const isProtected = !isDevelopment;

  const sessionSecret = String(env.SESSION_SECRET ?? '').trim();
  if (!sessionSecret) problems.push('SESSION_SECRET is not set. Required to sign the wallet session cookie.');
  else if (sessionSecret.length < MIN_SECRET_LENGTH) problems.push(`SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`);

  const internalAssertionSecret = String(env.INTERNAL_ASSERTION_SECRET ?? '').trim();
  if (!internalAssertionSecret) problems.push('INTERNAL_ASSERTION_SECRET is not set. Required to mint assertions the banking server will accept.');
  else if (internalAssertionSecret.length < MIN_SECRET_LENGTH) problems.push(`INTERNAL_ASSERTION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters.`);

  if (sessionSecret && internalAssertionSecret && sessionSecret === internalAssertionSecret) {
    problems.push('SESSION_SECRET and INTERNAL_ASSERTION_SECRET are identical. Separate authority classes must not share a credential.');
  }

  const allowedOrigins = parseList(env.ALLOWED_ORIGINS ?? env.APP_ORIGIN)
    .map(o => o.replace(/\/$/, ''));
  if (isProtected) {
    if (allowedOrigins.length === 0) {
      problems.push('ALLOWED_ORIGINS is not set. Unsafe methods are rejected without an explicit origin allowlist.');
    }
    for (const origin of allowedOrigins) {
      if (!/^https:\/\//i.test(origin)) problems.push(`ALLOWED_ORIGINS entry "${origin}" must use https in a protected environment.`);
    }
  }

  const adminWallets = parseWallets(env.PROTOCOL_ADMIN_WALLETS);
  const operatorWallets = parseWallets(env.PROTOCOL_OPERATOR_WALLETS);

  const escrowAddress = String(env.INVESTMENT_ESCROW_ADDRESS ?? env.ESCROW_CONTRACT_ADDRESS ?? '').trim();
  const rpcUrl = String(env.RPC_URL ?? env.NEXT_PUBLIC_RPC_URL ?? '').trim();
  if (isProtected && adminWallets.length === 0 && (!escrowAddress || !rpcUrl)) {
    // Without either source of authority nobody can ever hold admin scope, so
    // administrative routes would be permanently unreachable. That is a
    // configuration error, not a safe default.
    problems.push(
      'No administrator authority source configured. Set PROTOCOL_ADMIN_WALLETS, or set ' +
      'INVESTMENT_ESCROW_ADDRESS and RPC_URL so roles can be read from the on-chain role authority registry.',
    );
  }

  const ttlRaw = Number(env.SESSION_TTL_SECONDS ?? 3600);
  const maxBodyRaw = Number(env.MAX_PROXY_BODY_BYTES ?? 1_048_576);

  if (problems.length > 0) throw new FrontendSecurityConfigError(problems);

  return {
    environment,
    isDevelopment,
    isProtected,
    sessionSecret,
    internalAssertionSecret,
    allowedOrigins: allowedOrigins.length > 0 ? allowedOrigins : ['http://localhost:3000'],
    adminWallets,
    operatorWallets,
    escrowAddress,
    rpcUrl,
    chainId: Number(env.CHAIN_ID ?? env.NEXT_PUBLIC_CHAIN_ID ?? 31337) || 31337,
    sessionTtlSeconds: Number.isFinite(ttlRaw) && ttlRaw > 0 ? Math.min(ttlRaw, 86_400) : 3600,
    maxBodyBytes: Number.isFinite(maxBodyRaw) && maxBodyRaw > 0 ? maxBodyRaw : 1_048_576,
  };
}

/**
 * Memoized accessor.
 *
 * On invalid configuration this keeps throwing the same error, which
 * `withAuthority` converts to a 503. Next.js cannot abort a process at import
 * time the way a standalone server can, so "refuse to serve authenticated
 * routes" is the equivalent fail-closed behaviour here.
 */
export function frontendSecurityConfig(): FrontendSecurityConfig {
  if (cachedError) throw cachedError;
  if (cached) return cached;
  try {
    cached = loadFrontendSecurityConfig();
    return cached;
  } catch (err) {
    if (err instanceof FrontendSecurityConfigError) {
      cachedError = err;
      console.error('[security] Frontend security configuration is invalid — authenticated routes will return 503');
      for (const problem of err.problems) console.error(`[security] ✗ ${problem}`);
    }
    throw err;
  }
}

/** Test hook. */
export function __setFrontendSecurityConfig(config: FrontendSecurityConfig | null): void {
  cached = config;
  cachedError = null;
}
