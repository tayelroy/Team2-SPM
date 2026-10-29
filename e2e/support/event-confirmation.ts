import { AccessError } from '../../server/src/auth/policy';
import type { ConfirmEventResult } from '../../server/src/db/eventConfirmation';
import { fetchEventArrangementFacts } from '../../server/src/db/eventArrangements';
import { computeArrangementReadiness } from '../../server/src/events/arrangementReadiness';
import type { MemoryDatabase } from './memory-database';
import { latestSafetyDecision, seedSafetyApproval } from './safety-decisions';

// SG2-94 AC5: statuses still on their way to the safety check are answered
// with what is outstanding (the check included); later ones are closed.
const CONFIRMABLE = ['approved', 'planning', 'awaiting_safety_check', 'safety_rejected', 'preparation'];

/** Loopback UI fixture mirroring public.confirm_event. The SQL suite and the
 * multi-session concurrency script independently prove the production
 * transaction, its locks, its stored-role check and its single notification. */
export function createMemoryConfirm(database: MemoryDatabase) {
  return async (token: string, eventId: number): Promise<ConfirmEventResult> => {
    const principal = await database.principal(token);
    if (principal.role !== 'event_coordinator') throw new AccessError(403);
    const event = database.tables.events.find(row => row.event_id === eventId);
    if (!event || event.coordinator_id !== principal.userId) return { outcome: 'missing' };
    if (!CONFIRMABLE.includes(String(event.status))) return { outcome: 'closed', status: String(event.status) };
    // The same facts and rules the readiness panel reads (and the SQL gate repeats).
    const facts = await fetchEventArrangementFacts(database.client, eventId);
    if (!facts.ok) throw new AccessError(503);
    const { outstanding } = computeArrangementReadiness({
      event_id: eventId,
      status: String(event.status),
      latest_safety_decision: latestSafetyDecision(database, eventId),
      registration_needed: (event.registration_needed ?? null) as boolean | null,
      registration_capacity: (event.registration_capacity ?? null) as number | null,
      registration_opens_at: (event.registration_opens_at ?? null) as string | null,
      registration_closes_at: (event.registration_closes_at ?? null) as string | null,
      venue_requests: facts.facts.venue_requests,
      affected_bookings: facts.facts.affected_bookings,
      equipment_requests: facts.facts.equipment_requests,
      equipment_requirements: (event.equipment_requirements ?? null) as string | null,
      arrangements_recheck_needed: (event.arrangements_recheck_needed ?? null) as boolean | null,
      outstanding_arrangements: (event.outstanding_arrangements ?? null) as string[] | null
    });
    if (outstanding.length > 0) return { outcome: 'outstanding', outstanding };
    const confirmedAt = new Date().toISOString();
    Object.assign(event, { status: 'confirmed', confirmed_by: principal.userId, confirmed_at: confirmedAt });
    const { event_audit_logs: logs, notifications } = database.tables;
    logs.push({ log_id: Math.max(0, ...logs.map(row => Number(row.log_id))) + 1, event_id: eventId, actor_id: principal.userId,
      field_name: 'status', old_value: 'preparation', new_value: 'confirmed', created_at: confirmedAt });
    notifications.push({ notification_id: Math.max(0, ...notifications.map(row => Number(row.notification_id))) + 1,
      recipient_id: event.organiser_id, event_id: eventId, request_id: null, kind: 'event_confirmed',
      message: `Your event ${String(event.name || 'Untitled event').slice(0, 500)} is confirmed.`, created_at: confirmedAt });
    return { outcome: 'ok', event_id: eventId, status: 'confirmed', confirmed_at: confirmedAt, organiser_notified: true };
  };
}

const START = '2030-06-20T02:00:00.000Z';
const END = '2030-06-20T06:00:00.000Z';

/**
 * SG2-58 events in Preparation, all organised by `organiser`. Each event in
 * Preparation holds the Safety Officer's Approve, its latest decision, since
 * SG2-94 lets no event reach Preparation without one:
 * - 581 Confirmation Forum: two approved venue requests with confirmed bookings,
 *   12 microphones reserved and placed, registration for 120 open from
 *   1 Jan 2026 until 19 Jun 2030 — ready to confirm.
 * - 582 Outstanding Forum: one of two venue requests still pending, microphones
 *   placed but never reserved, registration needed with no capacity (which no
 *   longer blocks confirmation, SG2-94 AC6).
 * - 583 Simple Forum: one approved venue, no equipment, no registration, so
 *   equipment and registration are not required and do not block.
 * - 584 Colleague Forum: ready, but assigned to a second coordinator.
 * - 585 Converted Forum: still in Planning with no venue request, so a journey
 *   can place and convert a tentative hold (which links the booking through
 *   the hold only) before it passes its safety check into Preparation; no
 *   equipment or registration is needed.
 */
