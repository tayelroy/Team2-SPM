import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createVenueSuitabilityStore, type BookingRequestRow, type SuitabilityEventRow } from './venueSuitability';

/** Something already occupying a venue that a request overlaps (SG2-50 AC1):
 * a confirmed booking, or a live tentative hold (SG2-84). */
export interface VenueConflict {
  kind: 'booking' | 'hold';
  /** booking_id or hold_id. */
  reference_id: number;
  event_id: number | null;
  event_name: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
}

/** As read: also carries the event's coordinator, which decides whether a
 * coordinator may see which event it is. Never sent to a client. */
export interface VenueConflictRow extends VenueConflict {
  coordinator_id: string | null;
}

export interface ConflictPeriod {
  venue_id: number;
  starts_at: string;
  ends_at: string;
}

export interface ConflictOptions {
  /** Now, as an ISO timestamp: a hold past its deadline no longer holds. */
  now: string;
  /** The request being checked, so the hold it was made for (SG2-84) is not
   * reported as conflicting with itself. */
  excludeRequestId?: number;
}

export interface VenueConflictStore {
  request(requestId: number): Promise<BookingRequestRow | null>;
  event(eventId: number): Promise<SuitabilityEventRow | null>;
  /** Everything committing the venue over an overlapping period, earliest
   * first. Periods that only touch (one ends as the other starts) do not
   * overlap. */
  conflicts(period: ConflictPeriod, options: ConflictOptions): Promise<VenueConflictRow[]>;
}

/** Booking statuses that commit a venue: only confirmed, as for SG2-49's
 * approval check, venue search and blocks. A held booking is not confirmed,
 * and any other status (such as one released under SG2-51) no longer
 * conflicts (SG2-50 AC3). */
export const COMMITTED_BOOKING_STATUSES = ['confirmed'];

type BookingRow = { booking_id: number; event_id: number | null; starts_at: string; ends_at: string; status: string };
type HoldRow = { hold_id: number; event_id: number; request_id: number; starts_at: string; ends_at: string; status: string };
type EventName = { event_id: number; name: string | null; coordinator_id: string | null };

/** Reads with the service role: bookings and holds are shown to each caller
 * only as the routes allow, after checking the caller's relationship to the
 * request's event. */
export function createVenueConflictStore(admin: SupabaseClient): VenueConflictStore {
  const suitability = createVenueSuitabilityStore(admin);
  function check(error: unknown) {
    if (error) throw new AccessError(503);
  }
  return {
    request: requestId => suitability.request(requestId),
    event: eventId => suitability.event(eventId),
    async conflicts({ venue_id, starts_at, ends_at }, { now, excludeRequestId }) {
      const [bookings, holds] = await Promise.all([
        admin.from('venue_bookings').select('booking_id,event_id,starts_at,ends_at,status')
          .eq('venue_id', venue_id).in('status', COMMITTED_BOOKING_STATUSES)
          .lt('starts_at', ends_at).gt('ends_at', starts_at).order('starts_at'),
        admin.from('venue_holds').select('hold_id,event_id,request_id,starts_at,ends_at,status')
          .eq('venue_id', venue_id).eq('status', 'tentative').gt('expires_at', now)
          .lt('starts_at', ends_at).gt('ends_at', starts_at).order('starts_at')
      ]);
      check(bookings.error);
      check(holds.error);
      const found = [
        ...(bookings.data as BookingRow[]).map(({ booking_id, ...row }) => ({ kind: 'booking' as const, reference_id: booking_id, ...row })),
        ...(holds.data as HoldRow[]).filter(hold => hold.request_id !== excludeRequestId)
          .map(({ hold_id, request_id: _request, ...row }) => ({ kind: 'hold' as const, reference_id: hold_id, ...row }))
      ];
      if (found.length === 0) return [];
      const ids = [...new Set(found.map(row => row.event_id).filter(id => id !== null))];
      let events = new Map<number, EventName>();
      if (ids.length > 0) {
        const { data, error } = await admin.from('events').select('event_id,name,coordinator_id').in('event_id', ids);
        check(error);
        events = new Map((data as EventName[]).map(event => [event.event_id, event]));
      }
      return found
        .map(row => {
          const event = row.event_id === null ? undefined : events.get(row.event_id);
          return { ...row, event_name: event?.name ?? null, coordinator_id: event?.coordinator_id ?? null };
        })
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.reference_id - b.reference_id);
    }
  };
}
