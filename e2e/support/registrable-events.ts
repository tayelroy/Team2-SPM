import { AccessError } from '../../server/src/auth/policy';
import type { RegistrableEvent, RegistrableEventsStore } from '../../server/src/db/registrableEvents';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : null);

/** Loopback UI fixture mirroring public.registrable_events and
 * public.registrable_event. The SQL suite (supabase/tests/registrable_events.sql)
 * proves the production reads, their acting-role check, which events are
 * listed and that only attendee-facing fields leave the database. */
export function createMemoryRegistrableEventsStore(database: MemoryDatabase, token: string): RegistrableEventsStore {
  const { tables } = database;
  async function requireAttendee() {
    if ((await database.principal(token)).role !== 'attendee') throw new AccessError(403);
  }
  const listed = (event: Row) => {
    const now = Date.now();
    const closes = time(event.registration_closes_at);
    const starts = time(event.proposed_date);
    return event.status === 'confirmed' && event.registration_needed === true
      && time(event.registration_opens_at) !== null && closes !== null && now < closes && starts !== null && starts > now;
  };
  const shape = (event: Row): RegistrableEvent => {
    const venueIds = new Set(tables.venue_bookings
      .filter(row => row.event_id === event.event_id && row.status === 'confirmed').map(row => row.venue_id));
    return {
      event_id: Number(event.event_id), name: text(event.name) ?? '', organisation: text(event.organisation),
      category: text(event.category), description: text(event.description), proposed_date: text(event.proposed_date),
      registration_opens_at: text(event.registration_opens_at), registration_closes_at: text(event.registration_closes_at),
      venues: tables.venues.filter(venue => venueIds.has(venue.venue_id))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map(venue => ({ name: String(venue.name), location: text(venue.location) }))
    };
  };
  const all = () => tables.events.filter(listed)
    .sort((a, b) => String(a.proposed_date).localeCompare(String(b.proposed_date)) || Number(a.event_id) - Number(b.event_id));
  return {
    async list() {
      await requireAttendee();
      return all().map(shape);
    },
    async get(eventId) {
      await requireAttendee();
      const event = all().find(row => row.event_id === eventId);
      return event ? shape(event) : null;
    }
  };
}

/**
 * SG2-59 events an attendee may or may not find:
 * - 591 Harbour Lecture: confirmed, registration open until 19 Jul 2030, 20 Jul 2030,
 *   booked at Regression Hall, with planning notes an attendee must never see.
 * - 592 Bayfront Workshop: confirmed, registration opens 1 Jun 2030, 30 Jun 2030, no venue booked yet.
 * - 593 Closed Briefing: confirmed, registration closed in 2020. Not listed.
 * - 594 Planning Forum: planning, inside its window. Not listed.
 * - 595 Walk-in Social: confirmed, no registration. Not listed.
 */
export function seedRegistrableEvents(database: MemoryDatabase) {
  const { events, venue_bookings: bookings } = database.tables;
  const base = { ...events[0], organiser_id: 'user-organiser', coordinator_id: 'user-coordinator', status: 'confirmed',
    registration_needed: true, registration_capacity: 80, arrangements_recheck_needed: false, outstanding_arrangements: [] };
  events.push(
    { ...base, event_id: 591, name: 'Harbour Lecture', category: 'seminar', organisation: 'Harbour Foundation',
      description: 'An evening lecture on the harbour’s history, with questions after.',
      purpose: 'Grow the foundation’s donor list', planning_notes: 'Brief security on the VIP entrance',
      expected_attendance: 80, proposed_date: '2030-07-20T11:00:00.000Z',
      registration_opens_at: '2026-10-01T00:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z' },
    { ...base, event_id: 592, name: 'Bayfront Workshop', category: 'workshop', organisation: 'Bayfront Council',
      description: 'Hands-on sessions for community volunteers.', proposed_date: '2030-06-30T01:00:00.000Z',
      registration_opens_at: '2030-06-01T00:00:00.000Z', registration_closes_at: '2030-06-25T00:00:00.000Z' },
    { ...base, event_id: 593, name: 'Closed Briefing', proposed_date: '2030-08-01T02:00:00.000Z',
      registration_opens_at: '2020-01-01T00:00:00.000Z', registration_closes_at: '2020-02-01T00:00:00.000Z' },
    { ...base, event_id: 594, name: 'Planning Forum', status: 'planning', proposed_date: '2030-08-02T02:00:00.000Z',
      registration_opens_at: '2026-10-01T00:00:00.000Z', registration_closes_at: '2030-08-01T00:00:00.000Z' },
    { ...base, event_id: 595, name: 'Walk-in Social', registration_needed: false, proposed_date: '2030-08-03T02:00:00.000Z',
      registration_opens_at: '2026-10-01T00:00:00.000Z', registration_closes_at: '2030-08-02T00:00:00.000Z' }
  );
  bookings.push({ booking_id: 591, venue_id: 1, event_id: 591, starts_at: '2030-07-20T10:00:00.000Z',
    ends_at: '2030-07-20T14:00:00.000Z', status: 'confirmed' });
}
