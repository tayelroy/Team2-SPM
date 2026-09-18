import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { listOwnEventRequests, type ListOwnEventRequestsResult } from '../db/eventRequests';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface ListMyEventRequestsDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  listOwnRequests?: (admin: SupabaseClient, organiserId: string) => Promise<ListOwnEventRequestsResult>;
}

/**
 * GET /api/event-requests — lists the caller's own event requests (SG2-32's
 * minimal slice of SG2-31: enough to see and act on your own drafts, not the
 * full "see the state of my requests" feature — no coordinator-facing view,
 * no status history, just the caller's own rows in whatever state they're in).
 */
export function createListMyEventRequestsHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  listOwnRequests = listOwnEventRequests
}: ListMyEventRequestsDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
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

    const result = await listOwnRequests(admin, principal.userId);
    if (!result.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ requests: result.requests });
  };
}
