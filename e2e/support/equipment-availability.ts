import { AccessError } from '../../server/src/auth/policy';
import type { AvailabilityPeriod, EquipmentAvailabilityStore } from '../../server/src/db/equipmentAvailability';
import type { MemoryDatabase } from './memory-database';

/** Loopback browser fixture only; the SQL suite proves the actual snapshot,
 * reservation interval calculation, role guard and read-only database seam. */
export function createMemoryAvailabilityStore(database: MemoryDatabase, token: string): EquipmentAvailabilityStore {
  const bookingsPeriod = (eventId: number): AvailabilityPeriod | undefined => {
    const rows = database.tables.venue_bookings.filter(row => row.event_id === eventId && row.status === 'confirmed');
    if (!rows.length) return undefined;
    return {
      starts_at: new Date(Math.min(...rows.map(row => Date.parse(String(row.starts_at))))).toISOString(),
      ends_at: new Date(Math.max(...rows.map(row => Date.parse(String(row.ends_at))))).toISOString(),
    };
  };
  return {
    async run(eventId, requestId, chosen) {
      if ((await database.principal(token)).role !== 'technical_support_staff') throw new AccessError(403);
      const event = database.tables.events.find(row => row.event_id === eventId);
      const request = database.tables.equipment_requests.find(row => row.request_id === requestId && row.event_id === eventId);
      if (!event || !request) return { outcome: 'missing' };
      const equipment = database.tables.equipment.find(row => row.equipment_id === request.equipment_id)!;
      const explicit = request.starts_at && request.ends_at
        ? { starts_at: String(request.starts_at), ends_at: String(request.ends_at) } : undefined;
      const period = chosen ?? explicit ?? bookingsPeriod(eventId);
      if (!period) return { outcome: 'dates_required', proposed_start: event.proposed_date as string | null };
      const start = Date.parse(period.starts_at), end = Date.parse(period.ends_at);
      const deltas = new Map<number, number>();
      let undated = 0;
      for (const reservation of database.tables.equipment_reservations) {
        if (reservation.equipment_id !== request.equipment_id || reservation.event_id === eventId) continue;
        const other = database.tables.events.find(row => row.event_id === reservation.event_id)!;
        if (['completed', 'cancelled', 'rejected'].includes(String(other.status))) continue;
        const quantity = Math.max(Number(reservation.quantity_reserved), 0);
        if (!quantity) continue;
        const reservedPeriod = reservation.starts_at && reservation.ends_at
          ? { starts_at: String(reservation.starts_at), ends_at: String(reservation.ends_at) }
          : bookingsPeriod(Number(reservation.event_id));
        const left = reservedPeriod ? Math.max(start, Date.parse(reservedPeriod.starts_at)) : start;
        const right = reservedPeriod ? Math.min(end, Date.parse(reservedPeriod.ends_at)) : end;
        if (left >= right) continue;
        if (!reservedPeriod) undated++;
        deltas.set(left, (deltas.get(left) ?? 0) + quantity);
        deltas.set(right, (deltas.get(right) ?? 0) - quantity);
      }
      let current = 0, peak = 0;
      for (const [, delta] of [...deltas].sort(([left], [right]) => left - right)) {
        current += delta; peak = Math.max(peak, current);
      }
      const held = Number(equipment.quantity_total);
      const remaining = Math.max((equipment.operational_status === 'operational' ? held : 0) - peak, 0);
      return {
        outcome: 'ok', event_id: eventId, request_id: requestId, equipment_id: Number(equipment.equipment_id),
        equipment_type: String(equipment.name), quantity_requested: Number(request.quantity), quantity_held: held,
        operational_status: equipment.operational_status as 'operational' | 'damaged' | 'maintenance',
        quantity_committed: peak, quantity_remaining: remaining, shortfall: Math.max(Number(request.quantity) - remaining, 0),
        undated_commitments: undated, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(),
        period_source: chosen ? 'chosen' : explicit ? 'request' : 'event_bookings', checked_at: new Date().toISOString(),
      };
    },
  };
}
