import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  deleteEventRequestDraft,
  fetchOwnEventRequest,
  type DeleteDraftResult,
  type FetchEventRequestResult
} from '../db/eventRequests';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface DeleteEventDraftDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchOwnRequest?: (
    admin: SupabaseClient,
    eventId: number,
    organiserId: string
  ) => Promise<FetchEventRequestResult>;
  deleteDraft?: (admin: SupabaseClient, eventId: number) => Promise<DeleteDraftResult>;
}

/**
 * DELETE /api/event-requests/:eventId — deletes a draft event request
 * (SG2-32). Only the request's own organiser can delete it, and only while
 * it is still a draft — mirrors submitEventRequestHandler's fetch-then-check
 * shape (SG2-30), reusing fetchOwnEventRequest so a request belonging to
 * someone else is indistinguishable from one that doesn't exist at all.
 */
export function createDeleteEventDraftHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchOwnRequest = fetchOwnEventRequest,
  deleteDraft = deleteEventRequestDraft
}: DeleteEventDraftDependencies): RequestHandler {
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
      res.status(409).json({ error: 'Only a draft event request can be deleted.' });
      return;
    }

    const deleted = await deleteDraft(admin, eventId);
    if (!deleted.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ message: 'Draft deleted.' });
  };
}
