// Single-use assertion claims.
//
// WHY THIS IS NOT AN IN-MEMORY CACHE
//   A process-local `Map` only prevents replay within one process's lifetime.
//   Fly can run several machines, restarts happen on every deploy, and
//   `auto_stop_machines` recycles instances — so an in-memory cache lets the
//   same assertion be replayed against a different instance, or against the
//   same instance after a restart. That is not replay protection.
//
//   The durable store claims a `jti` with a single atomic
//   `INSERT ... ON CONFLICT DO NOTHING`. Exactly one caller sees rowCount 1;
//   every concurrent or later duplicate sees 0. The database, not the process,
//   is the arbiter.

/** Minimal Postgres client shape — avoids a hard `pg` type dependency. */
export interface ReplayQueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null; rows: any[] }>;
}

export interface ReplayStore {
  /**
   * Atomically claim a token id. Returns true exactly once per `jti`.
   * Must be durable and shared across every instance of the service.
   */
  claim(jti: string, expiresAtSeconds: number): Promise<boolean>;
  /** Human-readable description for /ready. Never includes credentials. */
  readonly kind: 'postgres' | 'memory';
}

// ─── Postgres ─────────────────────────────────────────────────────────────────

const TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS assertion_replay (
    jti        TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const INDEX_DDL = `
  CREATE INDEX IF NOT EXISTS assertion_replay_expires_at_idx ON assertion_replay (expires_at)
`;

export class PostgresReplayStore implements ReplayStore {
  readonly kind = 'postgres' as const;
  private ready: Promise<void> | null = null;

  constructor(private readonly client: ReplayQueryClient) {}

  private async ensureTable(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await this.client.query(TABLE_DDL);
        await this.client.query(INDEX_DDL);
      })().catch(err => {
        this.ready = null; // allow a retry rather than wedging every request
        throw err;
      });
    }
    return this.ready;
  }

  /**
   * Atomic claim. A conflict means the token was already used — by this
   * instance, another instance, or an instance that has since restarted.
   *
   * Throws if the store is unreachable. Callers MUST treat a throw as a denial:
   * without a working claim store we cannot prove a token is fresh, and
   * accepting it anyway would silently reinstate replay.
   */
  async claim(jti: string, expiresAtSeconds: number): Promise<boolean> {
    await this.ensureTable();
    const result = await this.client.query(
      `INSERT INTO assertion_replay (jti, expires_at)
       VALUES ($1, to_timestamp($2))
       ON CONFLICT (jti) DO NOTHING`,
      [jti, expiresAtSeconds],
    );
    return result.rowCount === 1;
  }

  /** Housekeeping. Rows are only useful until the assertion would expire anyway. */
  async prune(): Promise<number> {
    await this.ensureTable();
    const result = await this.client.query(
      `DELETE FROM assertion_replay WHERE expires_at < NOW() - INTERVAL '1 hour'`,
    );
    return result.rowCount ?? 0;
  }
}

// ─── In-memory (development only) ─────────────────────────────────────────────

/**
 * Process-local fallback.
 *
 * Only ever installed when the environment is explicitly `development` or
 * `test` — see each service's security configuration, which refuses to start a
 * protected environment without a durable store. It is NOT a degraded-mode
 * fallback for production.
 */
export class InMemoryReplayStore implements ReplayStore {
  readonly kind = 'memory' as const;
  private readonly seen = new Map<string, number>();

  constructor(private readonly maxEntries = 50_000) {}

  async claim(jti: string, expiresAtSeconds: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, exp] of this.seen) {
      if (exp < now) this.seen.delete(key);
      else break; // insertion order tracks expiry closely enough for a dev store
    }
    if (this.seen.has(jti)) return false;
    if (this.seen.size >= this.maxEntries) {
      const oldest = this.seen.keys().next();
      if (!oldest.done) this.seen.delete(oldest.value);
    }
    this.seen.set(jti, expiresAtSeconds);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}

// ─── Construction ─────────────────────────────────────────────────────────────

/**
 * Build the replay store for a service.
 *
 * `databaseUrl` present → Postgres. Absent and development → in-memory.
 * Absent and protected → throws, because there is no safe third option.
 */
export function createReplayStore(params: {
  databaseUrl: string | undefined;
  isDevelopment: boolean;
  /** Injected in tests. Defaults to a lazily constructed `pg` Pool. */
  client?: ReplayQueryClient;
}): ReplayStore {
  if (params.client) return new PostgresReplayStore(params.client);

  if (params.databaseUrl) {
    // `pg` is resolved at runtime so services without their own copy fall back
    // to the workspace-hoisted one, and so this module stays importable in
    // environments that never touch Postgres.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: params.databaseUrl,
      ssl: /\bsslmode=require\b/.test(params.databaseUrl) ? { rejectUnauthorized: false } : undefined,
      max: 4,
    });
    return new PostgresReplayStore(pool as ReplayQueryClient);
  }

  if (params.isDevelopment) return new InMemoryReplayStore();

  throw new Error(
    'No durable replay store available. Set DATABASE_URL so assertion ids can be claimed atomically ' +
    'across instances and restarts. An in-memory store is only permitted in development.',
  );
}
