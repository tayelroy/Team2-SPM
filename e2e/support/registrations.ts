import type {
  FetchRegistrationOverviewResult,
  UpdateRegistrationSettingsInput,
  UpdateRegistrationSettingsResult
} from '../../server/src/db/registrations';
import { eventLabel } from '../../server/src/db/eventNotifications';
import { accounts, type MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;

function nextId(rows: Row[], key: string) {
  return Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
}

const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : null);
const iso = (value: unknown) => (typeof value === 'string' ? new Date(value).toISOString() : null);

/** Loopback UI fixture mirroring public.event_registration_overview,
 * public.update_registration_settings and public.announce_registration_window
 * over the in-memory tables. The SQL suite
 * (supabase/tests/event_registration_settings.sql) proves the production
 * functions, their locking, validation, wording, schedule and grants. */
export function createMemoryRegistrations(database: MemoryDatabase) {
  const fetchOverview = async (_admin: unknown, eventId: number): Promise<FetchRegistrationOverviewResult> => {
    const event = database.tables.events.find(row => row.event_id === eventId);
    if (!event) return { ok: false, reason: 'not_found' };
    const users = database.tables.users;
    const attendees = database.tables.registrations
      .filter(row => row.event_id === eventId && String(row.status ?? '').toLowerCase() !== 'cancelled')
      .sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at)))
      .map(row => {
        const user = users.find(candidate => candidate.user_id === row.attendee_id)!;
        const account = accounts.find(candidate => `user-${candidate.key}` === row.attendee_id);
        return { registration_id: Number(row.registration_id), name: String(user.name), organisation: (user.organisation as string | null) ?? null,
          email: account?.email ?? null,
          // SG2-60: the phone given at registration, else the profile phone, and the needs given.
          phone: (row.contact_phone as string | null | undefined) ?? (user.phone as string | null) ?? null,
          needs: (row.needs as string | null | undefined) ?? null, registered_at: String(row.registered_at) };
      });
    const venueIds = new Set(database.tables.venue_booking_requests
      .filter(row => row.event_id === eventId && ['pending', 'approved'].includes(String(row.status))).map(row => row.venue_id));
    const venues = database.tables.venues.filter(row => venueIds.has(row.venue_id))
      .map(row => ({ venue_id: Number(row.venue_id), name: String(row.name), capacity: (row.capacity as number | null) ?? null }));
    return { ok: true, overview: { event: {
      event_id: eventId, name: (event.name as string | null) ?? null, status: String(event.status),
      organisation: (event.organisation as string | null) ?? null, organiser_id: (event.organiser_id as string | null) ?? null,
      coordinator_id: (event.coordinator_id as string | null) ?? null, proposed_date: iso(event.proposed_date),
      registration_needed: (event.registration_needed as boolean | null) ?? null,
      registration_capacity: (event.registration_capacity as number | null) ?? null,
      registration_opens_at: iso(event.registration_opens_at), registration_closes_at: iso(event.registration_closes_at)
    }, attendees, venues } };
  };

  const announce = (event: Row, closedEarly: boolean) => {
    const now = Date.now();
    const opens = time(event.registration_opens_at);
    const closes = time(event.registration_closes_at);
    const state = event.status !== 'confirmed' || event.registration_needed !== true || opens === null || closes === null || now < opens
      ? null : now >= closes ? 'closed' : 'open';
    if (state === (event.registration_announced ?? null)) return;
    event.registration_announced = state;
    if (!state) return;
    const label = eventLabel(event.name as string | null);
    const message = state === 'open' ? `Registration for ${label} is now open.`
      : closedEarly ? `Registration for ${label} was closed early by the organiser.` : `Registration for ${label} has closed.`;
    const recipients = [event.organiser_id, event.coordinator_id]
      .filter((recipient, index, all) => recipient && all.indexOf(recipient) === index);
    for (const recipient of recipients) {
      const notices = database.tables.notifications;
      notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: recipient, event_id: event.event_id,
        request_id: null, kind: state === 'open' ? 'registration_opened' : 'registration_closed', message, created_at: new Date(now).toISOString() });
    }
  };

  const updateSettings = async (_admin: unknown, input: UpdateRegistrationSettingsInput): Promise<UpdateRegistrationSettingsResult> => {
    const actor = database.tables.users.find(row => row.user_id === input.actorId);
    const role = database.tables.account_roles.find(row => row.user_id === input.actorId)?.role;
    const event = database.tables.events.find(row => row.event_id === input.eventId);
    if (!actor?.organisation || role !== 'event_organiser' || !event || event.organiser_id !== input.actorId
      || event.organisation !== actor.organisation) return { outcome: 'missing' };
    if (['completed', 'cancelled', 'rejected'].includes(String(event.status))) return { outcome: 'closed', status: String(event.status) };
    if (event.registration_needed !== true) return { outcome: 'not_needed' };
    const now = Date.now();
    if (time(event.proposed_date) !== null && now >= time(event.proposed_date)!) return { outcome: 'started' };
    const next = {
      registration_capacity: (event.registration_capacity as number | null) ?? null,
      registration_opens_at: iso(event.registration_opens_at),
      registration_closes_at: iso(event.registration_closes_at)
    };
    if (input.closeNow) {
      const opens = time(next.registration_opens_at);
      const closes = time(next.registration_closes_at);
      if (event.status !== 'confirmed' || opens === null || closes === null || now < opens || now >= closes) return { outcome: 'not_open' };
      next.registration_closes_at = new Date(now).toISOString();
    } else {
      if (event.status === 'confirmed' && Object.values(input.values).some(value => value === null)) return { outcome: 'invalid' };
      Object.assign(next, input.values);
      const registered = database.tables.registrations.filter(row => row.event_id === input.eventId
        && String(row.status ?? '').toLowerCase() !== 'cancelled').length;
      if (next.registration_capacity !== null && next.registration_capacity < registered) return { outcome: 'below_registered', registered };
    }
    const logs = database.tables.event_audit_logs;
    for (const field of ['registration_capacity', 'registration_opens_at', 'registration_closes_at'] as const) {
      const before = field === 'registration_capacity' ? event[field] ?? null : iso(event[field]);
      if (String(before) === String(next[field])) continue;
      logs.push({ log_id: nextId(logs, 'log_id'), event_id: input.eventId, actor_id: input.actorId, field_name: field,
        old_value: before === null ? null : String(before), new_value: next[field] === null ? null : String(next[field]),
        created_at: new Date(now).toISOString() });
    }
    Object.assign(event, next);
    announce(event, input.closeNow);
    return { outcome: 'ok' };
  };

  return { fetchOverview, updateSettings };
}

