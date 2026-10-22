import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import type { Layout } from '../venues/layoutFields';
import type { VenueBookingRequestValues } from '../venues/bookingRequestFields';
import { createVenueSuitabilityStore, type CapacityExceptionRecord, type SuitabilityEventRow, type SuitabilityVenueRow } from './venueSuitability';
import { createVenueConflictStore, type VenueConflictStore } from './venueConflicts';
import { fetchEventArrangementFacts, type VenueBookingStatusRow } from './eventArrangements';
import { fetchAffectedBookingIds } from './venueDisruptions';

/** A venue request as people see it: the venue, requester and decider by
 * name. Their account ids are not sent to clients. */
export interface VenueBookingRequestRecord {
  request_id: number;
  event_id: number;
  venue_id: number;
  venue_name: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  layout: Layout | null;
  venue_requirements: string | null;
  requester_name: string | null;
  requested_at: string;
  /** SG2-49 AC2/AC3: who decided, when, and why (required for a rejection). */
  decider_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  /** SG2-82: who withdrew the request, and when, once the event no longer
   * needs that venue. */
  withdrawer_name: string | null;
  withdrawn_at: string | null;
}

export type NewVenueBookingRequest = VenueBookingRequestValues & {
  venue_requirements: string | null;
  requested_by: string;
};

export interface VenueBookingRequestStore {
  event(eventId: number): Promise<SuitabilityEventRow | null>;
  venue(venueId: number): Promise<SuitabilityVenueRow | null>;
  /** The layouts the venue supports (SG2-43). */
  layouts(venueId: number): Promise<Layout[]>;
  /** A coordinator's pending or approved request from the same event for the
   * same venue over an overlapping period, if there is one (AC4). Requests a
   * tentative hold creates for itself (SG2-84) have no requester. */
  duplicate(values: VenueBookingRequestValues): Promise<VenueBookingRequestRecord | null>;
  /** Null when the same request was made concurrently and the database
   * refused it as a duplicate; 'stale' when the booking it changes was
   * cancelled or ended meanwhile (SG2-83, venue_change_request_check). */
  create(values: NewVenueBookingRequest): Promise<VenueBookingRequestRecord | null | 'stale'>;
  /** The event's requests, earliest first. */
  list(eventId: number): Promise<VenueBookingRequestRecord[]>;
  /** SG2-49: one request, with names. */
  request(requestId: number): Promise<VenueBookingRequestRecord | null>;
  /** SG2-49: the tentative hold (SG2-84) that created this request, if any. */
  hold(requestId: number): Promise<number | null>;
  /** SG2-47: capacity exceptions approved for the request. */
  exceptions(requestId: number): Promise<CapacityExceptionRecord[]>;
  /** What else commits the venue over the period (SG2-50 AC1). */
  conflicts: VenueConflictStore['conflicts'];
  /** SG2-82 AC5: each of the event's requests by status, and whether an
   * approved one still has its confirmed booking, as SG2-57's readiness reads
   * them. */
  venueStatuses(eventId: number): Promise<VenueBookingStatusRow[]>;
  /** SG2-81: the event's confirmed bookings a venue's unavailability affects. */
  affectedBookings(eventId: number): Promise<number[]>;
  /** SG2-83 AC1: the event's confirmed bookings not yet over, which the
   * coordinator may change. */
  changeableBookings(eventId: number, now: string): Promise<number[]>;
}

const REQUEST_COLUMNS = 'request_id,event_id,venue_id,starts_at,ends_at,status,layout,venue_requirements,requested_by,requested_at,decided_by,decided_at,decision_reason,withdrawn_by,withdrawn_at';
const LIVE_STATUSES = ['pending', 'approved'];

type Row = Omit<VenueBookingRequestRecord, 'venue_name' | 'requester_name' | 'decider_name' | 'withdrawer_name'>
  & { requested_by: string | null; decided_by: string | null; withdrawn_by: string | null };

/** Reads and writes with the service role: booking requests are not readable
 * by any client under RLS, so the routes check the caller's relationship to
 * the event before using this store. */
