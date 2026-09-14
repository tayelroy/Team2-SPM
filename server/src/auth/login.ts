import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
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
  | { outcome: 'success'; accessToken: string; user: LoginUser }
  | { outcome: 'invalid_credentials' }
  | { outcome: 'incomplete_account' }
  | { outcome: 'unavailable' };

const GENERIC_INVALID = { outcome: 'invalid_credentials' as const };

/**
 * Throttles sign-in attempts per IP so a caller can't brute-force or
 * credential-stuff against seeded accounts (AI security review, MEDIUM).
 * Standard headers (RateLimit-*) let a well-behaved client back off;
 * legacy X-RateLimit-* headers are skipped since nothing here reads them.
 *
 * A factory, not a shared instance: each caller (createApp() in
 * particular) gets its own counter, so one test file's requests can't push
 * another test's login calls over the limit.
 */
export function createLoginRateLimiter(options: { windowMs?: number; limit?: number } = {}): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs ?? 15 * 60 * 1000,
    limit: options.limit ?? 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please try again later.' }
  });
}

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
 *
 * The response deliberately excludes the refresh token: nothing client-side
 * uses it (logout revokes via the admin API from the access token alone —
 * see auth/logout.ts), so there's no reason to hand a long-lived credential
 * to the browser, where sessionStorage/XSS exposure was flagged separately
 * (AI security review, LOW).
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
