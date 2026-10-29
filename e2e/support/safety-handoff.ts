import { equipmentNeeded } from '../../server/src/events/arrangementReadiness';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const live = (status: unknown) => !['rejected', 'cancelled'].includes(String(status).toLowerCase());

/** Loopback UI fixture mirroring public.safety_check_arrangements_ready
 * (latest: 202610290001_requested_equipment_outstanding.sql): every venue
 * request the event still needs is approved and backed by a confirmed booking,
 * none pending or rejected, no confirmed booking is disrupted; every live
 * equipment request is placed, has no shortfall and is reserved, and equipment
 * the organiser asked for (SG2-57) has been requested; no recheck is
 * outstanding. */
export function safetyCheckArrangementsReady(database: MemoryDatabase, event: Row): boolean {
  const { venue_booking_requests: venueRequests = [], venue_bookings: bookings = [], venue_booking_disruptions: disruptions = [],
    equipment_requests: equipmentRequests = [], equipment_reservations: reservations = [] } = database.tables as Record<string, Row[]>;
  const eventId = event.event_id;
  const outstanding = Array.isArray(event.outstanding_arrangements) ? event.outstanding_arrangements : [];
  if (event.arrangements_recheck_needed === true && outstanding.length > 0) return false;
  const requests = venueRequests.filter(row => row.event_id === eventId);
  if (!requests.some(row => String(row.status).toLowerCase() !== 'cancelled')) return false;
  if (requests.some(row => ['pending', 'rejected'].includes(String(row.status).toLowerCase()))) return false;
  const confirmed = (bookingId: unknown) => bookings.some(row => row.booking_id === bookingId && row.status === 'confirmed');
  if (requests.some(row => String(row.status).toLowerCase() === 'approved' && !confirmed(row.venue_booking_id))) return false;
  if (disruptions.some(flag => bookings.some(row => row.booking_id === flag.booking_id && row.event_id === eventId && row.status === 'confirmed'))) return false;
  const equipment = equipmentRequests.filter(row => row.event_id === eventId && live(row.status));
  if (equipment.length === 0) return !equipmentNeeded((event.equipment_requirements ?? null) as string | null);
  return !equipment.some(row => row.placement_venue_id === null || row.placement_venue_id === undefined || row.shortfall !== 0
    || !reservations.some(receipt => receipt.request_id === row.request_id));
}

/** Mirrors public.safety_check_refresh on public.events: a change to the
 * event's rechecks or to the equipment it asked for (SG2-57) refreshes it. */
export const SAFETY_REFRESH_EVENT_COLUMNS = ['arrangements_recheck_needed', 'outstanding_arrangements', 'equipment_requirements'] as const;

/** Mirrors public.refresh_safety_check_status, which the database's
 * arrangement triggers call after every venue and equipment write (SG2-91):
 * an approved or planning event whose arrangements are ready moves to
 * Awaiting Safety Check; an awaiting event that stops being ready returns to
 * Planning; an awaiting event that stays ready gets a new revision. Off unless
 * a case turns it on, because the older loopback cases were written before
 * the hand-off existed and assert the statuses they seed. */
export function refreshSafetyCheckStatus(database: MemoryDatabase, eventId: unknown, actorId: string | null | undefined) {
  if (!database.safetyHandoff) return;
  const event = database.tables.events.find(row => row.event_id === eventId);
  if (!event) return;
  const ready = safetyCheckArrangementsReady(database, event);
  const revision = Number(event.safety_check_revision ?? 0);
  let next: string;
  if (['approved', 'planning'].includes(String(event.status)) && ready) next = 'awaiting_safety_check';
  else if (event.status === 'awaiting_safety_check' && !ready) next = 'planning';
  else {
    if (event.status === 'awaiting_safety_check') event.safety_check_revision = revision + 1;
    return;
  }
  const previous = String(event.status);
  Object.assign(event, {
    status: next, safety_check_revision: revision + 1,
    awaiting_safety_check_since: next === 'awaiting_safety_check' ? new Date().toISOString() : null,
  });
  const actor = actorId ?? (event.coordinator_id as string | null);
  if (actor) {
    const logs = database.tables.event_audit_logs;
    logs.push({ log_id: Math.max(0, ...logs.map(row => Number(row.log_id) || 0)) + 1, event_id: eventId, actor_id: actor,
      field_name: 'status', old_value: previous, new_value: next, created_at: new Date().toISOString() });
  }
}
