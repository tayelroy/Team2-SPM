import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';

/**
 * Revokes the session tied to the caller's own access token, using the
 * admin API's signOut(jwt) — which derives the session to revoke solely
 * from that token, so no other input is needed or trusted.
 *
 * A previous version paired the verified access token with a refreshToken
 * taken from the request body (setSession + signOut). That refresh token
 * was never checked against the access token's owner: a caller with their
 * own valid access token could supply a different user's refresh token and
 * revoke that other user's session (an AI security review finding — session
 * revocation DoS, no data exposure). Needing only the access token removes
 * that trust gap entirely rather than validating the second token too.
 *
 * Logging out still always reports success either way — the client clears
 * its own stored session regardless, and a failed revocation call
 * shouldn't strand the user in a "can't sign out" state.
 */
export async function logoutAccount(
  accessToken: string | null,
  getClient: () => SupabaseClient | null = getSupabaseAdminClient
): Promise<{ outcome: 'success' }> {
  const client = getClient();
  if (client && accessToken) {
    try {
      await client.auth.admin.signOut(accessToken);
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
    await logout(accessToken);
    res.status(200).json({ message: 'Signed out.' });
  };
}
