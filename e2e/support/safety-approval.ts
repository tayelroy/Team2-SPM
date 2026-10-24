import type { MemoryDatabase } from './memory-database';
import { seedSafetyApproval } from './safety-decisions';

/**
 * SG2-94 events, organised by `organiser` and assigned to `coordinator`, each
 * expecting 80 guests in Regression Hall (capacity 100, approved and booked
 * for its own four hours) with 4 wireless microphones reserved and placed,
 * and no registration:
 * - 941 Lantern Forum: awaiting its safety check since 1 Jul 2030, at
 *   revision 1, with no decision yet.
 * - 942 Beacon Forum: in Preparation, approved by the Safety Officer on
 *   3 Jul 2030. Its sample attendance change (to 120) outgrows the hall.
 */
export function seedSafetyApprovalGate(database: MemoryDatabase) {
  const { events, venue_booking_requests: requests, venue_bookings: bookings,
    equipment_requests: equipmentRequests, equipment_reservations: reservations } = database.tables;
  const seeded: [number, string, string, Record<string, unknown>][] = [
    [941, 'Lantern Forum', '2030-08-05T02:00:00.000Z',
      { status: 'awaiting_safety_check', awaiting_safety_check_since: '2030-07-01T01:00:00.000Z' }],
    [942, 'Beacon Forum', '2030-08-06T02:00:00.000Z', { status: 'preparation', awaiting_safety_check_since: null }]
  ];
  for (const [eventId, name, date, extra] of seeded) {
    events.push({ ...events[0], event_id: eventId, name, coordinator_id: 'user-coordinator', organiser_id: 'user-organiser',
      proposed_date: date, expected_attendance: 80, accessibility_needs: 'Step-free access', description: 'A community forum.',
      registration_needed: false, arrangements_recheck_needed: false, outstanding_arrangements: [], planning_notes: null,
      confirmed_by: null, confirmed_at: null, safety_check_revision: 1, ...extra });
    const end = new Date(Date.parse(date) + 4 * 60 * 60 * 1000).toISOString();
    requests.push({ request_id: eventId, event_id: eventId, venue_id: 1, starts_at: date, ends_at: end, layout: 'theatre',
      status: 'approved', venue_requirements: null, notes: null, requested_by: 'user-coordinator',
      requested_at: '2030-06-01T00:00:00.000Z', decided_by: 'user-venue', decided_at: '2030-06-02T00:00:00.000Z',
      decision_reason: null, venue_booking_id: eventId });
    bookings.push({ booking_id: eventId, venue_id: 1, event_id: eventId, starts_at: date, ends_at: end, status: 'confirmed' });
    equipmentRequests.push({ request_id: eventId, event_id: eventId, equipment_id: 1, quantity: 4, notes: null, starts_at: date,
      ends_at: end, status: 'approved', arrangement_notes: null, shortfall: 0, placement_venue_id: 1,
      placement_position: 'Stage left', version: 2 });
    reservations.push({ reservation_id: eventId, request_id: eventId, event_id: eventId, equipment_id: 1, quantity_reserved: 4,
      starts_at: date, ends_at: end, reserved_at: '2030-06-03T00:00:00.000Z' });
  }
  seedSafetyApproval(database, 942, '2030-07-03T01:00:00.000Z');
}
