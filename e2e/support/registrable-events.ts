import { AccessError } from '../../server/src/auth/policy';
import type {
  JoinWaitingListResult,
  RegisterResult,
  RegistrableEvent,
  RegistrableEventsStore,
  WaitingStanding
} from '../../server/src/db/registrableEvents';
import { formatInstant } from '../../server/src/events/changeImpact';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : null);

const sgt = (iso: string) => formatInstant(iso);
const nextNotice = (database: MemoryDatabase) => Math.max(0, ...database.tables.notifications.map(row => Number(row.notification_id))) + 1;
const activeRegistration = (row: Row) => String(row.status ?? '').toLowerCase() !== 'cancelled';
const onList = (row: Row) => row.status === 'waiting' || row.status === 'offered';

/** private.places_held: active registrations and offers still running, but `except`'s own offer. */
export function placesHeld(database: MemoryDatabase, eventId: unknown, except: string | null) {
  const now = Date.now();
  return database.tables.registrations.filter(row => row.event_id === eventId && activeRegistration(row)).length
    + database.tables.waiting_list_entries.filter(row => row.event_id === eventId && row.status === 'offered'
      && (time(row.offer_expires_at) ?? 0) > now && row.attendee_id !== except).length;
}

/** private.offer_waiting_places (SG2-62 AC6): lapse offers that ran out, then offer each free place in turn. */
export function offerWaitingPlaces(database: MemoryDatabase, event: Row) {
  const now = Date.now();
  const label = (text(event.name) || 'Untitled event').slice(0, 200);
  const closes = time(event.registration_closes_at); const starts = time(event.proposed_date); const opens = time(event.registration_opens_at);
  const open = event.status === 'confirmed' && event.registration_needed === true && opens !== null && closes !== null && starts !== null
    && now >= opens && now < closes && now < starts;
  const entries = database.tables.waiting_list_entries.filter(row => row.event_id === event.event_id);
  for (const entry of entries.filter(row => row.status === 'offered')) {
    const expires = time(entry.offer_expires_at)!;
    if (now < expires && open) continue;
    Object.assign(entry, { status: 'lapsed', ended_at: new Date(now).toISOString() });
    if (now >= expires) {
      database.tables.notifications.push({ notification_id: nextNotice(database), recipient_id: entry.attendee_id, event_id: event.event_id,
        request_id: null, kind: 'waiting_list_offer_lapsed', created_at: new Date(now).toISOString(), read_at: null,
        message: `The place held for you at ${label} was not taken by ${sgt(String(entry.offer_expires_at))}, so it was released.` });
    }
  }
  if (!open) return;
  for (const entry of entries.filter(row => row.status === 'waiting')
    .sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)) || Number(a.entry_id) - Number(b.entry_id))) {
    if (typeof event.registration_capacity === 'number' && placesHeld(database, event.event_id, null) >= event.registration_capacity) return;
    const hours = typeof event.waiting_list_response_hours === 'number' ? event.waiting_list_response_hours : 24;
    const expires = new Date(Math.min(now + hours * 3_600_000, closes!, starts!)).toISOString();
    Object.assign(entry, { status: 'offered', offered_at: new Date(now).toISOString(), offer_expires_at: expires });
    database.tables.notifications.push({ notification_id: nextNotice(database), recipient_id: entry.attendee_id, event_id: event.event_id,
      request_id: null, kind: 'waiting_list_offer', created_at: new Date(now).toISOString(), read_at: null,
      message: `A place has opened at ${label}. It is held for you until ${sgt(expires)}: register from Find events to take it.` });
  }
}

