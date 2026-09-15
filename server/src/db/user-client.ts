import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig } from './config';

/**
 * A per-request Supabase client that acts as the caller: their access token is
 * attached to every outbound request so row level security applies. Mirrors the
 * client built in server/src/auth/supabase.ts.
 *
 * This is deliberately not the memoised getSupabaseClient() from ./supabase,
 * which can fall back to the service-role key and bypass RLS. Returns null when
 * Supabase is not configured over HTTPS; callers should treat that as
 * "temporarily unavailable".
 */
export function createUserScopedClient(token: string): SupabaseClient | null {
  const url = dbConfig.supabaseUrl;
  const key = dbConfig.supabaseAnonKey;
  if (!url || !key) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
  } catch {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket as any },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: AbortSignal.timeout(5000),
        redirect: 'error'
      })
    }
  });
}
