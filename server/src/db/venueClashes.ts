import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';

/** One side of a flagged clash (SG2-79): a confirmed booking with its venue
 * and event by name. The coordinator decides who may see the event's name and
 * is never sent to clients. */
export interface ClashBookingRow {
  booking_id: number;
  venue_id: number;
  venue_name: string | null;
  event_id: number | null;
  event_name: string | null;
  starts_at: string;
  ends_at: string;
  coordinator_id: string | null;
}

/** A flagged booking and the booking it clashes with. Each flagged pair gives
 * two rows, one from each booking's side. */
export interface ClashRow {
  booking: ClashBookingRow;
  clashes_with: ClashBookingRow;
  flagged_at: string;
}

export interface VenueClashStore {
  /** Every flagged booking, earliest first. */
  list(): Promise<ClashRow[]>;
}

type PairRow = { booking_id: number; other_booking_id: number; venue_id: number; flagged_at: string };
type BookingRow = { booking_id: number; venue_id: number; event_id: number | null; starts_at: string; ends_at: string };
type EventRow = { event_id: number; name: string | null; coordinator_id: string | null };
type VenueRow = { venue_id: number; name: string | null };

/** Reads with the service role: flags are server-only, and the route shows
 * each caller only what they may see. */
export function createVenueClashStore(admin: SupabaseClient): VenueClashStore {
  function check(error: unknown) {
    if (error) throw new AccessError(503);
  }
  async function byId<T>(table: string, key: string, columns: string, ids: unknown[]): Promise<Map<unknown, T>> {
    const wanted = [...new Set(ids.filter(id => id !== null))];
    if (wanted.length === 0) return new Map();
    const { data, error } = await admin.from(table).select(columns).in(key, wanted);
    check(error);
    return new Map((data as unknown as Record<string, unknown>[]).map(row => [row[key], row as T]));
  }
  return {
    async list() {
      const { data, error } = await admin.from('venue_booking_clashes').select('booking_id,other_booking_id,venue_id,flagged_at').order('flagged_at');
      check(error);
      const pairs = data as PairRow[];
      if (pairs.length === 0) return [];
      const bookings = await byId<BookingRow>('venue_bookings', 'booking_id', 'booking_id,venue_id,event_id,starts_at,ends_at',
        pairs.flatMap(pair => [pair.booking_id, pair.other_booking_id]));
      const [events, venues] = await Promise.all([
        byId<EventRow>('events', 'event_id', 'event_id,name,coordinator_id', [...bookings.values()].map(row => row.event_id)),
        byId<VenueRow>('venues', 'venue_id', 'venue_id,name', [...bookings.values()].map(row => row.venue_id))
      ]);
      const side = (id: number): ClashBookingRow | null => {
        const booking = bookings.get(id);
        if (!booking) return null;
        const event = booking.event_id === null ? undefined : events.get(booking.event_id);
        return { ...booking, venue_name: venues.get(booking.venue_id)?.name ?? null,
          event_name: event?.name ?? null, coordinator_id: event?.coordinator_id ?? null };
      };
      const rows: ClashRow[] = [];
      for (const pair of pairs) {
        const a = side(pair.booking_id);
        const b = side(pair.other_booking_id);
        // A booking removed between the two reads takes its flag with it.
        if (!a || !b) continue;
        rows.push({ booking: a, clashes_with: b, flagged_at: pair.flagged_at }, { booking: b, clashes_with: a, flagged_at: pair.flagged_at });
      }
      return rows.sort((x, y) => Date.parse(x.booking.starts_at) - Date.parse(y.booking.starts_at) || x.booking.booking_id - y.booking.booking_id);
    }
  };
}