/** Loopback UI fixture mirroring public.registrable_events,
 * public.registrable_event and (SG2-60) public.register_for_event. The SQL
 * suites (supabase/tests/registrable_events.sql, event_registration.sql and
 * test-registration-concurrency.mjs) prove the production functions, their
 * acting-role check, locking, which events are listed and that only
 * attendee-facing fields leave the database. SG2-61: also the waiting list
 * (join_waiting_list, leave_waiting_list), proven by waiting_list.sql. */
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
  const standing = (eventId: unknown, userId: string): WaitingStanding | null => {
    const entry = tables.waiting_list_entries.find(row => row.event_id === eventId && row.attendee_id === userId && onList(row));
    if (!entry) return null;
    if (entry.status === 'offered') {
      return (time(entry.offer_expires_at) ?? 0) > Date.now()
        ? { status: 'offered', offer_expires_at: String(entry.offer_expires_at), joined_at: String(entry.joined_at) } : null;
    }
    const position = tables.waiting_list_entries.filter(row => row.event_id === eventId && row.status === 'waiting'
      && (String(row.joined_at) < String(entry.joined_at) || (row.joined_at === entry.joined_at && Number(row.entry_id) <= Number(entry.entry_id)))).length;
    return { status: 'waiting', position, joined_at: String(entry.joined_at) };
  };
  const shape = (event: Row, userId: string): RegistrableEvent => {
    return {
      event_id: Number(event.event_id), name: text(event.name) ?? '', organisation: text(event.organisation),
      category: text(event.category), description: text(event.description), proposed_date: text(event.proposed_date),
      registration_opens_at: text(event.registration_opens_at), registration_closes_at: text(event.registration_closes_at),
      venues: confirmedVenues(event).map(venue => ({ name: String(venue.name), location: text(venue.location) })),
      registered: tables.registrations.some(row => row.event_id === event.event_id && row.attendee_id === userId && active(row)),
      full: typeof event.registration_capacity === 'number' && placesHeld(database, event.event_id, userId) >= event.registration_capacity,
      waiting: standing(event.event_id, userId)
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
      offerWaitingPlaces(database, event);
      if (typeof event.registration_capacity === 'number' && placesHeld(database, eventId, userId) >= event.registration_capacity) return { outcome: 'full' };

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
      for (const entry of tables.waiting_list_entries.filter(row => row.event_id === eventId && row.attendee_id === userId && onList(row))) {
        Object.assign(entry, { status: 'registered', ended_at: registered_at });
      }
      // SG2-61 AC3: this registration took the last place.
      if (typeof event.registration_capacity === 'number' && held.length + 1 === event.registration_capacity) {
        for (const recipient of new Set([event.organiser_id, event.coordinator_id].filter(Boolean))) {
          tables.notifications.push({ notification_id: nextNotice(database), recipient_id: recipient, event_id: eventId, request_id: null,
            kind: 'registration_full', created_at: registered_at, read_at: null,
            message: `${(text(event.name) || 'Untitled event').slice(0, 200)} is now full: all places are taken (capacity ${event.registration_capacity}).` });
        }
      }
      return { outcome: 'ok', registration: { registration_id, event_id: eventId, registered_at, contact_phone: phone, needs } };
    },
    // SG2-61: the same checks in the same order as join_waiting_list().
    async joinWaitingList(eventId): Promise<JoinWaitingListResult> {
      const userId = await requireAttendee();
      const event = tables.events.find(row => row.event_id === eventId);
      const opens = time(event?.registration_opens_at); const closes = time(event?.registration_closes_at);
      const starts = time(event?.proposed_date);
      if (!event || event.status !== 'confirmed' || event.registration_needed !== true || opens === null || closes === null || starts === null) {
        return { outcome: 'missing' };
      }
      if (tables.registrations.some(row => row.event_id === eventId && row.attendee_id === userId && active(row))) return { outcome: 'registered' };
      const now = Date.now();
      if (now >= closes || now >= starts) return { outcome: 'closed', registration_closes_at: String(event.registration_closes_at) };
      if (now < opens) return { outcome: 'not_open', registration_opens_at: String(event.registration_opens_at) };
      offerWaitingPlaces(database, event);
      const already = standing(eventId, userId);
      if (already) return { outcome: 'already', waiting: already };
      if (typeof event.registration_capacity !== 'number' || placesHeld(database, eventId, null) < event.registration_capacity) {
        return { outcome: 'not_full' };
      }
      const entries = tables.waiting_list_entries;
      entries.push({ entry_id: Math.max(0, ...entries.map(row => Number(row.entry_id))) + 1, event_id: eventId, attendee_id: userId,
        status: 'waiting', joined_at: new Date(now).toISOString(), offered_at: null, offer_expires_at: null, ended_at: null });
      return { outcome: 'ok', waiting: standing(eventId, userId)! };
    },
    async leaveWaitingList(eventId) {
      const userId = await requireAttendee();
      const entry = tables.waiting_list_entries.find(row => row.event_id === eventId && row.attendee_id === userId && onList(row));
      if (!entry) return { outcome: 'missing' };
      const offered = entry.status === 'offered';
      Object.assign(entry, { status: 'left', ended_at: new Date().toISOString() });
      const event = tables.events.find(row => row.event_id === eventId);
      if (offered && event) offerWaitingPlaces(database, event);
      return { outcome: 'ok' };
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

/**
 * SG2-61: 611 Chamber Concert, confirmed for 10 Sep 2030 19:00 SGT at
 * Regression Hall, created by `organiser` in Regression Organisation and
 * coordinated by `coordinator`. Registration is open with a capacity of 1,
 * which a guest holds, so it is full. Offers are held for 24 hours.
 */
export function seedWaitingList(database: MemoryDatabase) {
  const { events, users, registrations, venue_bookings: bookings } = database.tables;
  events.push({ ...events[0], event_id: 611, name: 'Chamber Concert', status: 'confirmed', organiser_id: 'user-organiser',
    coordinator_id: 'user-coordinator', category: 'performance', description: 'A string trio in the atrium.',
    proposed_date: '2030-09-10T11:00:00.000Z', registration_needed: true, registration_capacity: 1, waiting_list_response_hours: 24,
    registration_opens_at: '2026-10-01T00:00:00.000Z', registration_closes_at: '2030-09-09T02:00:00.000Z', registration_announced: 'open',
    arrangements_recheck_needed: false, outstanding_arrangements: [], planning_notes: null });
  bookings.push({ booking_id: 611, venue_id: 1, event_id: 611, starts_at: '2030-09-10T10:00:00.000Z',
    ends_at: '2030-09-10T14:00:00.000Z', status: 'confirmed' });
  users.push({ user_id: 'user-guest-61', name: 'Concert Guest', organisation: null, phone: null, communication_preferences: [], department: null });
  registrations.push({ registration_id: 6101, event_id: 611, attendee_id: 'user-guest-61', status: 'registered',
    registered_at: '2026-10-02T01:00:00.000Z', contact_phone: '91234567', needs: null });
}

