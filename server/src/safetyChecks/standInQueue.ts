import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * STAND-IN for SG2-91 (Lim Dao Jun): "See events awaiting an operational
 * safety check". SG2-91 owns the Safety Officer's list, the review details it
 * shows and the automatic move into Awaiting Safety Check; none of that has
 * shipped yet. Until it does, SG2-92 lists the events that are already
 * `awaiting_safety_check` with the review details available today, so the
 * Safety Officer can record a decision. Nothing here moves an event into the
 * queue. SG2-91 replaces this by passing its own `SafetyCheckQueue` to
 * `createSafetyCheckHandlers` (server/src/events/safetyChecks.ts).
 */
export interface SafetyCheckVenue {
  name: string;
  capacity: number | null;
  starts_at: string;
  ends_at: string;
}

export interface SafetyCheckEquipment {
  name: string;
  quantity: number;
  placement_position: string | null;
}

export interface SafetyCheckEvent {
  event_id: number;
  name: string | null;
  proposed_date: string | null;
  expected_attendance: number | null;
  accessibility_needs: string | null;
  coordinator_name: string | null;
  venues: SafetyCheckVenue[];
  equipment: SafetyCheckEquipment[];
}

export type ListSafetyChecksResult = { ok: true; events: SafetyCheckEvent[] } | { ok: false };

export interface SafetyCheckQueue {
  list(admin: SupabaseClient): Promise<ListSafetyChecksResult>;
}

interface EventRow {
  event_id: number;
  name: string | null;
  proposed_date: string | null;
  expected_attendance: number | null;
  accessibility_needs: string | null;
  coordinator_id: string | null;
}

interface BookingRow { event_id: number; venue_id: number; starts_at: string; ends_at: string }
interface EquipmentRequestRow { event_id: number; equipment_id: number; quantity: number; status: string; placement_position: string | null }

/** Rows from `table` whose `key` is one of `ids`, by `key` (an empty list reads nothing). */
async function byIds<T>(admin: SupabaseClient, table: string, columns: string, key: string, ids: (number | string)[]) {
  if (ids.length === 0) return { ok: true as const, rows: [] as T[] };
  const { data, error } = await admin.from(table).select(columns).in(key, ids);
  return error ? { ok: false as const } : { ok: true as const, rows: (data ?? []) as T[] };
}

export const standInSafetyCheckQueue: SafetyCheckQueue = {
  async list(admin) {
    const events = await admin.from('events')
      .select('event_id, name, proposed_date, expected_attendance, accessibility_needs, coordinator_id')
      .eq('status', 'awaiting_safety_check')
      .order('proposed_date', { ascending: true })
      .order('event_id', { ascending: true });
    if (events.error) return { ok: false };
    const eventRows = (events.data ?? []) as EventRow[];
    const eventIds = eventRows.map(row => row.event_id);

    const bookings = await byIds<BookingRow & { status: string }>(admin, 'venue_bookings',
      'event_id, venue_id, starts_at, ends_at, status', 'event_id', eventIds);
    const requests = await byIds<EquipmentRequestRow>(admin, 'equipment_requests',
      'event_id, equipment_id, quantity, status, placement_position', 'event_id', eventIds);
    if (!bookings.ok || !requests.ok) return { ok: false };
    const confirmed = bookings.rows.filter(row => row.status === 'confirmed');
    const live = requests.rows.filter(row => !['rejected', 'cancelled'].includes(row.status.toLowerCase()));

    const venues = await byIds<{ venue_id: number; name: string; capacity: number | null }>(admin, 'venues',
      'venue_id, name, capacity', 'venue_id', [...new Set(confirmed.map(row => row.venue_id))]);
    const equipment = await byIds<{ equipment_id: number; name: string }>(admin, 'equipment',
      'equipment_id, name', 'equipment_id', [...new Set(live.map(row => row.equipment_id))]);
    const coordinators = await byIds<{ user_id: string; name: string }>(admin, 'users', 'user_id, name', 'user_id',
      [...new Set(eventRows.flatMap(row => (row.coordinator_id ? [row.coordinator_id] : [])))]);
    if (!venues.ok || !equipment.ok || !coordinators.ok) return { ok: false };

    const venueById = new Map(venues.rows.map(row => [Number(row.venue_id), row]));
    const equipmentName = new Map(equipment.rows.map(row => [Number(row.equipment_id), row.name]));
    const coordinatorName = new Map(coordinators.rows.map(row => [row.user_id, row.name]));
    return {
      ok: true,
      events: eventRows.map(event => ({
        event_id: event.event_id,
        name: event.name,
        proposed_date: event.proposed_date,
        expected_attendance: event.expected_attendance,
        accessibility_needs: event.accessibility_needs,
        coordinator_name: event.coordinator_id ? coordinatorName.get(event.coordinator_id) ?? null : null,
        venues: confirmed.filter(row => row.event_id === event.event_id).map(row => ({
          name: venueById.get(Number(row.venue_id))?.name ?? 'Unknown venue',
          capacity: venueById.get(Number(row.venue_id))?.capacity ?? null,
          starts_at: row.starts_at,
          ends_at: row.ends_at
        })),
        equipment: live.filter(row => row.event_id === event.event_id).map(row => ({
          name: equipmentName.get(Number(row.equipment_id)) ?? 'Unknown equipment',
          quantity: row.quantity,
          placement_position: row.placement_position
        }))
      }))
    };
  }
};
