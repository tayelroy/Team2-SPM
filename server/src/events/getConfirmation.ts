import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import {
  fetchConfirmedArrangements,
  fetchEventConfirmationRecord,
  type FetchConfirmedArrangementsResult,
  type FetchEventConfirmationRecordResult
} from '../db/eventConfirmation';
import { registrationWindow } from './registrationWindow';
import type { Principal } from '../auth/policy';

const UNAVAILABLE_MESSAGE = 'Confirmed arrangements are temporarily unavailable. Please try again later.';
const NOT_FOUND_MESSAGE = 'No confirmed event was found for this account.';
const VISIBLE_STATUSES = ['confirmed', 'completed'];

export interface GetEventConfirmationDependencies {
  /** Reads the verified caller established by requireAuth. */
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchRecord?: (client: SupabaseClient, eventId: number) => Promise<FetchEventConfirmationRecordResult>;
  fetchArrangements?: (client: SupabaseClient, eventId: number) => Promise<FetchConfirmedArrangementsResult>;
  /** Injected so no test depends on the real clock. */
  now?: () => Date;
}

/**
 * GET /api/event-requests/:eventId/confirmation — the confirmed arrangements
 * of a confirmed (or since completed) event, for the organiser who created it
 * and the coordinator assigned to it (SG2-58 AC1/AC3).
 *
 * The rows are read with the service role, so the relationship is checked
 * here first. Anyone else, and any event not yet confirmed, gets the same 404
 * so neither other people's events nor an event's progress can be probed.
 */
export function createGetEventConfirmationHandler({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchRecord = fetchEventConfirmationRecord,
  fetchArrangements = fetchConfirmedArrangements,
  now = () => new Date()
}: GetEventConfirmationDependencies): RequestHandler {
  return async (req, res) => {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: this handler is only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const raw = req.params.eventId;
    const eventId = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return;
    }

    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const record = await fetchRecord(admin, eventId);
    if (!record.ok) {
      if (record.reason === 'not_found') res.status(404).json({ error: NOT_FOUND_MESSAGE });
      else res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const { event } = record;
    const related = principal.role === 'event_organiser'
      ? event.organiser_id === principal.userId
      : principal.role === 'event_coordinator' && event.coordinator_id === principal.userId;
    if (!related || !VISIBLE_STATUSES.includes(event.status.toLowerCase())) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }

    const arrangements = await fetchArrangements(admin, eventId);
    if (!arrangements.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const needed = event.registration_needed === true;
    res.status(200).json({
      event_id: event.event_id,
      status: event.status,
      confirmed_at: event.confirmed_at,
      venues: arrangements.arrangements.venues,
      equipment: arrangements.arrangements.equipment,
      registration: {
        needed,
        capacity: needed ? event.registration_capacity : null,
        opens_at: needed ? event.registration_opens_at : null,
        closes_at: needed ? event.registration_closes_at : null,
        window: registrationWindow(event, now())
      }
    });
  };
}
