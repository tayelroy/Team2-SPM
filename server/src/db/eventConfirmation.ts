import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';
import type { ArrangementKey } from '../events/arrangementReadiness';

/** What `public.confirm_event` decided (SG2-58). */
export type ConfirmEventResult =
  | { outcome: 'ok'; event_id: number; status: 'confirmed'; confirmed_at: string; organiser_notified: boolean }
  | { outcome: 'missing' }
  | { outcome: 'closed'; status: string }
  | { outcome: 'outstanding'; outstanding: ArrangementKey[] };

const ARRANGEMENT_KEYS: readonly string[] = ['venue', 'equipment', 'registration', 'safety'];

function parseResult(data: unknown): ConfirmEventResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const row = data as Record<string, unknown>;
  switch (row.outcome) {
    case 'ok':
      return Number.isSafeInteger(row.event_id) && row.status === 'confirmed'
        && typeof row.confirmed_at === 'string' && typeof row.organiser_notified === 'boolean'
        ? { outcome: 'ok', event_id: row.event_id as number, status: 'confirmed',
          confirmed_at: row.confirmed_at, organiser_notified: row.organiser_notified }
        : null;
    case 'missing':
      return { outcome: 'missing' };
    case 'closed':
      return typeof row.status === 'string' ? { outcome: 'closed', status: row.status } : null;
    case 'outstanding':
      return Array.isArray(row.outstanding) && row.outstanding.length > 0
        && row.outstanding.every(key => ARRANGEMENT_KEYS.includes(key as string))
        ? { outcome: 'outstanding', outstanding: row.outstanding as ArrangementKey[] }
        : null;
    default:
      return null;
  }
}

/**
 * Confirms an event through `public.confirm_event` with the caller's JWT, so
 * the stored role, the assignment, the status guard, the readiness gate and
 * the status/audit/notification writes all happen in one transaction that
 * holds the event row lock. The server never decides readiness on its own
 * for this write; the SQL gate is authoritative.
 */
export async function confirmEvent(
  token: string,
  eventId: number,
  makeClient: (token: string) => SupabaseClient | null = createUserScopedClient
): Promise<ConfirmEventResult> {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  const { data, error, status } = await client.rpc('confirm_event', { p_event_id: eventId });
  if (error) {
    if (error.code === '42501' || status === 403) throw new AccessError(403);
    if (error.code === '28000' || error.code === 'PGRST301' || status === 401) throw new AccessError(401);
    throw new AccessError(503);
  }
  const result = parseResult(data);
  if (!result) throw new AccessError(503);
  return result;
}

/** The event fields the confirmation view and its relationship check need. */
export interface EventConfirmationRecord {
  event_id: number;
  status: string;
  organiser_id: string;
  coordinator_id: string | null;
  confirmed_at: string | null;
  registration_needed: boolean | null;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
}

export interface ConfirmedVenue { venue_name: string; starts_at: string; ends_at: string }
export interface ConfirmedEquipment { equipment_type: string; quantity_reserved: number }
export interface ConfirmedArrangements { venues: ConfirmedVenue[]; equipment: ConfirmedEquipment[] }

export type FetchEventConfirmationRecordResult =
  | { ok: true; event: EventConfirmationRecord }
  | { ok: false; reason: 'not_found' | 'unavailable' };

export type FetchConfirmedArrangementsResult =
  | { ok: true; arrangements: ConfirmedArrangements }
  | { ok: false; reason: 'unavailable' };

const RECORD_COLUMNS = 'event_id, status, organiser_id, coordinator_id, confirmed_at, registration_needed, '
  + 'registration_capacity, registration_opens_at, registration_closes_at';

/** Service-role read; the route checks the caller's relationship to the row. */
export async function fetchEventConfirmationRecord(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchEventConfirmationRecordResult> {
  const { data, error } = await admin.from('events').select(RECORD_COLUMNS).eq('event_id', eventId).maybeSingle();
  if (error) return { ok: false, reason: 'unavailable' };
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, event: data as unknown as EventConfirmationRecord };
}

/**
 * The confirmed venue bookings and reserved equipment the organiser sees
 * (SG2-58 AC1). Separate reads rather than embeds keep the projection to
 * names and times only. Service role: these tables are not client-readable.
 */
export async function fetchConfirmedArrangements(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchConfirmedArrangementsResult> {
  const bookings = await admin.from('venue_bookings').select('venue_id, starts_at, ends_at')
    .eq('event_id', eventId).eq('status', 'confirmed').order('starts_at', { ascending: true });
  if (bookings.error) return { ok: false, reason: 'unavailable' };
  const bookingRows = (bookings.data ?? []) as { venue_id: number; starts_at: string; ends_at: string }[];

  const reservations = await admin.from('equipment_reservations').select('equipment_id, quantity_reserved')
    .eq('event_id', eventId).order('reservation_id', { ascending: true });
  if (reservations.error) return { ok: false, reason: 'unavailable' };
  const reservationRows = (reservations.data ?? []) as { equipment_id: number; quantity_reserved: number }[];

  const venueNames = new Map<number, string>();
  if (bookingRows.length > 0) {
    const venues = await admin.from('venues').select('venue_id, name')
      .in('venue_id', [...new Set(bookingRows.map(row => row.venue_id))]);
    if (venues.error) return { ok: false, reason: 'unavailable' };
    for (const row of (venues.data ?? []) as { venue_id: number; name: string }[]) venueNames.set(row.venue_id, row.name);
  }

  const equipmentNames = new Map<number, string>();
  if (reservationRows.length > 0) {
    const equipment = await admin.from('equipment').select('equipment_id, name')
      .in('equipment_id', [...new Set(reservationRows.map(row => row.equipment_id))]);
    if (equipment.error) return { ok: false, reason: 'unavailable' };
    for (const row of (equipment.data ?? []) as { equipment_id: number; name: string }[]) equipmentNames.set(row.equipment_id, row.name);
  }

  return {
    ok: true,
    arrangements: {
      venues: bookingRows.map(row => ({
        venue_name: venueNames.get(row.venue_id) ?? 'Venue no longer listed',
        starts_at: row.starts_at,
        ends_at: row.ends_at
      })),
      equipment: reservationRows.map(row => ({
        equipment_type: equipmentNames.get(row.equipment_id) ?? 'Equipment no longer listed',
        quantity_reserved: row.quantity_reserved
      }))
    }
  };
}
