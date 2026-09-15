import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';

/**
 * Revoke only the caller's current session, identified by its bearer token.
 * Never accept a token/user ID from the body or sign out other devices.
 * The browser clears its session even if revocation cannot be confirmed;
 * the server must report that failure instead of claiming success.
 */
export async function logoutAccount(
  accessToken: string | null,
  getClient: () => SupabaseClient | null = getSupabaseAdminClient
): Promise<{ outcome: 'success' | 'unavailable' }> {
  if (!accessToken) return { outcome: 'success' };
  try {
    const client = getClient();
    if (!client) return { outcome: 'unavailable' };
    const { error } = await client.auth.admin.signOut(accessToken, 'local');
    return { outcome: error ? 'unavailable' : 'success' };
  } catch {
    return { outcome: 'unavailable' };
  }
}

function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  return match ? match[1] : null;
}

export function createLogoutHandler(logout: typeof logoutAccount = logoutAccount): RequestHandler {
  return async (req, res) => {
    const accessToken = readBearerToken(req.header('authorization'));
    res.set('Cache-Control', 'no-store');
    const result = await logout(accessToken);
    if (result.outcome === 'unavailable') {
      res.status(503).json({ error: 'Unable to confirm server sign-out.' });
      return;
    }
    res.status(200).json({ message: 'Signed out.' });
  };
}
