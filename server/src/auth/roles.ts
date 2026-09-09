import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient, getSupabaseClient } from '../db';
import { readBearerToken, verifyCaller } from './session';
import { updateUserRole } from '../db/users';

const TECH_SUPPORT_ROLE = 'Technical Support Staff';

/**
 * PATCH /api/users/:userId/role — only Technical Support Staff may call
 * this (SG2-24). Authorisation is re-checked against the live public.users
 * row every request, not cached on the token, so a role change takes effect
 * on the caller's very next request.
 */
export function createUpdateRoleHandler(
  getClient: () => SupabaseClient | null = getSupabaseClient,
  getAdminClient: () => SupabaseClient | null = getSupabaseAdminClient
): RequestHandler {
  return async (req, res) => {
    const token = readBearerToken(req.header('authorization'));
    if (!token) {
      res.status(401).json({ error: 'Missing or malformed Authorization header.' });
      return;
    }

    const client = getClient();
    const admin = getAdminClient();
    if (!client || !admin) {
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
      return;
    }

    const verified = await verifyCaller(client, admin, token);
    if (!verified.ok) {
      res.status(verified.reason === 'invalid_token' ? 401 : 403).json({ error: 'Not signed in.' });
      return;
    }

    if (verified.caller.role !== TECH_SUPPORT_ROLE) {
      res.status(403).json({ error: 'Only Technical Support Staff can change a user’s role.' });
      return;
    }

    const targetUserId = req.params.userId;
    const roleName = typeof req.body?.role === 'string' ? req.body.role : undefined;
    if (!roleName) {
      res.status(400).json({ error: 'A target role is required.' });
      return;
    }

    const result = await updateUserRole(admin, targetUserId, roleName);
    if (result.ok) {
      res.status(200).json({ message: 'Role updated.' });
      return;
    }
    if (result.reason === 'invalid_role') {
      res.status(400).json({ error: 'Not a recognised role.' });
      return;
    }
    if (result.reason === 'user_not_found') {
      res.status(404).json({ error: 'No account with that id.' });
      return;
    }
    res.status(503).json({ error: 'Could not update the role. Please try again later.' });
  };
}
