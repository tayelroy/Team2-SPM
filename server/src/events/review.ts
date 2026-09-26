import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { startEventReview, type StartReviewResult } from '../db/eventRequests';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface StartEventReviewDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  startReview?: (
    admin: SupabaseClient,
    eventId: number,
    coordinatorId: string
  ) => Promise<StartReviewResult>;
}

/**
 * PATCH /api/event-requests/:eventId/review — opens a request assigned to this
 * coordinator for review (SG2-35), moving it to `under_review` so the
 * organiser can see someone is looking at it.
 *
 * Unlike the organiser-facing handlers there is no separate ownership lookup:
 * startEventReview carries both the coordinator and status guards in the
 * update itself, so a single round trip authorises and transitions together.
 * Re-opening a review already in progress succeeds unchanged rather than
 * conflicting, because a coordinator returning to their own open review is
 * ordinary rather than an error.
 */
export function createStartEventReviewHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  startReview = startEventReview
}: StartEventReviewDependencies): RequestHandler {
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

    const reviewed = await startReview(admin, eventId, principal.userId);
    if (!reviewed.ok) {
      if (reviewed.reason === 'not_found') {
        // Assignment is made by Technical Support Staff (SG2-33). A request
        // assigned to another coordinator, still unassigned, or already past
        // review all answer identically so assignments cannot be probed for.
        res.status(404).json({ error: 'No reviewable event request is assigned to this account.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ request: reviewed.request });
  };
}
