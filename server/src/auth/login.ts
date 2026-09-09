import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient, getSupabaseClient } from '../db';
import { verifyCaller, type AuthenticatedCaller } from './session';

export interface LoginInput {
  email: string;
  password: string;
}

export type LoginResult =
  | { outcome: 'success'; accessToken: string; refreshToken: string; user: AuthenticatedCaller }
  | { outcome: 'invalid_credentials' }
  | { outcome: 'incomplete_account' }
  | { outcome: 'unavailable' };

const GENERIC_INVALID = { outcome: 'invalid_credentials' as const };

/**
 * Uses the anon client for signInWithPassword, same as any browser client
 * would — password verification doesn't need the service-role key. Supabase
 * returns one generic error for both "wrong password" and "no such email",
 * which already satisfies the no-enumeration requirement without extra work.
 */
export async function loginAccount(
  input: Partial<LoginInput>,
  getClient: () => SupabaseClient | null = getSupabaseClient,
  getAdminClient: () => SupabaseClient | null = getSupabaseAdminClient
): Promise<LoginResult> {
  const email = input.email?.trim();
  const password = input.password;
  if (!email || !password) {
    return GENERIC_INVALID;
  }

  const client = getClient();
  const admin = getAdminClient();
  if (!client || !admin) {
    return { outcome: 'unavailable' };
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session || !data.user) {
    return GENERIC_INVALID;
  }

  const verified = await verifyCaller(client, admin, data.session.access_token);
  if (!verified.ok) {
    return { outcome: 'incomplete_account' };
  }

  return {
    outcome: 'success',
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: verified.caller
  };
}

export function createLoginHandler(login: typeof loginAccount = loginAccount): RequestHandler {
  return async (req, res) => {
    const result = await login(req.body ?? {});

    switch (result.outcome) {
      case 'success':
        res.status(200).json({
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user
        });
        return;
      case 'invalid_credentials':
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      case 'incomplete_account':
        res.status(403).json({ error: 'Your account setup is incomplete. Contact support.' });
        return;
      case 'unavailable':
        res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please try again later.' });
        return;
    }
  };
}
