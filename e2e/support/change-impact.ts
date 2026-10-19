import type {
  ApplyAcceptedEventChangeInput,
  ApplyAcceptedEventChangeResult,
  SettleArrangementRecheckResult
} from '../../server/src/db/changeImpact';
import { eventLabel, eventNoticeMessages } from '../../server/src/db/eventNotifications';
import { CHANGEABLE_FIELDS, RECHECK_KEYS, RETURNS_TO_PLANNING, type RecheckKey } from '../../server/src/events/changeImpact';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;

function nextId(rows: Row[], key: string) {
  return Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
}

/** Loopback UI fixture mirroring public.apply_accepted_event_change and
 * public.settle_arrangement_recheck over the in-memory tables. The SQL suite
 * (supabase/tests/event_change_impact.sql) proves the production functions,
 * their locking, whitelist and grants. */
export function createMemoryChangeImpact(database: MemoryDatabase) {
  const audit = (eventId: number, actorId: string, field: string, from: unknown, to: unknown) => {
    const logs = database.tables.event_audit_logs;
    logs.push({ log_id: nextId(logs, 'log_id'), event_id: eventId, actor_id: actorId, field_name: field,
      old_value: from === null || from === undefined ? null : String(from), new_value: to === null || to === undefined ? null : String(to),
      created_at: new Date().toISOString() });
  };

  const applyChange = async (_admin: unknown, input: ApplyAcceptedEventChangeInput): Promise<ApplyAcceptedEventChangeResult> => {
    const event = database.tables.events.find(row => row.event_id === input.eventId);
    if (!event || event.status !== input.expectedStatus || event.coordinator_id !== input.actorId) return { outcome: 'stale' };
    const previous = String(event.status);
    for (const field of CHANGEABLE_FIELDS) {
      if (!(field in input.changes)) continue;
      const to = input.changes[field] ?? null;
      if ((event[field] ?? null) !== to) audit(input.eventId, input.actorId, field, event[field], to);
      event[field] = to;
    }
    audit(input.eventId, input.actorId, 'change_request', null, `Accepted ${input.changeReference}`);
    const added = RECHECK_KEYS.filter(key => input.outstanding.includes(key));
    const outstanding = [...((event.outstanding_arrangements ?? []) as RecheckKey[])];
    for (const key of added) if (!outstanding.includes(key)) outstanding.push(key);
    const returned = added.length > 0 && (RETURNS_TO_PLANNING as readonly string[]).includes(previous);
    if (added.length > 0) {
      Object.assign(event, { arrangements_recheck_needed: true, outstanding_arrangements: outstanding });
      if (returned || previous === 'approved') {
        event.status = 'planning';
        audit(input.eventId, input.actorId, 'status', previous, 'planning');
      }
      if (returned) Object.assign(event, { confirmed_by: null, confirmed_at: null });
    }
    if (returned) {
      const label = eventLabel(event.name as string | null);
      const notices = database.tables.notifications;
      const recipients: [unknown, string][] = [[event.organiser_id, eventNoticeMessages.returnedToPlanningOrganiser(label)]];
      if (event.coordinator_id !== event.organiser_id) {
        recipients.push([event.coordinator_id, eventNoticeMessages.returnedToPlanningCoordinator(label)]);
      }
      for (const [recipient, message] of recipients) {
        notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: recipient, event_id: input.eventId,
          request_id: null, kind: 'event_returned_to_planning', message, created_at: new Date().toISOString() });
      }
    }
    return { outcome: 'ok', previous_status: previous, status: String(event.status), returned_to_planning: returned,
      arrangements_recheck_needed: Boolean(event.arrangements_recheck_needed),
      outstanding_arrangements: [...((event.outstanding_arrangements ?? []) as RecheckKey[])] };
  };

  const settleRecheck = async (_admin: unknown, eventId: number, actorId: string, key: RecheckKey): Promise<SettleArrangementRecheckResult> => {
    const event = database.tables.events.find(row => row.event_id === eventId);
    if (!event || event.coordinator_id !== actorId) return { outcome: 'stale' };
    const current = (event.outstanding_arrangements ?? []) as RecheckKey[];
    if (!current.includes(key)) return { outcome: 'not_outstanding' };
    const remaining = current.filter(item => item !== key);
    Object.assign(event, { outstanding_arrangements: remaining, arrangements_recheck_needed: remaining.length > 0 });
    audit(eventId, actorId, 'arrangement_recheck', null, `${key} settled`);
    return { outcome: 'ok', arrangements_recheck_needed: remaining.length > 0, outstanding_arrangements: remaining };
  };

  return { applyChange, settleRecheck };
}

const START = '2030-06-20T02:00:00.000Z';
const END = '2030-06-20T06:00:00.000Z';

/**
 * SG2-66: 661 Harbour Showcase, Confirmed, organised by `organiser` and
 * assigned to `coordinator`. 80 expected guests in Regression Hall (capacity
 * 100, booked through an approved request), 12 wireless microphones reserved
 * for the same period, and registration for 120 with three registrations
 * (one cancelled, which does not count). The sample attendance change raises
 * attendance to 120, above the hall's capacity.
 */
export function seedChangeImpact(database: MemoryDatabase) {
  const { events, venue_booking_requests: venueRequests, venue_bookings: bookings,
    equipment_requests: equipmentRequests, equipment_reservations: reservations, registrations } = database.tables;
  events.push({ ...events[0], event_id: 661, name: 'Harbour Showcase', status: 'confirmed', coordinator_id: 'user-coordinator',
    organiser_id: 'user-organiser', proposed_date: START, expected_attendance: 80, description: 'An evening showcase.',
    registration_needed: true, registration_capacity: 120, registration_opens_at: '2026-01-01T00:00:00.000Z',
    registration_closes_at: '2030-06-19T16:00:00.000Z', arrangements_recheck_needed: false, outstanding_arrangements: [],
    planning_notes: null, confirmed_by: 'user-coordinator', confirmed_at: '2030-01-05T00:00:00.000Z' });
  venueRequests.push({ request_id: 6611, event_id: 661, venue_id: 1, starts_at: START, ends_at: END, status: 'approved',
    layout: 'theatre', venue_requirements: 'A stage', notes: null, requested_by: 'user-coordinator',
    requested_at: '2030-01-01T00:00:00.000Z', decided_by: 'user-venue', decided_at: '2030-01-02T00:00:00.000Z',
    decision_reason: null, venue_booking_id: 6611 });
  bookings.push({ booking_id: 6611, venue_id: 1, event_id: 661, starts_at: START, ends_at: END, status: 'confirmed' });
  equipmentRequests.push({ request_id: 6612, event_id: 661, equipment_id: 1, quantity: 12, notes: null, starts_at: START,
    ends_at: END, status: 'approved', arrangement_notes: 'Stage left.', shortfall: 0, placement_venue_id: 1,
    placement_position: 'Stage left', version: 2 });
  reservations.push({ reservation_id: 6612, request_id: 6612, event_id: 661, equipment_id: 1, quantity_reserved: 12,
    starts_at: START, ends_at: END, reserved_at: '2030-01-03T00:00:00.000Z' });
  registrations.push(
    { registration_id: 6611, event_id: 661, attendee_id: 'user-attendee', status: 'registered' },
    { registration_id: 6612, event_id: 661, attendee_id: 'user-colleague', status: 'registered' },
    { registration_id: 6613, event_id: 661, attendee_id: 'user-organiser2', status: 'cancelled' }
  );
}
