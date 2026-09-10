import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db';
import { resolveSupabasePrincipal } from './supabase';
import { AccessError, type Principal } from './policy';
import { toDisplayRole } from './roleFormat';

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginUser {
  userId: string;
  email: string;
  role: string;
}

export type LoginResult =
  | { outcome: 'success'; accessToken: string; refreshToken: string; user: LoginUser }
  | { outcome: 'invalid_credentials' }
  | { outcome: 'incomplete_account' }
  | { outcome: 'unavailable' };

const GENERIC_INVALID = { outcome: 'invalid_credentials' as const };

/**
 * Uses the anon client for signInWithPassword, same as any browser client
 * would — password verification doesn't need the service-role key. Supabase
 * returns one generic error for both "wrong password" and "no such email",
 * which already satisfies the no-enumeration requirement without extra work.
 *
 * Role resolution reuses auth/supabase.ts's resolveSupabasePrincipal (the
 * same lookup requireAuth uses) rather than querying account_roles again
 * independently, so login and every other authenticated request agree by
 * construction on what "signed in with a role" means.
 */
export async function loginAccount(
  input: Partial<LoginInput>,
  getClient: () => SupabaseClient | null = getSupabaseClient,
  resolvePrincipal: (token: string) => Promise<Principal> = resolveSupabasePrincipal
): Promise<LoginResult> {
  const email = input.email?.trim();
  const password = input.password;
  if (!email || !password) {
    return GENERIC_INVALID;
  }

  const client = getClient();
  if (!client) {
    return { outcome: 'unavailable' };
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data?.session || !data.user) {
    return GENERIC_INVALID;
  }

  try {
    const principal = await resolvePrincipal(data.session.access_token);
    return {
      outcome: 'success',
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: { userId: principal.userId, email: data.user.email ?? email, role: toDisplayRole(principal.role) }
    };
  } catch (err) {
    if (err instanceof AccessError && err.status === 403) {
      return { outcome: 'incomplete_account' };
    }
    return { outcome: 'unavailable' };
  }
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
