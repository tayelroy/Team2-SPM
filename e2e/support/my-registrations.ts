import { AccessError } from '../../server/src/auth/policy';
import type { MyRegistration, MyRegistrationsStore, RegistrationStanding, WithdrawResult } from '../../server/src/db/myRegistrations';
import type { MemoryDatabase } from './memory-database';
import { offerWaitingPlaces } from './registrable-events';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const time = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : null);
const cancelled = (row: Row) => String(row.status ?? '').toLowerCase() === 'cancelled';

/** Loopback UI fixture mirroring public.my_registrations and
 * public.withdraw_registration (SG2-62). The SQL suites
 * (supabase/tests/registration_withdrawal.sql and
 * test-registration-concurrency.mjs) prove the production functions, their
 * acting-role check, the event-row lock and the notices. */
export function createMemoryMyRegistrationsStore(database: MemoryDatabase, token: string): MyRegistrationsStore {
  const { tables } = database;
  async function requireAttendee() {
    const principal = await database.principal(token);
    if (principal.role !== 'attendee') throw new AccessError(403);
    return principal.userId;
  }
  const standing = (registration: Row, event: Row, now: number): RegistrationStanding => {
    const starts = time(event.proposed_date);
    if (cancelled(registration)) return 'withdrawn';
    if (event.status === 'cancelled') return 'event_cancelled';
    if (event.status === 'completed') return 'event_completed';
    if (starts !== null && now >= starts) return 'event_started';
    return 'registered';
  };
  const venues = (eventId: unknown) => {
    const venueIds = new Set(tables.venue_bookings.filter(row => row.event_id === eventId && row.status === 'confirmed').map(row => row.venue_id));
    return tables.venues.filter(venue => venueIds.has(venue.venue_id)).sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(venue => ({ name: String(venue.name), location: text(venue.location) }));
  };
  return {
    async list() {
      const userId = await requireAttendee();
      const now = Date.now();
      return tables.registrations.filter(row => row.attendee_id === userId).flatMap((row): MyRegistration[] => {
        const event = tables.events.find(candidate => candidate.event_id === row.event_id);
        if (!event) return [];
        const where = standing(row, event, now);
        return [{
          registration_id: Number(row.registration_id), event_id: Number(row.event_id), standing: where, can_withdraw: where === 'registered',
          registered_at: text(row.registered_at), withdrawn_at: text(row.withdrawn_at), contact_phone: text(row.contact_phone), needs: text(row.needs),
          event: { name: text(event.name) ?? '', organisation: text(event.organisation), category: text(event.category),
            description: text(event.description), proposed_date: text(event.proposed_date),
            registration_closes_at: text(event.registration_closes_at), venues: venues(event.event_id) }
        }];
      }).sort((a, b) => Number(b.standing === 'registered') - Number(a.standing === 'registered')
        || String(a.event.proposed_date).localeCompare(String(b.event.proposed_date)) || a.registration_id - b.registration_id);
    },
    // The same checks in the same order as withdraw_registration().
    async withdraw(registrationId): Promise<WithdrawResult> {
      const userId = await requireAttendee();
      const registration = tables.registrations.find(row => row.registration_id === registrationId && row.attendee_id === userId);
      const event = registration && tables.events.find(row => row.event_id === registration.event_id);
      if (!registration || !event) return { outcome: 'missing' };
      const now = Date.now();
      const starts = time(event.proposed_date);
      if (cancelled(registration)) return { outcome: 'withdrawn' };
      if (event.status === 'cancelled') return { outcome: 'cancelled' };
      if (event.status === 'completed' || (starts !== null && now >= starts)) return { outcome: 'started', proposed_date: text(event.proposed_date) };

      const withdrawn_at = new Date(now).toISOString();
      Object.assign(registration, { status: 'cancelled', withdrawn_at });
      const capacity = typeof event.registration_capacity === 'number' ? event.registration_capacity : null;
      const remaining = capacity === null ? null
        : Math.max(capacity - tables.registrations.filter(row => row.event_id === event.event_id && !cancelled(row)).length, 0);
      const attendee = text(tables.users.find(row => row.user_id === userId)?.name)?.slice(0, 200) || 'An attendee';
      const message = `${attendee} withdrew from ${(text(event.name) || 'Untitled event').slice(0, 200)}.`
        + (remaining === null ? '' : ` ${remaining} of ${capacity} places now remain.`);
      for (const recipient of new Set([event.organiser_id, event.coordinator_id].filter(Boolean))) {
        tables.notifications.push({ notification_id: Math.max(0, ...tables.notifications.map(row => Number(row.notification_id))) + 1,
          recipient_id: recipient, event_id: event.event_id, request_id: null, kind: 'registration_withdrawn', message,
          created_at: withdrawn_at, read_at: null });
      }
      // SG2-62 AC6: the freed place goes to the waiting list first.
      offerWaitingPlaces(database, event);
      return { outcome: 'ok', withdrawal: { registration_id: Number(registration.registration_id), event_id: Number(event.event_id), withdrawn_at } };
    }
  };
}

