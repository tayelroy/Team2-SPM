import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventPlanningRecord } from './eventPlanning';
import {
  isRecheckKey,
  type ChangeImpactFacts,
  type ChangeableField,
  type EquipmentArrangementFact,
  type RecheckKey,
  type VenueArrangementFact
} from '../events/changeImpact';

/** The planning record plus the descriptive fields a change request may change (SG2-66). */
export interface ChangeImpactEventRecord extends EventPlanningRecord {
  name: string | null;
  purpose: string | null;
  description: string | null;
}

export type FetchChangeImpactEventResult =
  | { ok: true; event: ChangeImpactEventRecord }
  | { ok: false; reason: 'not_found' | 'unavailable' };

export type FetchChangeImpactFactsResult =
  | { ok: true; facts: ChangeImpactFacts }
  | { ok: false; reason: 'unavailable' };

const EVENT_COLUMNS = 'event_id, status, coordinator_id, organiser_id, name, purpose, description, '
  + 'expected_attendance, proposed_date, venue_requirements, accessibility_needs, equipment_requirements, '
  + 'registration_needed, registration_capacity, registration_opens_at, registration_closes_at, planning_notes, '
  + 'expected_crowd_movement, arrangements_recheck_needed, outstanding_arrangements';

/** Service-role read; the route checks the caller is the assigned coordinator. */
export async function fetchChangeImpactEvent(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchChangeImpactEventResult> {
  const { data, error } = await admin.from('events').select(EVENT_COLUMNS).eq('event_id', eventId).maybeSingle();
  if (error) return { ok: false, reason: 'unavailable' };
  if (!data) return { ok: false, reason: 'not_found' };
  const row = data as unknown as ChangeImpactEventRecord;
  return {
    ok: true,
    event: { ...row, outstanding_arrangements: Array.isArray(row.outstanding_arrangements) ? row.outstanding_arrangements : [] }
  };
}

interface BookingRow { booking_id: number; venue_id: number; starts_at: string; ends_at: string }
interface VenueRequestRow {
  request_id: number; venue_id: number; starts_at: string; ends_at: string; status: string; venue_booking_id: number | null;
}
interface HoldRow { request_id: number | null; booking_id: number | null }
interface ReservationRow {
  reservation_id: number; equipment_id: number; quantity_reserved: number;
  starts_at: string | null; ends_at: string | null; request_id: number | null;
}
interface EquipmentRequestRow {
  request_id: number; equipment_id: number; quantity: number; starts_at: string | null; ends_at: string | null; status: string;
}

/**
 * The arrangements a change to the event could affect (SG2-66 AC1–AC3), read
 * with the service role (none of these tables are client-readable):
 * - confirmed venue bookings with their venue's name and capacity, and the
 *   highest attendance a Venue Staff capacity exception on the venue request
 *   behind each booking covers (linked as in eventArrangements.ts: the
 *   request's venue_booking_id or the converted hold's booking_id);
 * - pending venue requests, which have no booking yet, likewise;
 * - every equipment reservation, and live (not rejected or cancelled)
 *   equipment requests that are not reserved yet, with the equipment's name;
 * - how many registrations the event holds, cancelled ones excluded.
 * Only exceptions recorded by Venue Staff count (AC5).
 */
export async function fetchChangeImpactFacts(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchChangeImpactFactsResult> {
  const unavailable = { ok: false, reason: 'unavailable' } as const;
  const bookings = await admin.from('venue_bookings').select('booking_id, venue_id, starts_at, ends_at')
    .eq('event_id', eventId).eq('status', 'confirmed').order('booking_id', { ascending: true });
  if (bookings.error) return unavailable;
  const requests = await admin.from('venue_booking_requests')
    .select('request_id, venue_id, starts_at, ends_at, status, venue_booking_id')
    .eq('event_id', eventId).order('request_id', { ascending: true });
  if (requests.error) return unavailable;
  const holds = await admin.from('venue_holds').select('request_id, booking_id').eq('event_id', eventId);
  if (holds.error) return unavailable;
  const reservations = await admin.from('equipment_reservations')
    .select('reservation_id, equipment_id, quantity_reserved, starts_at, ends_at, request_id')
    .eq('event_id', eventId).order('reservation_id', { ascending: true });
  if (reservations.error) return unavailable;
  const equipmentRequests = await admin.from('equipment_requests')
    .select('request_id, equipment_id, quantity, starts_at, ends_at, status')
    .eq('event_id', eventId).order('request_id', { ascending: true });
  if (equipmentRequests.error) return unavailable;
  const registrations = await admin.from('registrations').select('status').eq('event_id', eventId);
  if (registrations.error) return unavailable;

  const bookingRows = (bookings.data ?? []) as BookingRow[];
  const requestRows = (requests.data ?? []) as VenueRequestRow[];
  const pendingRows = requestRows.filter(row => row.status.toLowerCase() === 'pending');
  const reservationRows = (reservations.data ?? []) as ReservationRow[];
  const reservedRequests = new Set(reservationRows.flatMap(row => (row.request_id === null ? [] : [Number(row.request_id)])));
  const liveRequestRows = ((equipmentRequests.data ?? []) as EquipmentRequestRow[]).filter(row =>
    !['rejected', 'cancelled'].includes(row.status.toLowerCase()) && !reservedRequests.has(Number(row.request_id)));

  // Which venue requests stand behind each confirmed booking.
  const bookingRequests = new Map<number, number[]>();
  const link = (bookingId: number | null, requestId: number | null) => {
    if (bookingId === null || requestId === null) return;
    const key = Number(bookingId);
    bookingRequests.set(key, [...(bookingRequests.get(key) ?? []), Number(requestId)]);
  };
  for (const row of requestRows) link(row.venue_booking_id, row.request_id);
  for (const row of (holds.data ?? []) as HoldRow[]) link(row.booking_id, row.request_id);

  const venues = new Map<number, { name: string; capacity: number | null }>();
  const venueIds = [...new Set([...bookingRows, ...pendingRows].map(row => Number(row.venue_id)))];
  if (venueIds.length > 0) {
    const venueRows = await admin.from('venues').select('venue_id, name, capacity').in('venue_id', venueIds);
    if (venueRows.error) return unavailable;
    for (const row of (venueRows.data ?? []) as { venue_id: number; name: string; capacity: number | null }[]) {
      venues.set(Number(row.venue_id), { name: row.name, capacity: row.capacity });
    }
  }

  const exceptions = new Map<number, number>();
  const exceptionRequestIds = [...new Set([
    ...[...bookingRequests.values()].flat(),
    ...pendingRows.map(row => Number(row.request_id))
  ])];
  if (exceptionRequestIds.length > 0) {
    const exceptionRows = await admin.from('venue_capacity_exceptions').select('request_id, expected_attendance')
      .in('request_id', exceptionRequestIds).eq('approver_role', 'venue_staff');
    if (exceptionRows.error) return unavailable;
    for (const row of (exceptionRows.data ?? []) as { request_id: number; expected_attendance: number }[]) {
      const key = Number(row.request_id);
      exceptions.set(key, Math.max(exceptions.get(key) ?? 0, row.expected_attendance));
    }
  }
  const exceptionFor = (requestIds: number[]) => {
    const covered = requestIds.flatMap(id => (exceptions.has(id) ? [exceptions.get(id)!] : []));
    return covered.length > 0 ? Math.max(...covered) : null;
  };
  const venueFact = (kind: VenueArrangementFact['kind'], id: number, row: BookingRow | VenueRequestRow,
    requestIds: number[]): VenueArrangementFact => {
    const venue = venues.get(Number(row.venue_id));
    return { kind, id: Number(id), venue_name: venue?.name ?? 'Venue no longer listed', capacity: venue?.capacity ?? null,
      starts_at: row.starts_at, ends_at: row.ends_at, exception_attendance: exceptionFor(requestIds) };
  };

  const equipmentNames = new Map<number, string>();
  const equipmentIds = [...new Set([...reservationRows, ...liveRequestRows].map(row => Number(row.equipment_id)))];
  if (equipmentIds.length > 0) {
    const equipmentRows = await admin.from('equipment').select('equipment_id, name').in('equipment_id', equipmentIds);
    if (equipmentRows.error) return unavailable;
    for (const row of (equipmentRows.data ?? []) as { equipment_id: number; name: string }[]) {
      equipmentNames.set(Number(row.equipment_id), row.name);
    }
  }
  const equipmentName = (equipmentId: number) => equipmentNames.get(Number(equipmentId)) ?? 'Equipment no longer listed';

  const equipment: EquipmentArrangementFact[] = [
    ...reservationRows.map(row => ({ kind: 'equipment_reservation' as const, id: Number(row.reservation_id),
      equipment_name: equipmentName(row.equipment_id), quantity: row.quantity_reserved,
      starts_at: row.starts_at, ends_at: row.ends_at })),
    ...liveRequestRows.map(row => ({ kind: 'equipment_request' as const, id: Number(row.request_id),
      equipment_name: equipmentName(row.equipment_id), quantity: row.quantity,
      starts_at: row.starts_at, ends_at: row.ends_at }))
  ];

  return {
    ok: true,
    facts: {
      venues: [
        ...bookingRows.map(row => venueFact('venue_booking', row.booking_id, row, bookingRequests.get(Number(row.booking_id)) ?? [])),
        ...pendingRows.map(row => venueFact('venue_request', row.request_id, row, [Number(row.request_id)]))
      ],
      equipment,
      registrations: ((registrations.data ?? []) as { status: string | null }[])
        .filter(row => (row.status ?? '').toLowerCase() !== 'cancelled').length
    }
  };
}

/** What `public.apply_accepted_event_change` did (SG2-66 AC4/AC7). */
export type ApplyAcceptedEventChangeResult =
  | {
    outcome: 'ok';
    previous_status: string;
    status: string;
    returned_to_planning: boolean;
    arrangements_recheck_needed: boolean;
    outstanding_arrangements: RecheckKey[];
  }
  | { outcome: 'stale' }
  | { outcome: 'unavailable' };

/** What `public.settle_arrangement_recheck` did (SG2-66 AC4). */
export type SettleArrangementRecheckResult =
  | { outcome: 'ok'; arrangements_recheck_needed: boolean; outstanding_arrangements: RecheckKey[] }
  | { outcome: 'not_outstanding' }
  | { outcome: 'stale' }
  | { outcome: 'unavailable' };

export interface ApplyAcceptedEventChangeInput {
  eventId: number;
  actorId: string;
  expectedStatus: string;
  changeReference: string;
  changes: Partial<Record<ChangeableField, string | number | null>>;
  outstanding: RecheckKey[];
}

function recheckKeys(value: unknown): RecheckKey[] | null {
  return Array.isArray(value) && value.every(key => typeof key === 'string' && isRecheckKey(key))
    ? value as RecheckKey[]
    : null;
}

/**
 * Applies an accepted change through `public.apply_accepted_event_change`
 * (service role): the field writes, their history, the recheck flags, the
 * return to Planning and its notices are one transaction under the event
 * row lock. The function refuses (stale) when the status or the assignment
 * changed after the server read them.
 */
export async function applyAcceptedEventChange(
  admin: SupabaseClient,
  input: ApplyAcceptedEventChangeInput
): Promise<ApplyAcceptedEventChangeResult> {
  const { data, error } = await admin.rpc('apply_accepted_event_change', {
    p_event_id: input.eventId,
    p_actor_id: input.actorId,
    p_expected_status: input.expectedStatus,
    p_change_reference: input.changeReference,
    p_changes: input.changes,
    p_outstanding: input.outstanding
  });
  if (error || typeof data !== 'object' || data === null) return { outcome: 'unavailable' };
  const row = data as Record<string, unknown>;
  if (row.outcome === 'stale') return { outcome: 'stale' };
  const outstanding = recheckKeys(row.outstanding_arrangements);
  if (row.outcome !== 'ok' || typeof row.previous_status !== 'string' || typeof row.status !== 'string'
    || typeof row.returned_to_planning !== 'boolean' || typeof row.arrangements_recheck_needed !== 'boolean'
    || outstanding === null) {
    return { outcome: 'unavailable' };
  }
  return { outcome: 'ok', previous_status: row.previous_status, status: row.status,
    returned_to_planning: row.returned_to_planning, arrangements_recheck_needed: row.arrangements_recheck_needed,
    outstanding_arrangements: outstanding };
}

/** Marks one outstanding recheck settled through `public.settle_arrangement_recheck`. */
export async function settleArrangementRecheck(
  admin: SupabaseClient,
  eventId: number,
  actorId: string,
  key: RecheckKey
): Promise<SettleArrangementRecheckResult> {
  const { data, error } = await admin.rpc('settle_arrangement_recheck', {
    p_event_id: eventId,
    p_actor_id: actorId,
    p_key: key
  });
  if (error || typeof data !== 'object' || data === null) return { outcome: 'unavailable' };
  const row = data as Record<string, unknown>;
  if (row.outcome === 'stale' || row.outcome === 'not_outstanding') return { outcome: row.outcome };
  const outstanding = recheckKeys(row.outstanding_arrangements);
  if (row.outcome !== 'ok' || typeof row.arrangements_recheck_needed !== 'boolean' || outstanding === null) {
    return { outcome: 'unavailable' };
  }
  return { outcome: 'ok', arrangements_recheck_needed: row.arrangements_recheck_needed, outstanding_arrangements: outstanding };
}
