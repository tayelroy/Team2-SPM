import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchOrganisationEventRequests,
  fetchOrganisationEventRequest,
  type FetchEventRequestsResult,
  type FetchEventRequestResult
} from '../db/eventRequests';
import type { Principal } from '../auth/policy';
import { isEventStatus } from './fields';

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export interface GetEventRequestsDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchRequests?: (
    admin: SupabaseClient,
    organiserId: string,
    statusFilter?: string,
    scope?: 'organisation' | 'mine'
  ) => Promise<FetchEventRequestsResult>;
}

/**
 * GET /api/event-requests — lists event requests for the caller (SG2-31).
 *
 * Organisers read their current organisation; scope=mine additionally limits
 * the result to their own requests. Only Event Organisers may use this view.
 */
export function getEventRequestsHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRequests = fetchOrganisationEventRequests
}: GetEventRequestsDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (principal.role !== 'event_organiser') {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const scope = req.query.scope ?? 'organisation';
    if (scope !== 'organisation' && scope !== 'mine') {
      res.status(400).json({ error: 'Invalid event scope.' });
      return;
    }

    let statusFilter: string | undefined;
    const rawStatus = req.query.status;
    if (typeof rawStatus === 'string') {
      const trimmed = rawStatus.trim().toLowerCase();
      if (trimmed && trimmed !== 'all') {
        if (!isEventStatus(trimmed)) {
          res.status(400).json({ error: 'Invalid status filter.' });
          return;
        }
        statusFilter = trimmed;
      }
    } else if (rawStatus !== undefined) {
      res.status(400).json({ error: 'Invalid status filter.' });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    let result: FetchEventRequestsResult;
    try {
      result = await fetchRequests(admin, principal.userId, statusFilter, scope);
    } catch {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    if (!result.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ requests: result.requests });
  };
}

export interface GetEventRequestDetailDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchRequest?: typeof fetchOrganisationEventRequest;

}

/**
 * GET /api/event-requests/:eventId — returns full detail for an event request (SG2-31).
 *
 * Organisers read their current organisation. Other organisations are
 * indistinguishable from missing records (404); write access stays creator-only.
 */
export function getEventRequestDetailHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRequest = fetchOrganisationEventRequest
}: GetEventRequestDetailDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (principal.role !== 'event_organiser') {
      res.status(403).json({ error: 'Access denied' });
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

    let result: FetchEventRequestResult;
    try {
      result = await fetchRequest(admin, eventId, principal.userId);
    } catch {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    if (!result.ok) {
      if (result.reason === 'not_found') {
        res.status(404).json({ error: 'No event request found for this account.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    res.status(200).json({ request: result.request });
  };
}