/**
 * SG2-62, on top of seedRegistrableEvents and seedEventRegistration
 * (SG2-60's events). The attendee holds:
 * - 597 Quartet Evening: open, capacity 1, the attendee holds the only place,
 *   1 Nov 2030 19:00 SGT at Regression Hall.
 * - 598 Lantern Talk: registration closed in 2020, starts 15 Nov 2030,
 *   capacity 40; the attendee is registered.
 * - 599 Morning Run: started on 1 Oct 2026; the attendee is registered.
 * - 593 Closed Briefing: withdrawn on 2 Oct 2026.
 * SG2-60's seed also leaves the attendee's earlier cancelled registration for
 * 596 Small Recital, which lists as withdrawn.
 */
export function seedMyRegistrations(database: MemoryDatabase) {
  const { events, registrations, venue_bookings: bookings } = database.tables;
  const base = events.find(row => row.event_id === 591)!;
  events.push(
    { ...base, event_id: 597, name: 'Quartet Evening', category: 'social', description: 'A string quartet in the atrium.',
      registration_capacity: 1, proposed_date: '2030-11-01T11:00:00.000Z', registration_closes_at: '2030-10-30T02:00:00.000Z', planning_notes: null },
    { ...base, event_id: 598, name: 'Lantern Talk', category: 'seminar', description: 'The history of the lantern festival.',
      registration_capacity: 40, proposed_date: '2030-11-15T11:00:00.000Z',
      registration_opens_at: '2020-01-01T00:00:00.000Z', registration_closes_at: '2020-02-01T00:00:00.000Z', planning_notes: null },
    { ...base, event_id: 599, name: 'Morning Run', category: 'social', description: 'A 5 km run along the bay.',
      proposed_date: '2026-10-01T23:00:00.000Z', registration_opens_at: '2026-09-01T00:00:00.000Z',
      registration_closes_at: '2026-09-30T00:00:00.000Z', planning_notes: null });
  bookings.push({ booking_id: 597, venue_id: 1, event_id: 597, starts_at: '2030-11-01T10:00:00.000Z',
    ends_at: '2030-11-01T14:00:00.000Z', status: 'confirmed' });
  registrations.push(
    { registration_id: 6201, event_id: 597, attendee_id: 'user-attendee', status: 'registered', registered_at: '2026-10-20T01:00:00.000Z',
      contact_phone: '+65 9123 4567', needs: 'Aisle seat' },
    { registration_id: 6202, event_id: 598, attendee_id: 'user-attendee', status: 'registered', registered_at: '2020-01-10T01:00:00.000Z',
      contact_phone: '+65 9123 4567', needs: null },
    { registration_id: 6203, event_id: 599, attendee_id: 'user-attendee', status: 'registered', registered_at: '2026-09-10T01:00:00.000Z',
      contact_phone: '+65 9123 4567', needs: null },
    { registration_id: 6204, event_id: 593, attendee_id: 'user-attendee', status: 'cancelled', registered_at: '2020-01-05T01:00:00.000Z',
      withdrawn_at: '2026-10-02T02:00:00.000Z', contact_phone: '+65 9123 4567', needs: null });
}
