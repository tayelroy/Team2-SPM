import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchOwnEventRequest,
  submitEventRequest,
  type FetchEventRequestResult,
  type SubmitEventRequestResult
} from '../db/eventRequests';
import type { Principal } from '../auth/policy';
import { missingForSubmission } from './fields';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface SubmitEventRequestDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchOwnRequest?: (
    admin: SupabaseClient,
    eventId: number,
    organiserId: string
  ) => Promise<FetchEventRequestResult>;
  submitRequest?: (admin: SupabaseClient, eventId: number) => Promise<SubmitEventRequestResult>;
}

/**
 * PATCH /api/event-requests/:eventId/submit — submits a draft for review (SG2-30).
 *
 * Only the request's own organiser may submit it, only while it is still a
 * `draft`, and only once every SUBMISSION_REQUIRED_FIELDS value (SG2-28) is
 * filled in. The `draft` → `submitted` transition happens only here, through
 * the admin client, so it can never be forged by a direct client write to
 * `status` — the gap the AI Security Review flagged on the earlier attempt
 * at this ticket (PR #13).
 */
export function submitEventRequestHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchOwnRequest = fetchOwnEventRequest,
  submitRequest = submitEventRequest
}: SubmitEventRequestDependencies): RequestHandler {
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

    const existing = await fetchOwnRequest(admin, eventId, principal.userId);
    if (!existing.ok) {
      if (existing.reason === 'not_found') {
        // Deliberately the same response whether the row belongs to someone
        // else or does not exist at all — see fetchOwnEventRequest.
        res.status(404).json({ error: 'No event request found for this account.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    if (existing.request.status !== 'draft') {
      // Criterion #3: once a request has left draft, it is not a valid
      // submission target — this is also what makes it immutable.
      res.status(409).json({ error: 'Only a draft event request can be submitted.' });
      return;
    }

    const missing = missingForSubmission(existing.request);
    if (missing.length > 0) {
      // Criterion #2: refuse submission and list what is outstanding; the
      // request stays in draft because no update is issued.
      res.status(400).json({ error: 'Event request is missing required fields.', missing });
      return;
    }

    const submitted = await submitRequest(admin, eventId);
    if (!submitted.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    // Criterion #1: now visible to ConnectSphere for review and reflects as submitted.
    res.status(200).json({ request: submitted.request });
  };
}
