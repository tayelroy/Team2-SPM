import { AccessError } from '../../server/src/auth/policy';
import type { SafetyCheckEvent, SafetyChecksStore } from '../../server/src/db/safetyChecks';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** Loopback UI fixture mirroring public.safety_check_queue. The SQL suite and
 * the multi-session concurrency script independently prove the production
 * read, its stored-role check and the triggers that fill the list. */
export function createMemorySafetyChecksStore(database: MemoryDatabase, token: string): SafetyChecksStore {
  return {
    async list() {
      const principal = await database.principal(token);
      if (principal.role !== 'safety_officer') throw new AccessError(403);
      const { events, venue_booking_requests: requests, venues, venue_operations: operations,
        equipment_requests: equipmentRequests, equipment } = database.tables;
      const venue = (id: unknown) => venues.find(row => row.venue_id === id);
      return events.filter(event => event.status === 'awaiting_safety_check')
        .sort((a, b) => String(a.awaiting_safety_check_since).localeCompare(String(b.awaiting_safety_check_since))
          || Number(a.event_id) - Number(b.event_id))
        .map((event): SafetyCheckEvent => ({
          event_id: Number(event.event_id),
          safety_check_revision: Number(event.safety_check_revision ?? 0),
          name: text(event.name) ?? '',
          organisation: text(event.organisation),
          proposed_date: text(event.proposed_date),
          awaiting_since: text(event.awaiting_safety_check_since),
          expected_attendance: typeof event.expected_attendance === 'number' ? event.expected_attendance : null,
          accessibility_needs: text(event.accessibility_needs),
          expected_crowd_movement: text(event.expected_crowd_movement),
          venues: requests.filter(row => row.event_id === event.event_id && row.status === 'approved')
            .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
            .map((row: Row) => {
              const place = venue(row.venue_id) ?? {};
              const ops = operations.find(item => item.venue_id === row.venue_id) ?? {};
              return {
                request_id: Number(row.request_id), venue_id: Number(row.venue_id), venue_name: text(place.name) ?? 'Venue no longer listed',
                location: text(place.location), capacity: typeof place.capacity === 'number' ? place.capacity : null,
                layout: text(row.layout), starts_at: text(row.starts_at), ends_at: text(row.ends_at),
                accessibility_features: text(place.accessibility_features),
                emergency_access: text(ops.emergency_access), known_restrictions: text(ops.known_restrictions)
              };
            }),
          equipment: equipmentRequests.filter(row => row.event_id === event.event_id && !['rejected', 'cancelled'].includes(String(row.status)))
            .map(row => ({
              request_id: Number(row.request_id),
              equipment_name: text(equipment.find(item => item.equipment_id === row.equipment_id)?.name) ?? 'Equipment no longer listed',
              quantity: Number(row.quantity),
              placement_venue_name: text(venue(row.placement_venue_id)?.name),
              placement_position: text(row.placement_position),
              arrangement_notes: text(row.arrangement_notes)
            }))
        }));
    }
  };
}

const START = '2030-07-10T01:00:00.000Z';
const END = '2030-07-10T09:00:00.000Z';

/**
 * SG2-91 events, coordinated by `coordinator`:
 * - 911 Harbour Lecture: awaiting its safety check since 1 Jul 2030 —
 *   Regression Hall booked in the theatre layout, emergency access and
 *   restrictions recorded, 4 wireless microphones reserved and placed. No
 *   crowd movement recorded yet.
 * - 912 Riverside Gala: still in Planning (its venue request is pending), so
 *   it is not on the list.
 * - 913 Studio Talk: awaiting since 2 Jul 2030 in Quiet Room (capacity 20,
 *   below its 80 attendees) with no recorded operations, and no equipment.
 */
export function seedSafetyChecks(database: MemoryDatabase) {
  const { events, venue_booking_requests: requests, venue_bookings: bookings, venue_operations: operations,
    equipment_requests: equipmentRequests, equipment_reservations: reservations } = database.tables;
  const rows: [number, string, string, string | null, number][] = [
    [911, 'Harbour Lecture', 'awaiting_safety_check', '2030-07-01T01:00:00.000Z', 1],
    [912, 'Riverside Gala', 'planning', null, 1],
    [913, 'Studio Talk', 'awaiting_safety_check', '2030-07-02T01:00:00.000Z', 2],
  ];
  for (const [eventId, name, status, since, venueId] of rows) {
    events.push({ ...events[0], event_id: eventId, name, status, coordinator_id: 'user-coordinator', organiser_id: 'user-organiser',
      proposed_date: START, expected_attendance: 80, accessibility_needs: eventId === 911 ? 'Wheelchair seating near the aisle' : null,
      expected_crowd_movement: null, awaiting_safety_check_since: since, safety_check_revision: 1 });
    const decided = status === 'awaiting_safety_check';
    requests.push({ request_id: eventId, event_id: eventId, venue_id: venueId, starts_at: START, ends_at: END, layout: 'theatre',
      status: decided ? 'approved' : 'pending', venue_requirements: null, notes: null, requested_by: 'user-coordinator',
      requested_at: '2030-06-01T00:00:00.000Z', decided_by: decided ? 'user-venue' : null,
      decided_at: decided ? '2030-06-02T00:00:00.000Z' : null, decision_reason: null, venue_booking_id: decided ? eventId : null });
    if (decided) bookings.push({ booking_id: eventId, venue_id: venueId, event_id: eventId, starts_at: START, ends_at: END, status: 'confirmed' });
  }
  operations.push({ venue_id: 1, setup_minutes: 0, turnaround_minutes: 0, emergency_access: 'Two exits onto the north concourse',
    known_restrictions: 'No open flames', updated_at: '2030-06-01T00:00:00.000Z' });
  equipmentRequests.push({ request_id: 911, event_id: 911, equipment_id: 1, quantity: 4, notes: null, status: 'approved',
    starts_at: START, ends_at: END, arrangement_notes: 'Cable ramps across the aisle', shortfall: 0, placement_venue_id: 1,
    placement_position: 'Either side of the stage', version: 2 });
  reservations.push({ reservation_id: 911, request_id: 911, event_id: 911, equipment_id: 1, quantity_reserved: 4,
    starts_at: START, ends_at: END, reserved_at: '2030-06-03T00:00:00.000Z' });
}
