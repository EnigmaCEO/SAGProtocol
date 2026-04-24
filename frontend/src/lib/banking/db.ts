type PgPool = any;

let pool: PgPool | null = null;

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for banking API persistence.');
  }
  return url;
}

export function getPool(): PgPool {
  if (pool) return pool;
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: requireDatabaseUrl(),
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  return pool;
}

export async function query<T = any>(text: string, values: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
  return getPool().query(text, values);
}

export async function withTransaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
