import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Arrangement facts for an event's readiness view (SG2-57). Only the fields the
 * readiness computation needs are read; names, periods and notes are not.
 */
export interface VenueBookingStatusRow {
  status: string;
}

export interface EquipmentRequestArrangementRow {
  status: string;
  /** SG2-53: the unmet quantity Technical Support recorded, or null while the
   * request has not been arranged. */
  shortfall: number | null;
  /** SG2-53: set together with placement_position once the request is placed. */
  placement_venue_id: number | null;
}

export interface EventArrangementFacts {
  venue_requests: VenueBookingStatusRow[];
  equipment_requests: EquipmentRequestArrangementRow[];
}

export type FetchEventArrangementFactsResult =
  | { ok: true; facts: EventArrangementFacts }
  | { ok: false; reason: 'unavailable'; message: string };

/**
 * Reads the venue-booking and equipment-request arrangement facts for an event
 * with the service role. These tables are not client-readable under RLS, so the
 * route checks the caller's relationship to the event before calling this.
 *
 * The event's own registration fields and coordinator come from
 * fetchEventPlanningRecord; this only adds what lives in the two child tables.
 */
export async function fetchEventArrangementFacts(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchEventArrangementFactsResult> {
  const venue = await admin
    .from('venue_booking_requests')
    .select('status')
    .eq('event_id', eventId);
  if (venue.error) {
    return { ok: false, reason: 'unavailable', message: venue.error.message };
  }

  const equipment = await admin
    .from('equipment_requests')
    .select('status, shortfall, placement_venue_id')
    .eq('event_id', eventId);
  if (equipment.error) {
    return { ok: false, reason: 'unavailable', message: equipment.error.message };
  }

  return {
    ok: true,
    facts: {
      venue_requests: (venue.data ?? []) as VenueBookingStatusRow[],
      equipment_requests: (equipment.data ?? []) as EquipmentRequestArrangementRow[]
    }
  };
}
