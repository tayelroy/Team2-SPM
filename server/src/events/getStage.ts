import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchEventPlanningRecord,
  type FetchEventPlanningResult
} from '../db/eventPlanning';
import { computeEventStage } from './stageCalculator';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Event stage service is temporarily unavailable. Please try again later.';

export interface GetEventStageDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchPlanningRecord?: (
    client: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventPlanningResult>;
}

/**
 * GET /api/event-requests/:eventId/stage — returns computed plain-language stage,
 * waiting-on responsibility, and stepper details (SG2-38).
 */
export function createGetEventStageHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchPlanningRecord = fetchEventPlanningRecord
}: GetEventStageDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
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

    const result = await fetchPlanningRecord(admin, eventId);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        res.status(404).json({ error: 'Event not found.' });
        return;
      }
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const { event } = result;

    // RBAC & Multi-tenancy check:
    // - Attendees are denied
    // - Organisers can only view stages of their own event requests
    // - Internal staff (coordinator, venue_staff, technical_support_staff) are authorized
    if (principal.role === 'attendee') {
      res.status(403).json({ error: 'Attendees are not authorized to view event stages.' });
      return;
    }

    if (principal.role === 'event_organiser' && event.organiser_id !== principal.userId) {
      res.status(403).json({ error: 'You are not authorized to view the stage of this event.' });
      return;
    }

    const stageInfo = computeEventStage(event);
    res.status(200).json(stageInfo);
  };
}
