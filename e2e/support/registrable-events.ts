import { AccessError } from '../../server/src/auth/policy';
import type { RegisterResult, RegistrableEvent, RegistrableEventsStore } from '../../server/src/db/registrableEvents';
import { formatInstant } from '../../server/src/events/changeImpact';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : null);

/** Loopback UI fixture mirroring public.registrable_events,
 * public.registrable_event and (SG2-60) public.register_for_event. The SQL
 * suites (supabase/tests/registrable_events.sql, event_registration.sql and
 * test-registration-concurrency.mjs) prove the production functions, their
 * acting-role check, locking, which events are listed and that only
 * attendee-facing fields leave the database. */
export function createMemoryRegistrableEventsStore(database: MemoryDatabase, token: string): RegistrableEventsStore {
  const { tables } = database;
  async function requireAttendee() {
    const principal = await database.principal(token);
    if (principal.role !== 'attendee') throw new AccessError(403);
    return principal.userId;
  }
  const active = (row: Row) => String(row.status ?? '').toLowerCase() !== 'cancelled';
  const listed = (event: Row) => {
    const now = Date.now();
    const closes = time(event.registration_closes_at);
    const starts = time(event.proposed_date);
    return event.status === 'confirmed' && event.registration_needed === true
      && time(event.registration_opens_at) !== null && closes !== null && now < closes && starts !== null && starts > now;
  };
  const confirmedVenues = (event: Row) => {
    const venueIds = new Set(tables.venue_bookings
      .filter(row => row.event_id === event.event_id && row.status === 'confirmed').map(row => row.venue_id));
    return tables.venues.filter(venue => venueIds.has(venue.venue_id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  };
  const shape = (event: Row, userId: string): RegistrableEvent => {
    return {
      event_id: Number(event.event_id), name: text(event.name) ?? '', organisation: text(event.organisation),
      category: text(event.category), description: text(event.description), proposed_date: text(event.proposed_date),
      registration_opens_at: text(event.registration_opens_at), registration_closes_at: text(event.registration_closes_at),
      venues: confirmedVenues(event).map(venue => ({ name: String(venue.name), location: text(venue.location) })),
      registered: tables.registrations.some(row => row.event_id === event.event_id && row.attendee_id === userId && active(row))
    };
  };
  const all = () => tables.events.filter(listed)
    .sort((a, b) => String(a.proposed_date).localeCompare(String(b.proposed_date)) || Number(a.event_id) - Number(b.event_id));
  return {
    async list() {
      const userId = await requireAttendee();
      return all().map(event => shape(event, userId));
    },
    async get(eventId) {
      const userId = await requireAttendee();
      const event = all().find(row => row.event_id === eventId);
      return event ? shape(event, userId) : null;
    },
    // SG2-60: the same checks in the same order as register_for_event().
    async register(eventId, input): Promise<RegisterResult> {
      const userId = await requireAttendee();
      const phone = input.contact_phone.trim();
      const needs = input.needs?.trim() || null;
      if (!phone || phone.length > 40 || !/^(?:\+65)?[0-9]{8}$/.test(phone.replace(/[()\-.\s]/g, '')) || (needs?.length ?? 0) > 500) {
        return { outcome: 'invalid' };
      }
      const event = tables.events.find(row => row.event_id === eventId);
      const opens = time(event?.registration_opens_at); const closes = time(event?.registration_closes_at);
      const starts = time(event?.proposed_date);
      if (!event || event.status !== 'confirmed' || event.registration_needed !== true || opens === null || closes === null || starts === null) {
        return { outcome: 'missing' };
      }
      const held = tables.registrations.filter(row => row.event_id === eventId && active(row));
      if (held.some(row => row.attendee_id === userId)) return { outcome: 'duplicate' };
      const now = Date.now();
      if (now >= closes || now >= starts) return { outcome: 'closed', registration_closes_at: String(event.registration_closes_at) };
      if (now < opens) return { outcome: 'not_open', registration_opens_at: String(event.registration_opens_at) };
      if (typeof event.registration_capacity === 'number' && held.length >= event.registration_capacity) return { outcome: 'full' };

      const registered_at = new Date(now).toISOString();
      const registration_id = Math.max(0, ...tables.registrations.map(row => Number(row.registration_id))) + 1;
      tables.registrations.push({ registration_id, event_id: eventId, attendee_id: userId, status: 'registered',
        registered_at, contact_phone: phone, needs });
      const venues = confirmedVenues(event).map(venue => String(venue.name)).join(', ');
      tables.notifications.push({ notification_id: Math.max(0, ...tables.notifications.map(row => Number(row.notification_id))) + 1,
        recipient_id: userId, event_id: eventId, request_id: null, kind: 'registration_confirmed',
        message: `You are registered for ${text(event.name) || 'Untitled event'} on ${formatInstant(String(event.proposed_date))}`
          + `${venues ? ` at ${venues}` : ''}.`,
        created_at: registered_at, read_at: null });
      return { outcome: 'ok', registration: { registration_id, event_id: eventId, registered_at, contact_phone: phone, needs } };
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

/**
 * SG2-60, on top of seedRegistrableEvents: 596 Small Recital, confirmed,
 * registration open with a capacity of 1 that a guest already holds (the
 * attendee's own cancelled registration gives no place back), at Regression
 * Hall on 10 Aug 2030 19:00 SGT. The attendee's profile phone is set so the
 * form fills it in.
 */
export function seedEventRegistration(database: MemoryDatabase) {
  const { events, users, registrations, venue_bookings: bookings } = database.tables;
  const base = events.find(row => row.event_id === 591)!;
  events.push({ ...base, event_id: 596, name: 'Small Recital', category: 'performance', organisation: 'Harbour Foundation',
    description: 'A short piano recital.', registration_capacity: 1, proposed_date: '2030-08-10T11:00:00.000Z',
    registration_closes_at: '2030-08-09T02:00:00.000Z', planning_notes: null });
  bookings.push({ booking_id: 596, venue_id: 1, event_id: 596, starts_at: '2030-08-10T10:00:00.000Z',
    ends_at: '2030-08-10T14:00:00.000Z', status: 'confirmed' });
  if (!users.some(row => row.user_id === 'user-guest-60')) {
    users.push({ user_id: 'user-guest-60', name: 'Recital Guest', organisation: null, phone: null,
      communication_preferences: [], department: null });
  }
  registrations.push(
    { registration_id: 6001, event_id: 596, attendee_id: 'user-guest-60', status: 'registered', registered_at: '2026-10-02T01:00:00.000Z' },
    { registration_id: 6002, event_id: 596, attendee_id: 'user-attendee', status: 'cancelled', registered_at: '2026-10-01T01:00:00.000Z' });
  const attendee = users.find(row => row.user_id === 'user-attendee');
  if (attendee) attendee.phone = '+65 9123 4567';
}
