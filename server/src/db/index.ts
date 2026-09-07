export * from './config';
export * from './supabase';
export * from './postgres';

import { checkSupabaseHealth, SupabaseHealthResult } from './supabase';
import { checkPostgresHealth, PostgresHealthResult } from './postgres';
import { isSupabaseConfigured, isPostgresConfigured } from './config';

export interface UnifiedDatabaseHealth {
  provider: 'Supabase Postgres';
  configured: boolean;
  supabase: SupabaseHealthResult;
  postgres: PostgresHealthResult;
}

/**
 * Checks overall Supabase Postgres database connectivity across both
 * the Supabase API client and direct PostgreSQL connection pool.
 */
export async function checkDatabaseHealth(): Promise<UnifiedDatabaseHealth> {
  const [supabase, postgres] = await Promise.all([
    checkSupabaseHealth(),
    checkPostgresHealth()
  ]);

  return {
    provider: 'Supabase Postgres',
    configured: isSupabaseConfigured() || isPostgresConfigured(),
    supabase,
    postgres
  };
}
