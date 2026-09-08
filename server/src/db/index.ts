export * from './config';
export * from './supabase';

import { checkSupabaseHealth, SupabaseHealthResult } from './supabase';
import { isSupabaseConfigured } from './config';

export interface UnifiedDatabaseHealth {
  provider: 'Supabase';
  configured: boolean;
  supabase: SupabaseHealthResult;
}

/**
 * Checks the Supabase API's availability over HTTPS, without querying tables.
 */
export async function checkDatabaseHealth(): Promise<UnifiedDatabaseHealth> {
  const supabase = await checkSupabaseHealth();

  return {
    provider: 'Supabase',
    configured: isSupabaseConfigured(),
    supabase
  };
}
