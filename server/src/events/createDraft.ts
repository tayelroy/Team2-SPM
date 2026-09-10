import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchOrganiserOrganisation,
  insertEventRequestDraft,
  type CreateDraftResult,
  type OrganiserLookupResult
} from '../db/eventRequests';
import type { Principal } from '../auth/policy';
import { missingForSubmission, validateDraftInput, type DraftValues } from './fields';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface CreateEventDraftDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  lookupOrganisation?: (
    admin: SupabaseClient,
    userId: string
  ) => Promise<OrganiserLookupResult>;
  insertDraft?: (
    admin: SupabaseClient,
    draft: { organiserId: string; organisation: string | null; values: DraftValues }
  ) => Promise<CreateDraftResult>;
}

/**
 * POST /api/event-requests — creates an event request as a draft (SG2-28).
 *
 * The draft is filed against the verified caller and their own client
 * organisation; neither is read from the request body. Incomplete drafts are
 * accepted by design, and the response names the fields still outstanding for
 * submission so the client can show progress without blocking the save.
 */
export function createEventDraftHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  lookupOrganisation = fetchOrganiserOrganisation,
  insertDraft = insertEventRequestDraft
}: CreateEventDraftDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
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

    const organiser = await lookupOrganisation(admin, principal.userId);
    if (!organiser.ok) {
      if (organiser.reason === 'not_found') {
        // Authenticated, but the account has no public.users row to own the
        // draft. That is an account-provisioning inconsistency rather than a
        // permission problem, so it is reported separately from 401/403.
        res.status(409).json({
          error: 'Your account is not fully set up yet. Please contact support.'
        });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const created = await insertDraft(admin, {
      organiserId: principal.userId,
      organisation: organiser.organisation,
      values: validated.values
    });

    if (!created.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(201).json({
      request: created.request,
      missingForSubmission: missingForSubmission(created.request)
    });
  };
}
