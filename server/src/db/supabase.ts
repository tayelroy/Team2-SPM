import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig, isSupabaseConfigured } from './config';

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

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
 * Checks connectivity to the Supabase endpoint without touching application tables.
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
      configured: false,
      status: 'unconfigured',
      error: 'Client initialization failed'
    };
  }

  try {
    const { error } = await client.auth.getSession();
    if (error) {
      return {
        configured: true,
        status: 'error',
        url: dbConfig.supabaseUrl,
        error: error.message
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
