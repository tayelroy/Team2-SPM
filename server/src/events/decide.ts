import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { decideEventRequest, type DecideEventRequestResult } from '../db/eventRequests';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

/** Matches the free-text limit the draft fields already use. */
const MAX_REASON_LENGTH = 5000;

export type Decision = 'approved' | 'rejected';
const DECISIONS: readonly Decision[] = ['approved', 'rejected'];

export interface DecideEventRequestDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  decide?: (
    admin: SupabaseClient,
    eventId: number,
    coordinatorId: string,
    decision: Decision,
    reason: string | null
  ) => Promise<DecideEventRequestResult>;
}

/**
 * PATCH /api/event-requests/:eventId/decision — approves or rejects a request
 * this coordinator is reviewing (SG2-37).
 *
 * A rejection must carry a reason, because the organiser is told why rather
 * than simply being refused; an approval may carry one but does not need to.
 * `decideEventRequest` repeats the coordinator and `under_review` guards in
 * the write itself, so authorisation and the transition happen together and
 * two coordinators cannot record conflicting decisions.
 *
 * Approval sets `approved` rather than `planning`: SG2-38's stage calculator
 * already reads `approved` as "Approved — In Planning", so planning becomes
 * available through the shipped tracker without this story inventing a
 * second meaning for the status.
 */
export function createDecideEventRequestHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  decide = decideEventRequest
}: DecideEventRequestDependencies): RequestHandler {
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

    const body = (req.body ?? {}) as { decision?: unknown; reason?: unknown };
    const decision = body.decision;
    if (typeof decision !== 'string' || !DECISIONS.includes(decision as Decision)) {
      res.status(400).json({ error: 'decision must be either approved or rejected.' });
      return;
    }

    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') {
      res.status(400).json({ error: 'reason must be text.' });
      return;
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length > MAX_REASON_LENGTH) {
      res.status(400).json({ error: `reason must be ${MAX_REASON_LENGTH} characters or fewer.` });
      return;
    }
    if (decision === 'rejected' && reason.length === 0) {
      // AC2: a rejection always explains itself, so the organiser knows what
      // to change before resubmitting.
      res.status(400).json({ error: 'A reason is required when rejecting an event request.' });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const decided = await decide(
      admin,
      eventId,
      principal.userId,
      decision as Decision,
      reason.length > 0 ? reason : null
    );
    if (!decided.ok) {
      if (decided.reason === 'not_found') {
        res.status(404).json({ error: 'No event request under review is assigned to this account.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ request: decided.request });
  };
}