export function seedEventConfirmation(database: MemoryDatabase) {
  const { events, users, account_roles: roles, venue_booking_requests: venueRequests, venue_bookings: bookings,
    equipment_requests: equipmentRequests, equipment_reservations: reservations } = database.tables;
  users.push({ user_id: 'user-coordinator2', name: 'Regression second coordinator', organisation: 'Regression Organisation',
    phone: null, communication_preferences: [], department: 'Operations' });
  roles.push({ user_id: 'user-coordinator2', role: 'event_coordinator' });
  const registration = { registration_needed: true, registration_capacity: 120,
    registration_opens_at: '2026-01-01T00:00:00.000Z', registration_closes_at: '2030-06-19T16:00:00.000Z' };
  const rows: [number, string, string, Record<string, unknown>][] = [
    [581, 'Confirmation Forum', 'user-coordinator', registration],
    [582, 'Outstanding Forum', 'user-coordinator', { ...registration, registration_capacity: null }],
    [583, 'Simple Forum', 'user-coordinator', { registration_needed: false, equipment_requirements: null }],
    [584, 'Colleague Forum', 'user-coordinator2', registration],
    [585, 'Converted Forum', 'user-coordinator', { status: 'planning', registration_needed: false, equipment_requirements: null }]
  ];
  for (const [eventId, name, coordinator, extra] of rows) {
    events.push({ ...events[0], event_id: eventId, name, status: 'preparation', coordinator_id: coordinator,
      organiser_id: 'user-organiser', proposed_date: START, expected_attendance: 80, confirmed_by: null, confirmed_at: null, ...extra });
  }
  const venueRequest = { starts_at: START, ends_at: END, layout: 'theatre', venue_requirements: 'A projector', notes: null,
    requested_by: 'user-coordinator', requested_at: '2030-01-01T00:00:00.000Z', decided_by: 'user-venue',
    decided_at: '2030-01-02T00:00:00.000Z', decision_reason: null };
  const approved: [number, number, number][] = [[5811, 581, 1], [5812, 581, 2], [5821, 582, 1], [5831, 583, 1], [5841, 584, 1]];
  for (const [requestId, eventId, venueId] of approved) {
    venueRequests.push({ ...venueRequest, request_id: requestId, event_id: eventId, venue_id: venueId, status: 'approved', venue_booking_id: requestId });
    bookings.push({ booking_id: requestId, venue_id: venueId, event_id: eventId, starts_at: START, ends_at: END, status: 'confirmed' });
  }
  venueRequests.push({ ...venueRequest, request_id: 5822, event_id: 582, venue_id: 2, status: 'pending',
    decided_by: null, decided_at: null, venue_booking_id: null });
  const microphones = { equipment_id: 1, quantity: 12, notes: null, starts_at: START, ends_at: END,
    arrangement_notes: 'Stage left.', shortfall: 0, placement_venue_id: 1, placement_position: 'Stage left' };
  for (const [requestId, eventId, status] of [[5813, 581, 'approved'], [5823, 582, 'pending'], [5843, 584, 'approved']] as const) {
    equipmentRequests.push({ ...microphones, request_id: requestId, event_id: eventId, status, version: 2 });
  }
  for (const [reservationId, requestId, eventId] of [[5813, 5813, 581], [5843, 5843, 584]]) {
    reservations.push({ reservation_id: reservationId, request_id: requestId, event_id: eventId, equipment_id: 1,
      quantity_reserved: 12, starts_at: START, ends_at: END, reserved_at: '2030-01-03T00:00:00.000Z' });
  }
  for (const eventId of [581, 582, 583, 584]) seedSafetyApproval(database, eventId, '2030-01-04T00:00:00.000Z');
}

/** SG2-58/SG2-94: the converted event reaches Preparation the only way the
 * safety_approval_gate allows: it waits for its check, the Safety Officer
 * approves it during that wait, and only then does it move. */
export function prepareConvertedForum(database: MemoryDatabase) {
  const event = database.tables.events.find(row => row.event_id === 585)!;
  Object.assign(event, { status: 'awaiting_safety_check', awaiting_safety_check_since: '2030-01-05T00:00:00.000Z' });
  seedSafetyApproval(database, 585, '2030-01-06T00:00:00.000Z');
  Object.assign(event, { status: 'preparation', awaiting_safety_check_since: null });
}
