import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { VALID_ROLE_NAMES, type RoleName } from '../db/users';
import { changeAccountRoles, type RoleChangeAction, type RoleChangeResult } from '../db/accountRoles';
import { toDisplayRole, toSnakeRole } from './roleFormat';
import type { Principal } from './policy';

const UNAVAILABLE = 'Could not update the role. Please try again later.';

export interface RoleAdminDependencies {
  getAdminClient?: () => SupabaseClient | null;
  /** The verified caller; role changes on the caller's own account are refused. */
  getPrincipal?: (req: Request) => Principal | undefined;
  change?: typeof changeAccountRoles;
}

/**
 * Role administration (SG2-24, SG2-104): PATCH /api/users/:userId/role
 * { role } replaces every role the account holds with that one. Mounted
 * behind requireAuth + requirePermission('users.role.update'), so only an
 * account acting as Technical Support Staff reaches it. Separation of
 * duties: nobody changes their own roles (refused here, and again in the
 * database's change_account_roles()). Extra roles are granted in SQL.
 * The role is given in its display form exactly ("Event Organiser").
 */
function roleChange(action: RoleChangeAction, roleOf: (req: Request) => unknown, {
  getAdminClient = getSupabaseAdminClient,
  getPrincipal,
  change = changeAccountRoles
}: RoleAdminDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal?.(req);
    if (getPrincipal && !principal) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (principal && principal.userId === req.params.userId) {
      res.status(403).json({ error: 'You cannot change the roles on your own account.' });
      return;
    }

    const roleName = roleOf(req);
    if (typeof roleName !== 'string' || roleName === '') {
      res.status(400).json({ error: 'A target role is required.' });
      return;
    }
    if (!VALID_ROLE_NAMES.includes(roleName as RoleName)) {
      res.status(400).json({ error: 'Not a recognised role.' });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
      return;
    }

    const actorId = principal?.userId ?? '';
    const result = await change(admin, actorId, req.params.userId, action, toSnakeRole(roleName));
    respond(res, action, result);
  };
}

function respond(res: Parameters<RequestHandler>[1], action: RoleChangeAction, result: RoleChangeResult) {
  switch (result.outcome) {
    case 'changed':
    case 'unchanged': {
      res.status(200).json({ message: 'Role updated.', roles: result.roles.map(toDisplayRole) });
      return;
    }
    case 'missing':
      res.status(404).json({ error: 'No account with that id.' });
      return;
    case 'self':
      res.status(403).json({ error: 'You cannot change the roles on your own account.' });
      return;
    case 'forbidden':
      res.status(403).json({ error: 'Only Technical Support Staff can change roles.' });
      return;
    case 'last_role':
      res.status(409).json({ error: 'An account must keep at least one role.' });
      return;
    case 'invalid':
      res.status(400).json({ error: 'Not a recognised role.' });
      return;
    default:
      res.status(503).json({ error: UNAVAILABLE });
  }
}

/** PATCH /api/users/:userId/role: replaces every role the account holds with one. */
export function createUpdateRoleHandler(
  getAdminClient: () => SupabaseClient | null = getSupabaseAdminClient,
  getPrincipal?: (req: Request) => Principal | undefined,
  change?: typeof changeAccountRoles
): RequestHandler {
  return roleChange('replace', req => req.body?.role, { getAdminClient, getPrincipal, change });
}
