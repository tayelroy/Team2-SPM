import { AccessError } from '../../server/src/auth/policy';
import type { EquipmentReservationsStore } from '../../server/src/db/equipmentReservations';
import type { MemoryDatabase } from './memory-database';
import { createMemoryRequirementsStore } from './equipment-requirements';
import { refreshSafetyCheckStatus } from './safety-handoff';

/** Loopback UI fixture only. Native SQL and multi-session tests independently
 * prove the production transaction, peak calculation, locks and recipient RLS. */
export function createMemoryReservationsStore(database: MemoryDatabase, token: string): EquipmentReservationsStore {
  return {
    async run(action, eventId, requestId, version, period) {
      const principal = await database.principal(token);
      if (action === 'reserve' && principal.role !== 'technical_support_staff') throw new AccessError(403);
      const access = await createMemoryRequirementsStore(database, token).run('read', eventId);
      if (access.outcome !== 'ok') return { outcome: 'missing' };
      const event = database.tables.events.find(row => row.event_id === eventId)!;
      const canReserve = principal.role === 'technical_support_staff' && Boolean(event.coordinator_id)
        && ['approved', 'planning', 'confirmed'].includes(String(event.status));
      if (action === 'reserve') {
        if (!canReserve) return { outcome: 'closed' };
        const request = database.tables.equipment_requests.find(row => row.request_id === requestId && row.event_id === eventId);
        if (!request) return { outcome: 'missing' };
        if (database.tables.equipment_reservations.some(row => row.request_id === requestId)) return { outcome: 'conflict' };
        if (request.status !== 'pending') return { outcome: 'closed' };
        if (request.version !== version) return { outcome: 'conflict' };
        if (!period) return { outcome: 'invalid' };
        const start = Date.parse(period.starts_at), end = Date.parse(period.ends_at);
        const equipment = database.tables.equipment.find(row => row.equipment_id === request.equipment_id)!;
        const deltas = new Map<number, number>();
        for (const row of database.tables.equipment_reservations) {
          if (row.equipment_id !== request.equipment_id) continue;
          const other = database.tables.events.find(item => item.event_id === row.event_id)!;
          if (['completed', 'cancelled', 'rejected'].includes(String(other.status))) continue;
          const bookings = database.tables.venue_bookings.filter(item => item.event_id === row.event_id && item.status === 'confirmed');
          const from = row.starts_at ? Date.parse(String(row.starts_at)) : bookings.length ? Math.min(...bookings.map(item => Date.parse(String(item.starts_at)))) : start;
          const until = row.ends_at ? Date.parse(String(row.ends_at)) : bookings.length ? Math.max(...bookings.map(item => Date.parse(String(item.ends_at)))) : end;
          const left = Math.max(start, from), right = Math.min(end, until), quantity = Math.max(Number(row.quantity_reserved), 0);
          if (left >= right || !quantity) continue;
          deltas.set(left, (deltas.get(left) ?? 0) + quantity);
          deltas.set(right, (deltas.get(right) ?? 0) - quantity);
        }
        let active = 0, peak = 0;
        for (const [, delta] of [...deltas].sort(([a], [b]) => a - b)) { active += delta; peak = Math.max(peak, active); }
        if (equipment.operational_status !== 'operational' || Number(request.quantity) > Number(equipment.quantity_total) - peak) return { outcome: 'insufficient' };
        const reservedAt = new Date().toISOString();
        const reservationId = Math.max(0, ...database.tables.equipment_reservations.map(row => Number(row.reservation_id))) + 1;
        database.tables.equipment_reservations.push({ reservation_id: reservationId, request_id: requestId, event_id: eventId,
          equipment_id: request.equipment_id, quantity_reserved: request.quantity, ...period, reserved_at: reservedAt });
        Object.assign(request, { status: 'approved', shortfall: 0, version: Number(version) + 1 });
        refreshSafetyCheckStatus(database, eventId, principal.userId);
        database.tables.notifications.push({ notification_id: Math.max(0, ...database.tables.notifications.map(row => Number(row.notification_id))) + 1,
          recipient_id: event.coordinator_id, event_id: eventId, request_id: null, equipment_reservation_id: reservationId,
          kind: 'equipment_reserved', message: `Equipment reserved for ${String(event.name || 'Untitled event').slice(0, 500)}: ${request.quantity} × ${equipment.name}.`, created_at: reservedAt });
      }
      return { outcome: 'ok', can_reserve: canReserve,
        ...(action === 'reserve' ? { coordinator_notified: true } : {}),
        reservations: database.tables.equipment_reservations.filter(row => row.event_id === eventId).map(row => ({
          reservation_id: Number(row.reservation_id), event_id: eventId, request_id: row.request_id == null ? null : Number(row.request_id),
          equipment_id: Number(row.equipment_id), equipment_type: String(database.tables.equipment.find(item => item.equipment_id === row.equipment_id)!.name),
          quantity_reserved: Number(row.quantity_reserved), starts_at: row.starts_at == null ? null : String(row.starts_at),
          ends_at: row.ends_at == null ? null : String(row.ends_at), reserved_at: row.reserved_at == null ? null : String(row.reserved_at),
        })),
      };
    },
  };
}

export function seedEquipmentReservations(database: MemoryDatabase, missingDates = false) {
  const base = database.tables.events[0], start = '2030-06-20T02:00:00.000Z', end = '2030-06-20T06:00:00.000Z';
  for (const [eventId, name] of [[55, 'Equipment Reservation Forum'], [551, 'Overlapping Equipment Forum']] as const) {
    database.tables.events.push({ ...base, event_id: eventId, name, coordinator_id: 'user-coordinator', status: 'approved', proposed_date: start, equipment_requirements: 'Wireless microphones' });
    if (!missingDates) database.tables.venue_bookings.push({ booking_id: eventId, venue_id: 1, event_id: eventId, starts_at: start, ends_at: end, status: 'confirmed' });
  }
  for (const [requestId, eventId, quantity] of [[551, 55, 12], [552, 551, 10]]) {
    database.tables.equipment_requests.push({ request_id: requestId, event_id: eventId, equipment_id: 1, quantity, notes: null,
      status: 'pending', starts_at: null, ends_at: null, arrangement_notes: null, shortfall: null,
      placement_venue_id: null, placement_position: null, version: 1 });
  }
}
