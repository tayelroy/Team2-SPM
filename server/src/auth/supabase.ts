import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig } from '../db/config';
import { AccessError, isRole, Principal } from './policy';

/** Verifies the token and loads the current role using a client scoped to this request. */
export async function resolveSupabasePrincipal(token: string): Promise<Principal> {
  const url = dbConfig.supabaseUrl;
  const key = dbConfig.supabaseAnonKey;
  if (!url || !key || new URL(url).protocol !== 'https:') throw new AccessError(503);

  const client = createClient(url, key, {
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

  // Verify the token before using its identity in a database query.
  const { data: identity, error: authError } = await client.auth.getUser(token);
  if (authError) {
    throw new AccessError([400, 401, 403].includes(authError.status ?? 0) ? 401 : 503);
  }
  if (!identity.user?.id || identity.user.is_anonymous) throw new AccessError(401);

  // Read the database role so role changes apply without refreshing the token.
  const { data, error, status } = await client.from('account_roles')
    .select('role').eq('user_id', identity.user.id).maybeSingle();
  if (error) throw new AccessError(status === 401 ? 401 : 503);
  if (!isRole(data?.role)) throw new AccessError(403);
  return { userId: identity.user.id, role: data.role };
}
