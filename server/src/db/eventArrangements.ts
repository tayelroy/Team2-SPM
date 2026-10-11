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
  /** Stock may already be reserved without a linked request on legacy events.
   * Kept internal: planning rechecks need existence, not receipt details. */
  equipment_reserved?: boolean;
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
 * fetchEventPlanningRecord; this adds child request facts and reservation
 * existence. Reservations have no status column; a nonterminal event's rows
 * remain commitments, including receipts with no linked request.
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

  const reserved = await admin
    .from('equipment_reservations')
    .select('reservation_id')
    .eq('event_id', eventId)
    .limit(1);
  if (reserved.error) {
    return { ok: false, reason: 'unavailable', message: reserved.error.message };
  }

  return {
    ok: true,
    facts: {
      venue_requests: (venue.data ?? []) as VenueBookingStatusRow[],
      equipment_requests: (equipment.data ?? []) as EquipmentRequestArrangementRow[],
      equipment_reserved: (reserved.data ?? []).length > 0
    }
  };
}
