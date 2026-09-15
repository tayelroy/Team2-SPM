import type { Request, RequestHandler, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { createAuthorization } from '../auth';
import type { Principal } from '../auth/policy';
import { getSupabaseAdminClient } from '../db';
import { fetchProfile, updateProfile, type ProfileRecord, type ProfileResult } from '../db/profile';
import { isInternalRole, validateProfileUpdate, type ProfileUpdateValues } from './fields';

const UNAVAILABLE_MESSAGE = 'Your profile is temporarily unavailable. Please try again later.';
const NOT_PROVISIONED_MESSAGE = 'Your account is not fully set up yet. Please contact support.';

/** Shapes a stored profile row for the API response, scoped to the caller's role (SG2-27). */
function toResponse(profile: ProfileRecord, role: Principal['role']) {
  if (isInternalRole(role)) return profile;
  const { department: _department, ...visible } = profile;
  return visible;
}

export interface ProfileRouterDependencies {
  getAdminClient?: () => SupabaseClient | null;
  fetch?: (admin: SupabaseClient, userId: string) => Promise<ProfileResult>;
  update?: (admin: SupabaseClient, userId: string, updates: ProfileUpdateValues) => Promise<ProfileResult>;
}

/**
 * GET/PUT /api/profile — view and update the caller's own profile (SG2-27).
 *
 * There is no :userId in the path: the profile acted on is always the
 * verified caller's own, from the principal established by requireAuth —
 * never a request parameter or body field, so one account can't read or
 * change another's profile.
 */
export function createProfileRouter(
  access: ReturnType<typeof createAuthorization>,
  {
    getAdminClient = getSupabaseAdminClient,
    fetch: fetchProfileRow = fetchProfile,
    update: updateProfileRow = updateProfile
  }: ProfileRouterDependencies = {}
) {
  const router = access.protectedRouter();

  const respondWithResult = (res: Response, principal: Principal, result: ProfileResult): void => {
    if (!result.ok) {
      if (result.reason === 'not_found') {
        res.status(409).json({ error: NOT_PROVISIONED_MESSAGE });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.json({ profile: toResponse(result.profile, principal.role) });
  };

  const getHandler: RequestHandler = async (req: Request, res) => {
    const principal = access.getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    respondWithResult(res, principal, await fetchProfileRow(admin, principal.userId));
  };

  const putHandler: RequestHandler = async (req: Request, res) => {
    const principal = access.getPrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const validated = validateProfileUpdate(req.body ?? {}, principal.role);
    if (!validated.valid) {
      res.status(400).json({ error: 'Invalid profile details', details: validated.errors });
      return;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    respondWithResult(res, principal, await updateProfileRow(admin, principal.userId, validated.values));
  };

  router.get('/', access.requirePermission('profile.read'), getHandler);
  router.put('/', access.requirePermission('profile.update'), putHandler);

  return router;
}
