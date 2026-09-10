import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db';

export interface LogoutInput {
  refreshToken?: string;
}

/**
 * Best-effort session revocation, but only for a verified caller: the
 * access token must come from the Authorization header (the standard auth
 * mechanism, not an arbitrary body field) and pass a real getUser() check
 * before it's used for anything. A previous version trusted whatever tokens
 * showed up in the request body with no verification — anyone who learned a
 * victim's tokens (a leaked log line, a referrer, a proxy) could revoke
 * their session without ever proving they were that person.
 *
 * Logging out still always reports success either way — the client clears
 * its own stored session regardless, and a failed revocation call
 * shouldn't strand the user in a "can't sign out" state.
 */
export async function logoutAccount(
  accessToken: string | null,
  input: LogoutInput,
  getClient: () => SupabaseClient | null = getSupabaseClient
): Promise<{ outcome: 'success' }> {
  const client = getClient();
  if (client && accessToken && input.refreshToken) {
    try {
      const { data, error } = await client.auth.getUser(accessToken);
      if (!error && data.user) {
        await client.auth.setSession({ access_token: accessToken, refresh_token: input.refreshToken });
        await client.auth.signOut();
      }
    } catch {
      // Revocation is best-effort; the caller's session is cleared client-side regardless.
    }
  }
  return { outcome: 'success' };
}

function readBearerToken(header: string | undefined): string | null {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  return match ? match[1] : null;
}

export function createLogoutHandler(logout: typeof logoutAccount = logoutAccount): RequestHandler {
  return async (req, res) => {
    const accessToken = readBearerToken(req.header('authorization'));
    await logout(accessToken, req.body ?? {});
    res.status(200).json({ message: 'Signed out.' });
  };
}
