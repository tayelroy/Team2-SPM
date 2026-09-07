import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { dbConfig, isPostgresConfigured } from './config';

let pgPool: Pool | null = null;

/**
 * Initializes and returns a singleton PostgreSQL connection pool.
 */
export function getPostgresPool(): Pool | null {
  if (pgPool) {
    return pgPool;
  }

  if (!isPostgresConfigured() || !dbConfig.databaseUrl) {
    return null;
  }

  const isSupabaseHost =
    dbConfig.databaseUrl.includes('supabase.co') ||
    dbConfig.databaseUrl.includes('pooler.supabase.com');

  const config: PoolConfig = {
    connectionString: dbConfig.databaseUrl,
    ssl: isSupabaseHost || process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };

  pgPool = new Pool(config);

  pgPool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client', err);
  });

  return pgPool;
}

/**
 * Helper to run a parameterized SQL query against the Postgres pool.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error('PostgreSQL connection pool is not configured. Please set DATABASE_URL.');
  }
  return pool.query<T>(text, params);
}

export interface PostgresHealthResult {
  configured: boolean;
  status: 'connected' | 'unconfigured' | 'error';
  latencyMs?: number;
  error?: string;
}

/**
 * Verifies live PostgreSQL connectivity by executing a lightweight SELECT 1 query.
 * Does NOT touch or require any application table schemas.
 */
export async function checkPostgresHealth(): Promise<PostgresHealthResult> {
  if (!isPostgresConfigured()) {
    return {
      configured: false,
      status: 'unconfigured'
    };
  }

  const pool = getPostgresPool();
  if (!pool) {
    return {
      configured: false,
      status: 'unconfigured'
    };
  }

  const start = Date.now();
  try {
    await pool.query('SELECT 1 AS health_check');
    return {
      configured: true,
      status: 'connected',
      latencyMs: Date.now() - start
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      status: 'error',
      latencyMs: Date.now() - start,
      error: message
    };
  }
}

/**
 * Gracefully shuts down the PostgreSQL connection pool.
 */
export async function closePostgresPool(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
}
