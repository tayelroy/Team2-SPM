import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { VALID_ROLE_NAMES, type RoleName } from '../db/users';
import { updateAccountRole } from '../db/accountRoles';
import { toSnakeRole } from './roleFormat';

/**
 * PATCH /api/users/:userId/role — mounted behind requireAuth +
 * requirePermission('users.role.update') in app.ts, so only Technical
 * Support Staff reach this handler at all (SG2-24). This function only
 * validates the target role and performs the write.
 */
export function createUpdateRoleHandler(
  getAdminClient: () => SupabaseClient | null = getSupabaseAdminClient
): RequestHandler {
  return async (req, res) => {
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
      return;
    }

    const roleName = typeof req.body?.role === 'string' ? req.body.role : undefined;
    if (!roleName) {
      res.status(400).json({ error: 'A target role is required.' });
      return;
    }
    if (!VALID_ROLE_NAMES.includes(roleName as RoleName)) {
      res.status(400).json({ error: 'Not a recognised role.' });
      return;
    }

    const result = await updateAccountRole(admin, req.params.userId, toSnakeRole(roleName));
    if (result.ok) {
      res.status(200).json({ message: 'Role updated.' });
      return;
    }
    if (result.reason === 'user_not_found') {
      res.status(404).json({ error: 'No account with that id.' });
      return;
    }
    res.status(503).json({ error: 'Could not update the role. Please try again later.' });
  };
}
