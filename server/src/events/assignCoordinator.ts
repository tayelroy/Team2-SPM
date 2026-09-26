import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchEventRequestById,
  assignEventCoordinator,
  type FetchEventRequestResult,
  type AssignCoordinatorResult
} from '../db/eventRequests';
import { getAccountRole, type GetAccountRoleResult } from '../db/accountRoles';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface AssignCoordinatorDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchRequest?: (admin: SupabaseClient, eventId: number) => Promise<FetchEventRequestResult>;
  lookupRole?: (admin: SupabaseClient, userId: string) => Promise<GetAccountRoleResult>;
  assignCoordinator?: (
    admin: SupabaseClient,
    eventId: number,
    coordinatorId: string
  ) => Promise<AssignCoordinatorResult>;
}

/**
 * PATCH /api/event-requests/:eventId/coordinator — assigns (SG2-33) or
 * reassigns (SG2-34) an event request's coordinator.
 *
 * One handler covers both tickets: setting `coordinator_id` from null and
 * changing it from an existing coordinator are the same write against the
 * same row — the two Jira stories differ only in which acceptance criteria
 * they're demonstrating, not in the underlying operation. Mounted behind
 * requirePermission('event_request.assign_coordinator'), so only
 * Technical Support Staff ever reach this handler (SG2-33 AC1 / SG2-34 AC1).
 *
 * AC4 on both tickets ("recorded with who/when" / "previous assignment
 * visible in history") is deliberately not implemented here — SG2-40
 * (Elroy) is building a general event-history mechanism this same sprint;
 * this handler is not building a one-off audit trail ahead of that
 * conversation. See context.md §6/§7.
 */
export function createAssignCoordinatorHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRequest = fetchEventRequestById,
  lookupRole = getAccountRole,
  assignCoordinator = assignEventCoordinator
}: AssignCoordinatorDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId < 1) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return;
    }

    const coordinatorId = typeof req.body?.coordinatorId === 'string' ? req.body.coordinatorId.trim() : '';
    if (!coordinatorId) {
      res.status(400).json({ error: 'coordinatorId is required.' });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const existing = await fetchRequest(admin, eventId);
    if (!existing.ok) {
      if (existing.reason === 'not_found') {
        res.status(404).json({ error: 'No event request found with that id.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const target = await lookupRole(admin, coordinatorId);
    if (!target.ok) {
      if (target.reason === 'user_not_found') {
        res.status(400).json({ error: 'No account exists with the given coordinatorId.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    if (target.role !== 'event_coordinator') {
      res.status(400).json({ error: 'coordinatorId must belong to an Event Coordinator account.' });
      return;
    }

    const assigned = await assignCoordinator(admin, eventId, coordinatorId);
    if (!assigned.ok) {
      if (assigned.reason === 'not_assignable') {
        res.status(409).json({
          error: 'A coordinator can only be assigned to a submitted request that is not yet closed out.'
        });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ request: assigned.request });
  };
}
