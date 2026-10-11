import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { completeEvent, type CompleteEventResult } from '../db/eventRequests';
import { insertAuditLogs, statusChange } from '../db/auditLogs';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';
const NOT_FINISHED_MESSAGE = 'This event has not finished yet.';
const NOT_FOUND_MESSAGE = 'No completable event is assigned to this account.';

export interface CompleteEventDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  complete?: (
    admin: SupabaseClient,
    eventId: number,
    coordinatorId: string,
    now: Date
  ) => Promise<CompleteEventResult>;
  recordAudit?: typeof insertAuditLogs;
  /** Injected so no test depends on the real clock (DoD gate 3). */
  now?: () => Date;
}

/**
 * PATCH /api/event-requests/:eventId/complete — marks an event that has been
 * held as completed (SG2-100 AC4). No request body: the only thing being
 * said is "this happened", and who said it comes from the verified caller.
 *
 * `completeEvent` repeats the assignment and status guards in the write
 * itself, so authorisation and the transition happen together; a coordinator
 * who is not the assigned one gets the same 404 as one asking about an event
 * that does not exist, so neither can probe for the other's assignments.
 * The one error worth distinguishing is 409 "not finished yet", which is
 * actionable and only ever reaches the coordinator the event belongs to.
 *
 * The audit row is written after the transition and is deliberately not
 * allowed to fail it: `completed_by`/`completed_at` on the row itself are the
 * authoritative "who and when" that AC4 asks for, so a lost history row is
 * the lesser harm than an event that was held and cannot be closed out.
 */
export function createCompleteEventHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  complete = completeEvent,
  recordAudit = insertAuditLogs,
  now = () => new Date()
}: CompleteEventDependencies): RequestHandler {
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

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const completed = await complete(admin, eventId, principal.userId, now());
    if (!completed.ok) {
      if (completed.reason === 'not_found') {
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      }
      if (completed.reason === 'not_finished') {
        res.status(409).json({ error: NOT_FINISHED_MESSAGE });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    await recordAudit(admin, [statusChange(eventId, principal.userId, completed.previous_status, 'completed')]);

    res.status(200).json({ request: completed.request });
  };
}
