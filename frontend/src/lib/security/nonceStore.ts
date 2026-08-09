// Single-use sign-in nonce claims.
//
// WHY NOT JUST THE COOKIE
//   The nonce is issued into a signed HttpOnly cookie and cleared on use, which
//   is single-use against a sequential client. It is not atomic: two requests
//   carrying the same cookie can both read it before either clears it, and a
//   cleared cookie is only cleared in the browser that received the response.
//
//   The claim below is atomic — `INSERT ... ON CONFLICT DO NOTHING` against a
//   PRIMARY KEY — so exactly one verification attempt can ever consume a given
//   nonce, regardless of concurrency or which instance serves the request.
//
// The cookie is still used, and still required: it binds the nonce to the
// browser that requested it, so an attacker cannot have a victim sign a
// challenge the attacker obtained. The two controls do different jobs.

import { LOGIN_CHALLENGE_TTL_SECONDS } from './loginMessage';

export interface NonceStore {
  /** Returns true exactly once per nonce. */
  claim(nonce: string, expiresAtSeconds: number): Promise<boolean>;
  readonly kind: 'postgres' | 'memory';
}

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS auth_login_nonces (
    nonce      TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

class PostgresNonceStore implements NonceStore {
  readonly kind = 'postgres' as const;
  private ready: Promise<void> | null = null;

  private async ensureTable(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        const { query } = await import('../banking/db');
        await query(TABLE_DDL);
        await query(`CREATE INDEX IF NOT EXISTS auth_login_nonces_expires_at_idx ON auth_login_nonces (expires_at)`);
      })().catch(err => { this.ready = null; throw err; });
    }
    return this.ready;
  }

  async claim(nonce: string, expiresAtSeconds: number): Promise<boolean> {
    await this.ensureTable();
    const { query } = await import('../banking/db');
    // Opportunistic cleanup — cheap, and keeps the table from growing forever.
    await query(`DELETE FROM auth_login_nonces WHERE expires_at < NOW() - INTERVAL '1 hour'`).catch(() => undefined);
    const result = await query(
      `INSERT INTO auth_login_nonces (nonce, expires_at)
       VALUES ($1, to_timestamp($2))
       ON CONFLICT (nonce) DO NOTHING`,
      [nonce, expiresAtSeconds],
    );
    return result.rowCount === 1;
  }
}

class MemoryNonceStore implements NonceStore {
  readonly kind = 'memory' as const;
  private readonly seen = new Map<string, number>();

  async claim(nonce: string, expiresAtSeconds: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, exp] of this.seen) {
      if (exp < now) this.seen.delete(key); else break;
    }
    if (this.seen.has(nonce)) return false;
    if (this.seen.size >= 10_000) {
      const oldest = this.seen.keys().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
    this.seen.set(nonce, expiresAtSeconds);
    return true;
  }
}

let store: NonceStore | null = null;

/**
 * Resolve the nonce store.
 *
 * Postgres when `DATABASE_URL` is configured. The in-memory fallback exists so
 * local development works without a database; it is never selected when a
 * database is available, and `/api/auth/verify` reports which one is in use at
 * startup so a production deployment missing DATABASE_URL is visible.
 */
export function nonceStore(): NonceStore {
  if (!store) {
    store = process.env.DATABASE_URL ? new PostgresNonceStore() : new MemoryNonceStore();
    if (store.kind === 'memory' && process.env.NODE_ENV === 'production') {
      console.warn(
        '[security] Sign-in nonces are stored in memory because DATABASE_URL is not set. ' +
        'Single-use is not guaranteed across instances. Configure DATABASE_URL.',
      );
    }
  }
  return store;
}

/** Test hook. */
export function __setNonceStore(next: NonceStore | null): void {
  store = next;
}

export { LOGIN_CHALLENGE_TTL_SECONDS };
