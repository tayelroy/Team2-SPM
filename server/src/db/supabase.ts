import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig, isSupabaseConfigured } from './config';

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

function httpsUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must use HTTPS');
  }
  return parsed;
}

const defaultClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  realtime: {
    transport: WebSocket as any
  }
};

/**
 * Returns a configured Supabase client using the anon key.
 * Used for standard application operations respecting Row Level Security (RLS).
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) {
    return supabaseClient;
  }

  const url = dbConfig.supabaseUrl;
  const key = dbConfig.supabaseAnonKey || dbConfig.supabaseServiceRoleKey;

  if (!url || !key) {
    return null;
  }

  try {
    httpsUrl(url);
    supabaseClient = createClient(url, key, defaultClientOptions);
    return supabaseClient;
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    return null;
  }
}

/**
 * Returns a privileged Supabase client using the service role key.
 * Used for administrative server-side operations bypassing RLS when necessary.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (supabaseAdminClient) {
    return supabaseAdminClient;
  }

  const url = dbConfig.supabaseUrl;
  const key = dbConfig.supabaseServiceRoleKey;

  if (!url || !key) {
    return null;
  }

  try {
    httpsUrl(url);
    supabaseAdminClient = createClient(url, key, defaultClientOptions);
    return supabaseAdminClient;
  } catch (err) {
    console.error('Failed to initialize Supabase admin client:', err);
    return null;
  }
}

export interface SupabaseHealthResult {
  configured: boolean;
  status: 'connected' | 'unconfigured' | 'error';
  url?: string;
  error?: string;
}

/**
 * Checks Supabase Auth API availability over HTTPS without touching tables.
 * This is an API availability check, not a database query or RLS check.
 */
export async function checkSupabaseHealth(): Promise<SupabaseHealthResult> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      status: 'unconfigured'
    };
  }

  const client = getSupabaseClient();
  if (!client) {
    return {
      configured: true,
      status: 'error',
      error: 'Client initialization failed'
    };
  }

  try {
    // getSession() can read only local state, so it cannot prove connectivity.
    // The SDK does not expose Auth's read-only /health endpoint.
    const url = httpsUrl(dbConfig.supabaseUrl!);
    url.pathname = `${url.pathname.replace(/\/$/, '')}/auth/v1/health`;
    const response = await fetch(url, {
      headers: { apikey: dbConfig.supabaseAnonKey || dbConfig.supabaseServiceRoleKey! },
      signal: AbortSignal.timeout(5000),
      redirect: 'error'
    });
    await response.body?.cancel();
    if (!response.ok) {
      return {
        configured: true,
        status: 'error',
        url: dbConfig.supabaseUrl,
        error: `Supabase API returned HTTP ${response.status}`
      };
    }

    return {
      configured: true,
      status: 'connected',
      url: dbConfig.supabaseUrl
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      configured: true,
      status: 'error',
      url: dbConfig.supabaseUrl,
      error: message
    };
  }
}
