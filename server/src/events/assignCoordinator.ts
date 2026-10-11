import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  COORDINATOR_ASSIGNABLE_STATUSES,
  fetchEventRequestById,
  assignEventCoordinator,
  type FetchEventRequestResult,
  type AssignCoordinatorResult,
  type AssignStatusTransition
} from '../db/eventRequests';
import { getAccountRole, type GetAccountRoleResult } from '../db/accountRoles';
import { insertAuditLogs, statusChange } from '../db/auditLogs';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';
const NOT_ASSIGNABLE_MESSAGE = 'A coordinator can only be assigned to a submitted request that is not yet closed out.';
const CHANGED_MESSAGE = 'This request changed while you were assigning it. Reload the list and try again.';

export interface AssignCoordinatorDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchRequest?: (admin: SupabaseClient, eventId: number) => Promise<FetchEventRequestResult>;
  lookupRole?: (admin: SupabaseClient, userId: string) => Promise<GetAccountRoleResult>;
  assignCoordinator?: (
    admin: SupabaseClient,
    eventId: number,
    coordinatorId: string | null,
    expectedCurrent: string | null,
    statusTransition?: AssignStatusTransition
  ) => Promise<AssignCoordinatorResult>;
  writeHistory?: typeof insertAuditLogs;
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
 * the Event Coordinator Lead ever reaches this handler (SG2-97 AC1, which
 * moved SG2-33/34's grant away from Technical Support Staff).
 *
 * Every change is recorded in SG2-40's event history (SG2-33 AC4, SG2-34
 * AC4): who made it comes from the verified caller, when from the row's
 * database default, and the old and new values are the coordinators' names
 * so the history drawer reads naturally. Re-choosing the coordinator who
 * already holds the request changes nothing and so records nothing. A first
 * assignment also moves the request `unassigned → submitted`, and that
 * status change is recorded in the same insert.
 *
 * The event write and the history insert are two calls, not a transaction.
 * If the insert fails, the assignment is put back (guarded so it cannot
 * undo a newer one) and the caller is told to retry, rather than leaving a
 * change the history does not show.
 */
export function createAssignCoordinatorHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRequest = fetchEventRequestById,
  lookupRole = getAccountRole,
  assignCoordinator = assignEventCoordinator,
  writeHistory = insertAuditLogs
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

    const current = existing.request;
    if (!COORDINATOR_ASSIGNABLE_STATUSES.includes(current.status)) {
      res.status(409).json({ error: NOT_ASSIGNABLE_MESSAGE });
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

    const previousId = current.coordinator_id ?? null;
    if (previousId === coordinatorId) {
      res.status(200).json({ request: current });
      return;
    }

    // SG2-100 AC1: assigning a coordinator to a request still awaiting
    // assignment is what moves it into review. Every other reassignment
    // leaves the status exactly where it was — an event in arrangements,
    // safety check, preparation or confirmed must not be rewound by a
    // change of coordinator.
    const transition: AssignStatusTransition | undefined =
      current.status === 'unassigned' ? { from: 'unassigned', to: 'submitted' } : undefined;

    const assigned = await assignCoordinator(admin, eventId, coordinatorId, previousId, transition);
    if (!assigned.ok) {
      if (assigned.reason === 'not_assignable') {
        // The status was assignable when read, so the request was reassigned
        // or closed out in between.
        res.status(409).json({ error: CHANGED_MESSAGE });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const recorded = await writeHistory(admin, [
      {
        event_id: eventId,
        actor_id: principal.userId,
        field_name: 'coordinator_id',
        old_value: previousId === null ? null : current.coordinator_name ?? previousId,
        new_value: assigned.request.coordinator_name ?? coordinatorId
      },
      ...(transition ? [statusChange(eventId, principal.userId, transition.from, transition.to)] : [])
    ]);
    if (!recorded.ok) {
      // Undo the status move too, or a request whose assignment was rolled
      // back would be left in `submitted` with no coordinator — the exact
      // state SG2-100's backfill removed.
      await assignCoordinator(
        admin,
        eventId,
        previousId,
        coordinatorId,
        transition ? { from: transition.to, to: transition.from } : undefined
      );
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ request: assigned.request });
  };
}
