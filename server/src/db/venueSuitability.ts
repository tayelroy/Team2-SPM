import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import type { CapacityExceptionGrant } from '../venues/suitability';

export interface SuitabilityEventRow {
  event_id: number;
  name: string | null;
  organiser_id: string;
  coordinator_id: string | null;
  status: string;
  expected_attendance: number | null;
  venue_requirements: string | null;
  accessibility_needs: string | null;
}

export interface SuitabilityVenueRow {
  venue_id: number;
  name: string;
  location: string | null;
  capacity: number | null;
  facilities: string | null;
  accessibility_features: string | null;
}

export interface BookingRequestRow {
  request_id: number;
  event_id: number;
  venue_id: number;
  starts_at: string;
  ends_at: string;
  status: string;
}

export interface CapacityExceptionRecord extends CapacityExceptionGrant {
  exception_id: number;
  request_id: number;
  approved_by: string;
  approver_name: string | null;
  approver_role: string;
  venue_capacity: number | null;
  approved_at: string;
}

export type NewCapacityException = Pick<CapacityExceptionRecord,
  'request_id' | 'approved_by' | 'approver_role' | 'expected_attendance' | 'venue_capacity'>;

/** Internal joined rows; the API projects only the fields needed to choose
 * an approval. Owner IDs, requirement text and grants never become list fields. */
export interface PendingCapacityRequest extends BookingRequestRow {
  event: SuitabilityEventRow;
  venue: SuitabilityVenueRow;
  exceptions: CapacityExceptionGrant[];
}

export interface VenueSuitabilityStore {
  event(eventId: number): Promise<SuitabilityEventRow | null>;
  /** Every venue in name order, or only the one given. */
  venues(venueId?: number): Promise<SuitabilityVenueRow[]>;
  request(requestId: number): Promise<BookingRequestRow | null>;
  /** Approvals for the request, earliest first, with the approver's name. */
  exceptions(requestId: number): Promise<CapacityExceptionRecord[]>;
  /** Null when the same approval was recorded concurrently by someone else. */
  recordException(values: NewCapacityException): Promise<CapacityExceptionRecord | null>;
  /** Scope an organiser in the database, before any joined rows are returned. */
  pendingCapacityRequests(organiserId?: string): Promise<PendingCapacityRequest[]>;
}

const EVENT_COLUMNS = 'event_id,name,organiser_id,coordinator_id,status,expected_attendance,venue_requirements,accessibility_needs';
const VENUE_COLUMNS = 'venue_id,name,location,capacity,facilities,accessibility_features';
const REQUEST_COLUMNS = 'request_id,event_id,venue_id,starts_at,ends_at,status';
const EXCEPTION_COLUMNS = 'exception_id,request_id,approved_by,approver_role,expected_attendance,venue_capacity,approved_at';
const PENDING_CAPACITY_COLUMNS = `${REQUEST_COLUMNS},event:events!venue_booking_requests_event_id_fkey!inner(${EVENT_COLUMNS}),venue:venues!venue_booking_requests_venue_id_fkey!inner(${VENUE_COLUMNS}),exceptions:venue_capacity_exceptions!venue_capacity_exceptions_request_id_fkey(expected_attendance)`;

type Row = Omit<CapacityExceptionRecord, 'approver_name'>;

/** Reads and writes with the service role: events and booking requests are
 * not readable by coordinators or Venue Staff under RLS, so the routes check
 * the caller's relationship to the event before using this store. */
export function createVenueSuitabilityStore(admin: SupabaseClient): VenueSuitabilityStore {
  function check(error: unknown) {
    if (error) throw new AccessError(503);
  }
  async function withNames(rows: Row[]): Promise<CapacityExceptionRecord[]> {
    if (rows.length === 0) return [];
    const { data, error } = await admin.from('users').select('user_id,name').in('user_id', [...new Set(rows.map(row => row.approved_by))]);
    check(error);
    const names = new Map((data as { user_id: string; name: string | null }[]).map(user => [user.user_id, user.name]));
    return rows.map(row => ({ ...row, approver_name: names.get(row.approved_by) ?? null }));
  }
  return {
    async pendingCapacityRequests(organiserId) {
      const rows: PendingCapacityRequest[] = [];
      let more: boolean;
      do {
        const offset = rows.length;
        let query = admin.from('venue_booking_requests').select(PENDING_CAPACITY_COLUMNS).eq('status', 'pending');
        if (organiserId !== undefined) query = query.eq('event.organiser_id', organiserId);
        const { data, error } = await query.order('request_id').range(offset, offset + 999);
        check(error || !data);
        const page = data as unknown as PendingCapacityRequest[];
        rows.push(...page);
        more = page.length === 1000;
      } while (more);
      return rows;
    },
    async event(eventId) {
      const { data, error } = await admin.from('events').select(EVENT_COLUMNS).eq('event_id', eventId).maybeSingle();
      check(error);
      return data as SuitabilityEventRow | null;
    },
    async venues(venueId) {
      let query = admin.from('venues').select(VENUE_COLUMNS);
      if (venueId !== undefined) query = query.eq('venue_id', venueId);
      const { data, error } = await query.order('name').order('venue_id');
      check(error);
      return data as SuitabilityVenueRow[];
    },
    async request(requestId) {
      const { data, error } = await admin.from('venue_booking_requests').select(REQUEST_COLUMNS).eq('request_id', requestId).maybeSingle();
      check(error);
      return data as BookingRequestRow | null;
    },
    async exceptions(requestId) {
      const { data, error } = await admin.from('venue_capacity_exceptions').select(EXCEPTION_COLUMNS)
        .eq('request_id', requestId).order('approved_at').order('exception_id');
      check(error);
      return withNames(data as Row[]);
    },
    async recordException(values) {
      const { data, error } = await admin.from('venue_capacity_exceptions').insert(values).select(EXCEPTION_COLUMNS).maybeSingle();
      // Unique (request_id, expected_attendance): another approver got there first.
      if ((error as { code?: string } | null)?.code === '23505') return null;
      check(error || !data);
      return (await withNames([data as Row]))[0];
    }
  };
}
