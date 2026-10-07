import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';
import { createVenueSuitabilityStore, type SuitabilityEventRow } from './venueSuitability';

/** A booking as people see it (SG2-51): the venue, event and releaser by name.
 * The releaser's account id is not sent to clients. */
export interface VenueBookingRecord {
  booking_id: number;
  venue_id: number;
  venue_name: string | null;
  event_id: number | null;
  event_name: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  canceller_name: string | null;
}

export interface VenueBookingStore {
  event(eventId: number): Promise<SuitabilityEventRow | null>;
  venueExists(venueId: number): Promise<boolean>;
  /** The event's confirmed and released bookings, earliest first. */
  forEvent(eventId: number): Promise<VenueBookingRecord[]>;
  /** The venue's confirmed and released bookings not yet over, earliest first. */
  forVenue(venueId: number, now: string): Promise<VenueBookingRecord[]>;
}

/** Bookings that can be released, and ones already released (SG2-51). Held
 * bookings are not commitments and are left out. */
const LISTED_STATUSES = ['confirmed', 'cancelled'];
const COLUMNS = 'booking_id,venue_id,event_id,starts_at,ends_at,status,cancelled_by,cancelled_at,cancellation_reason';

type Row = Omit<VenueBookingRecord, 'venue_name' | 'event_name' | 'canceller_name'> & { cancelled_by: string | null };

/** Reads with the service role: the routes check the caller's relationship to
 * the event or venue before using this store. */
export function createVenueBookingStore(admin: SupabaseClient): VenueBookingStore {
  const suitability = createVenueSuitabilityStore(admin);
  function check(error: unknown) {
    if (error) throw new AccessError(503);
  }
  async function names(table: 'venues' | 'events' | 'users', key: string, ids: unknown[]) {
    const wanted = [...new Set(ids.filter(id => id !== null))];
    if (wanted.length === 0) return new Map<unknown, string | null>();
    const { data, error } = await admin.from(table).select(`${key},name`).in(key, wanted);
    check(error);
    return new Map((data as unknown as Record<string, unknown>[]).map(row => [row[key], row.name as string | null]));
  }
  async function present(rows: Row[]): Promise<VenueBookingRecord[]> {
    const [venues, events, users] = await Promise.all([
      names('venues', 'venue_id', rows.map(row => row.venue_id)),
      names('events', 'event_id', rows.map(row => row.event_id)),
      names('users', 'user_id', rows.map(row => row.cancelled_by))
    ]);
    return rows.map(({ cancelled_by, ...row }) => ({
      ...row,
      venue_name: venues.get(row.venue_id) ?? null,
      event_name: events.get(row.event_id) ?? null,
      canceller_name: users.get(cancelled_by) ?? null
    }));
  }
  return {
    event: eventId => suitability.event(eventId),
    async venueExists(venueId) {
      return (await suitability.venues(venueId)).length > 0;
    },
    async forEvent(eventId) {
      const { data, error } = await admin.from('venue_bookings').select(COLUMNS)
        .eq('event_id', eventId).in('status', LISTED_STATUSES).order('starts_at').order('booking_id');
      check(error);
      return present(data as Row[]);
    },
    async forVenue(venueId, now) {
      const { data, error } = await admin.from('venue_bookings').select(COLUMNS)
        .eq('venue_id', venueId).in('status', LISTED_STATUSES).gt('ends_at', now).order('starts_at').order('booking_id');
      check(error);
      return present(data as Row[]);
    }
  };
}

/** What release_venue_booking() reports (SG2-51). */
export type ReleaseResult =
  | { outcome: 'released'; booking_id: number; cancelled_at: string }
  | { outcome: 'inactive'; status: string }
  | { outcome: 'missing' | 'invalid' | 'past' };

export interface VenueBookingReleaseStore {
  release(bookingId: number, reason: string): Promise<ReleaseResult>;
}

/**
 * Releases with the caller's own token, so the database records who released
 * the booking and checks they may. The release, its history entry and the
 * notifications commit together under the venue lock.
 */
export function createVenueBookingReleaseStore(token: string, makeClient = createUserScopedClient): VenueBookingReleaseStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async release(bookingId, reason) {
      const { data, error, status } = await client.rpc('release_venue_booking', { p_booking_id: bookingId, p_reason: reason });
      if (error || data === null) throw new AccessError(status === 401 ? 401 : status === 403 || error?.code === '42501' ? 403 : 503);
      return data as ReleaseResult;
    }
  };
}
