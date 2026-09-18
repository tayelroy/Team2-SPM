import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchOwnEventRequest,
  updateEventRequestDraft,
  type FetchEventRequestResult,
  type UpdateDraftResult
} from '../db/eventRequests';
import type { Principal } from '../auth/policy';
import { missingForSubmission, validateDraftInput, type DraftValues } from './fields';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface UpdateEventDraftDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchOwnRequest?: (
    admin: SupabaseClient,
    eventId: number,
    organiserId: string
  ) => Promise<FetchEventRequestResult>;
  updateDraft?: (
    admin: SupabaseClient,
    eventId: number,
    organiserId: string,
    values: DraftValues
  ) => Promise<UpdateDraftResult>;
}

/**
 * PATCH /api/event-requests/:eventId — updates a draft's own fields
 * (SG2-29). Only the request's own organiser may edit it, only while it is
 * still a draft — mirrors submitEventRequestHandler / createDeleteEventDraftHandler's
 * fetch-then-check shape, reusing fetchOwnEventRequest so a request
 * belonging to someone else is indistinguishable from one that doesn't
 * exist at all. `updateEventRequestDraft` itself also filters on the
 * caller's organiser id (not just this pre-check), so ownership holds even
 * if a future caller of that function skips or reorders this step.
 *
 * The body is validated exactly like create (SG2-28's validateDraftInput —
 * malformed values rejected, missing ones accepted as still-incomplete) and
 * treated as a full replace, matching how the client form already holds and
 * resubmits its complete state on every save rather than a diff.
 */
export function createUpdateEventDraftHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchOwnRequest = fetchOwnEventRequest,
  updateDraft = updateEventRequestDraft
}: UpdateEventDraftDependencies): RequestHandler {
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

    const validated = validateDraftInput(req.body ?? {});
    if (!validated.valid) {
      res.status(400).json({ error: 'Invalid event request details', details: validated.errors });
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
      res.status(409).json({ error: 'Only a draft event request can be edited.' });
      return;
    }

    const updated = await updateDraft(admin, eventId, principal.userId, validated.values);
    if (!updated.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({
      request: updated.request,
      missingForSubmission: missingForSubmission(updated.request)
    });
  };
}