export function createVenueBookingRequestStore(admin: SupabaseClient): VenueBookingRequestStore {
  const suitability = createVenueSuitabilityStore(admin);
  const occupancy = createVenueConflictStore(admin);
  function check(error: unknown) {
    if (error) throw new AccessError(503);
  }
  async function names(table: 'venues' | 'users', key: string, ids: unknown[]) {
    const { data, error } = await admin.from(table).select(`${key},name`).in(key, [...new Set(ids)]);
    check(error);
    return new Map((data as unknown as Record<string, unknown>[]).map(row => [row[key], row.name as string | null]));
  }
  async function present(rows: Row[]): Promise<VenueBookingRequestRecord[]> {
    if (rows.length === 0) return [];
    const venues = await names('venues', 'venue_id', rows.map(row => row.venue_id));
    const people = rows.flatMap(row => [row.requested_by, row.decided_by, row.withdrawn_by]).filter(id => id !== null);
    const users = people.length === 0 ? new Map() : await names('users', 'user_id', people);
    return rows.map(({ requested_by, decided_by, withdrawn_by, ...row }) => ({
      ...row, venue_name: venues.get(row.venue_id) ?? null,
      requester_name: users.get(requested_by) ?? null, decider_name: users.get(decided_by) ?? null,
      withdrawer_name: users.get(withdrawn_by) ?? null
    }));
  }
  return {
    event: eventId => suitability.event(eventId),
    conflicts: (period, options) => occupancy.conflicts(period, options),
    async venue(venueId) {
      return (await suitability.venues(venueId))[0] ?? null;
    },
    async layouts(venueId) {
      const { data, error } = await admin.from('venue_layouts').select('layout').eq('venue_id', venueId);
      check(error);
      return (data as { layout: Layout }[]).map(row => row.layout);
    },
    async duplicate({ event_id, venue_id, starts_at, ends_at }) {
      const { data, error } = await admin.from('venue_booking_requests').select(REQUEST_COLUMNS)
        .eq('event_id', event_id).eq('venue_id', venue_id).in('status', LIVE_STATUSES).not('requested_by', 'is', null)
        .lt('starts_at', ends_at).gt('ends_at', starts_at).order('starts_at').range(0, 0);
      check(error);
      return (await present(data as Row[]))[0] ?? null;
    },
    async create(values) {
      const { data, error } = await admin.from('venue_booking_requests').insert(values).select(REQUEST_COLUMNS).maybeSingle();
      // venue_booking_requests_no_duplicate: the same request made at once.
      if ((error as { code?: string } | null)?.code === '23P01') return null;
      // venue_change_request_check: the booking changed was cancelled or ended.
      if ((error as { code?: string } | null)?.code === '23514') return 'stale';
      check(error || !data);
      return (await present([data as Row]))[0];
    },
    async list(eventId) {
      const { data, error } = await admin.from('venue_booking_requests').select(REQUEST_COLUMNS)
        .eq('event_id', eventId).order('requested_at').order('request_id');
      check(error);
      return present(data as Row[]);
    },
    async request(requestId) {
      const { data, error } = await admin.from('venue_booking_requests').select(REQUEST_COLUMNS).eq('request_id', requestId).maybeSingle();
      check(error);
      return data ? (await present([data as Row]))[0] : null;
    },
    async hold(requestId) {
      const { data, error } = await admin.from('venue_holds').select('hold_id').eq('request_id', requestId).maybeSingle();
      check(error);
      return (data as { hold_id: number } | null)?.hold_id ?? null;
    },
    exceptions: requestId => suitability.exceptions(requestId),
    async venueStatuses(eventId) {
      const result = await fetchEventArrangementFacts(admin, eventId);
      if (!result.ok) throw new AccessError(503);
      return result.facts.venue_requests;
    },
    async affectedBookings(eventId) {
      const { data, error } = await admin.from('venue_bookings').select('booking_id').eq('event_id', eventId).eq('status', 'confirmed');
      check(error);
      const affected = await fetchAffectedBookingIds(admin, ((data ?? []) as { booking_id: number }[]).map(row => Number(row.booking_id)));
      if (!affected.ok) throw new AccessError(503);
      return [...affected.ids].sort((a, b) => a - b);
    },
    async changeableBookings(eventId, now) {
      const { data, error } = await admin.from('venue_bookings').select('booking_id')
        .eq('event_id', eventId).eq('status', 'confirmed').gt('ends_at', now).order('booking_id');
      check(error);
      return (data as { booking_id: number }[]).map(row => Number(row.booking_id));
    }
  };
}
