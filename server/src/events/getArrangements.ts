import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchEventPlanningRecord,
  type FetchEventPlanningResult
} from '../db/eventPlanning';
import {
  fetchEventArrangementFacts,
  type FetchEventArrangementFactsResult
} from '../db/eventArrangements';
import { computeArrangementReadiness } from './arrangementReadiness';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE =
  'Event arrangements service is temporarily unavailable. Please try again later.';

export interface GetEventArrangementsDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchPlanningRecord?: (
    client: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventPlanningResult>;
  fetchArrangementFacts?: (
    client: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventArrangementFactsResult>;
}

/**
 * GET /api/event-requests/:eventId/arrangements — returns which arrangements
 * (venue, equipment, registration) are ready or outstanding and whether the
 * event is ready for confirmation (SG2-57).
 *
 * Restricted to the event's assigned coordinator: the story is written from the
 * coordinator's perspective, and ownership is enforced per-row here as in the
 * planning update (SG2-39/SG2-90).
 */
export function createGetEventArrangementsHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchPlanningRecord = fetchEventPlanningRecord,
  fetchArrangementFacts = fetchEventArrangementFacts
}: GetEventArrangementsDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (principal.role !== 'event_coordinator') {
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

    const planning = await fetchPlanningRecord(admin, eventId);
    if (!planning.ok) {
      if (planning.reason === 'not_found') {
        res.status(404).json({ error: 'Event not found.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const { event } = planning;

    // Only the assigned coordinator may view an event's arrangement readiness.
    // A 404 rather than 403 would also be defensible, but the planning routes
    // answer "not yours" with 403, so this matches them.
    if (event.coordinator_id !== principal.userId) {
      res.status(403).json({
        error: 'Only the assigned event coordinator can view these arrangements.'
      });
      return;
    }

    const facts = await fetchArrangementFacts(admin, eventId);
    if (!facts.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const readiness = computeArrangementReadiness({
      event_id: eventId,
      registration_needed: event.registration_needed,
      registration_capacity: event.registration_capacity,
      registration_opens_at: event.registration_opens_at,
      registration_closes_at: event.registration_closes_at,
      venue_requests: facts.facts.venue_requests,
      equipment_requests: facts.facts.equipment_requests
    });

    res.status(200).json(readiness);
  };
}
