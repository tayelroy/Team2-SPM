import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchOwnEventRequests,
  fetchOwnEventRequest,
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
    statusFilter?: string
  ) => Promise<FetchEventRequestsResult>;
}

/**
 * GET /api/event-requests — lists event requests for the caller (SG2-31).
 *
 * Scoped to the authenticated organiser so multi-tenancy boundaries are
 * preserved. Supports optional `status` filter query parameter.
 */
export function getEventRequestsHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRequests = fetchOwnEventRequests
}: GetEventRequestsDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
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

    const result = await fetchRequests(admin, principal.userId, statusFilter);
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
  fetchOwnRequest?: (
    admin: SupabaseClient,
    eventId: number,
    organiserId: string
  ) => Promise<FetchEventRequestResult>;
}

/**
 * GET /api/event-requests/:eventId — returns full detail for an event request (SG2-31).
 *
 * Scoped to the authenticated organiser so a request belonging to someone else
 * is indistinguishable from one that does not exist at all (404 Not Found).
 */
export function getEventRequestDetailHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchOwnRequest = fetchOwnEventRequest
}: GetEventRequestDetailDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is mounted behind requireAuth.
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

    const result = await fetchOwnRequest(admin, eventId, principal.userId);
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
