import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db';

export interface LogoutInput {
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Best-effort session revocation: if both tokens are present, ask Supabase
 * to invalidate them server-side. Logging out always reports success either
 * way — the client clears its own stored session regardless, and a failed
 * revocation call shouldn't strand the user in a "can't sign out" state.
 */
export async function logoutAccount(
  input: LogoutInput,
  getClient: () => SupabaseClient | null = getSupabaseClient
): Promise<{ outcome: 'success' }> {
  const client = getClient();
  if (client && input.accessToken && input.refreshToken) {
    try {
      await client.auth.setSession({ access_token: input.accessToken, refresh_token: input.refreshToken });
      await client.auth.signOut();
    } catch {
      // Revocation is best-effort; the caller's session is cleared client-side regardless.
    }
  }
  return { outcome: 'success' };
}

export function createLogoutHandler(logout: typeof logoutAccount = logoutAccount): RequestHandler {
  return async (req, res) => {
    await logout(req.body ?? {});
    res.status(200).json({ message: 'Signed out.' });
  };
}