/**
 * SG2-63: Harbour Lecture (631), confirmed for 20 July 2030, organised by
 * `organiser` in Regression Organisation and assigned to `coordinator`, with
 * Regression Hall (capacity 100) booked. Registration opened on 1 October 2026
 * (already announced) and closes on 19 July 2030, with a capacity of 80. Two
 * people are registered, `attendee` and a guest with no phone, and a third
 * has withdrawn (cancelled).
 */
export function seedRegistrations(database: MemoryDatabase) {
  const { events, users, registrations, venue_booking_requests: requests } = database.tables;
  events.push({ ...events[0], event_id: 631, name: 'Harbour Lecture', status: 'confirmed', organiser_id: 'user-organiser',
    coordinator_id: 'user-coordinator', proposed_date: '2030-07-20T02:00:00.000Z', expected_attendance: 80,
    registration_needed: true, registration_capacity: 80, registration_opens_at: '2026-10-01T00:00:00.000Z',
    registration_closes_at: '2030-07-19T02:00:00.000Z', registration_announced: 'open',
    arrangements_recheck_needed: false, outstanding_arrangements: [], planning_notes: null });
  users.push({ user_id: 'user-guest', name: 'Guest Attendee', organisation: null, phone: null,
    communication_preferences: [], department: null });
  registrations.push(
    { registration_id: 1, event_id: 631, attendee_id: 'user-attendee', status: 'registered', registered_at: '2030-06-01T01:00:00.000Z' },
    { registration_id: 2, event_id: 631, attendee_id: 'user-guest', status: 'registered', registered_at: '2030-06-02T01:00:00.000Z' },
    { registration_id: 3, event_id: 631, attendee_id: 'user-support', status: 'cancelled', registered_at: '2030-06-03T01:00:00.000Z' }
  );
  requests.push({ request_id: 631, event_id: 631, venue_id: 1, starts_at: '2030-07-20T02:00:00.000Z',
    ends_at: '2030-07-20T06:00:00.000Z', layout: 'theatre', status: 'approved', venue_requirements: null, notes: null,
    requested_by: 'user-coordinator', requested_at: '2030-06-01T00:00:00.000Z', decided_by: 'user-venue',
    decided_at: '2030-06-02T00:00:00.000Z', decision_reason: null, venue_booking_id: null });
}
