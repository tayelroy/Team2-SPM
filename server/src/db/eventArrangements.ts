import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAffectedBookingIds } from './venueDisruptions';

/**
 * Arrangement facts for an event's readiness view (SG2-57). Only the fields the
 * readiness computation needs are read; names, periods and notes are not.
 */
export interface VenueBookingStatusRow {
  status: string;
  /** SG2-58: a confirmed venue_bookings row is linked to this request, either
   * through venue_booking_requests.venue_booking_id or through a venue hold
   * converted for the request (venue_holds.booking_id). */
  booked: boolean;
}

export interface EquipmentRequestArrangementRow {
  status: string;
  /** SG2-53: the unmet quantity Technical Support recorded, or null while the
   * request has not been arranged. */
  shortfall: number | null;
  /** SG2-53: set together with placement_position once the request is placed. */
  placement_venue_id: number | null;
  /** SG2-58: an SG2-55 reservation receipt exists for this request. */
  reserved: boolean;
}

export interface EventArrangementFacts {
  venue_requests: VenueBookingStatusRow[];
  /** SG2-81 AC2: confirmed bookings a venue's unavailability affects. Each
   * leaves the venue arrangement outstanding until it is replaced. Always
   * set by fetchEventArrangementFacts; absent means none. */
  affected_bookings?: number;
  equipment_requests: EquipmentRequestArrangementRow[];
  /** Stock may already be reserved without a linked request on legacy events.
   * Kept internal: planning rechecks need existence, not receipt details. */
  equipment_reserved?: boolean;
}

interface EquipmentRequestRow {
  request_id: number;
  status: string;
  shortfall: number | null;
  placement_venue_id: number | null;
}

interface VenueRequestRow {
  request_id: number;
  status: string;
  venue_booking_id: number | null;
}

interface VenueHoldRow {
  request_id: number | null;
  booking_id: number | null;
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
 * fetchEventPlanningRecord; this adds child request facts, which venue requests
 * still have a confirmed booking, which equipment requests have a reservation
 * receipt (SG2-58 readiness) and whether any reservation exists.
 * Reservations have no status column; a nonterminal event's rows remain
 * commitments, including receipts with no linked request.
 */
export async function fetchEventArrangementFacts(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchEventArrangementFactsResult> {
  const venue = await admin
    .from('venue_booking_requests')
    .select('request_id, status, venue_booking_id')
    .eq('event_id', eventId);
  if (venue.error) {
    return { ok: false, reason: 'unavailable', message: venue.error.message };
  }

  // A hold converted for a request records its booking on the hold, not on the
  // request (change_venue_hold 'convert'), so both links are followed.
  const holds = await admin
    .from('venue_holds')
    .select('request_id, booking_id')
    .eq('event_id', eventId);
  if (holds.error) {
    return { ok: false, reason: 'unavailable', message: holds.error.message };
  }

  const bookings = await admin
    .from('venue_bookings')
    .select('booking_id')
    .eq('event_id', eventId)
    .eq('status', 'confirmed');
  if (bookings.error) {
    return { ok: false, reason: 'unavailable', message: bookings.error.message };
  }

  const confirmedBookings = new Set(
    ((bookings.data ?? []) as { booking_id: number }[]).map(row => Number(row.booking_id))
  );
  const affected = await fetchAffectedBookingIds(admin, [...confirmedBookings]);
  if (!affected.ok) {
    return { ok: false, reason: 'unavailable', message: affected.message };
  }
  const holdBookings = new Map<number, number[]>();
  for (const hold of (holds.data ?? []) as VenueHoldRow[]) {
    if (hold.request_id === null || hold.booking_id === null) continue;
    const key = Number(hold.request_id);
    holdBookings.set(key, [...(holdBookings.get(key) ?? []), Number(hold.booking_id)]);
  }
  const venueRequests = ((venue.data ?? []) as VenueRequestRow[]).map(row => ({
    status: row.status,
    booked:
      (row.venue_booking_id !== null && confirmedBookings.has(Number(row.venue_booking_id))) ||
      (holdBookings.get(Number(row.request_id)) ?? []).some(id => confirmedBookings.has(id))
  }));

  const equipment = await admin
    .from('equipment_requests')
    .select('request_id, status, shortfall, placement_venue_id')
    .eq('event_id', eventId);
  if (equipment.error) {
    return { ok: false, reason: 'unavailable', message: equipment.error.message };
  }

  // Every receipt for the event, not just one: readiness needs to know which
  // requests are reserved, planning rechecks only that any receipt exists.
  const reserved = await admin
    .from('equipment_reservations')
    .select('request_id')
    .eq('event_id', eventId);
  if (reserved.error) {
    return { ok: false, reason: 'unavailable', message: reserved.error.message };
  }

  const receipts = (reserved.data ?? []) as { request_id: number | null }[];
  const reservedRequests = new Set(
    receipts.flatMap(row => (row.request_id === null ? [] : [Number(row.request_id)]))
  );
  return {
    ok: true,
    facts: {
      venue_requests: venueRequests,
      affected_bookings: affected.ids.size,
      equipment_requests: ((equipment.data ?? []) as EquipmentRequestRow[]).map(row => ({
        status: row.status,
        shortfall: row.shortfall,
        placement_venue_id: row.placement_venue_id,
        reserved: reservedRequests.has(Number(row.request_id))
      })),
      equipment_reserved: receipts.length > 0
    }
  };
}
