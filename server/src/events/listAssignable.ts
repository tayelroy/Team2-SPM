import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { fetchAssignableRequests, type FetchAssignableRequestsResult } from '../db/eventRequests';
import { listCoordinators, type ListCoordinatorsResult } from '../db/accountRoles';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface ListAssignableDependencies {
  getAdminClient?: () => SupabaseClient | null;
  fetchRequests?: (admin: SupabaseClient) => Promise<FetchAssignableRequestsResult>;
  fetchCoordinators?: (admin: SupabaseClient) => Promise<ListCoordinatorsResult>;
}

/**
 * GET /api/event-requests/assignable — what Technical Support Staff need to
 * make an assignment (SG2-33/SG2-34): the requests that can take a
 * coordinator and the coordinators to choose from. Mounted behind
 * requirePermission('event_request.assign_coordinator'), the same grant as
 * the write it feeds, so no one who cannot assign can list.
 */
export function createListAssignableHandler({
  getAdminClient = getSupabaseAdminClient,
  fetchRequests = fetchAssignableRequests,
  fetchCoordinators = listCoordinators
}: ListAssignableDependencies = {}): RequestHandler {
  return async (_req, res) => {
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const [requests, coordinators] = await Promise.all([fetchRequests(admin), fetchCoordinators(admin)]);
    if (!requests.ok || !coordinators.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ requests: requests.requests, coordinators: coordinators.coordinators });
  };
}
