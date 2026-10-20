import { AccessError, INTERNAL_ROLES } from '../../server/src/auth/policy';
import type { EventSearchStore, EventSearchResult } from '../../server/src/db/eventSearch';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const singaporeDay = (iso: unknown) => typeof iso === 'string'
  ? new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10) : null;

/** Loopback UI fixture mirroring public.search_events and
 * public.event_search_options. The SQL suite (supabase/tests/event_search.sql)
 * proves the production read, its stored-role check and its filters. */
export function createMemoryEventSearchStore(database: MemoryDatabase, token: string): EventSearchStore {
  const { tables } = database;
  async function requireInternal() {
    const principal = await database.principal(token);
    if (!(INTERNAL_ROLES as readonly string[]).includes(principal.role)) throw new AccessError(403);
  }
  const venueIds = (eventId: unknown) => new Set([
    ...tables.venue_bookings.filter(row => row.event_id === eventId && ['held', 'confirmed'].includes(String(row.status))),
    ...tables.venue_booking_requests.filter(row => row.event_id === eventId && ['pending', 'approved'].includes(String(row.status)))
  ].map(row => row.venue_id));
  return {
    async search(filters) {
      await requireInternal();
      const query = filters.query?.toLowerCase();
      const matched = tables.events.filter((event: Row) => event.status !== 'draft'
        && (!query || String(event.name ?? '').toLowerCase().includes(query) || String(event.organisation ?? '').toLowerCase().includes(query))
        && (!filters.date_from || (singaporeDay(event.proposed_date) ?? '') >= filters.date_from)
        && (!filters.date_to || (singaporeDay(event.proposed_date) ?? '9999') <= filters.date_to)
        && (!filters.status || event.status === filters.status)
        && (filters.venue_id === null || venueIds(event.event_id).has(filters.venue_id))
        && (!filters.category || event.category === filters.category)
        && (!filters.coordinator_id || event.coordinator_id === filters.coordinator_id))
        .sort((a, b) => String(a.proposed_date ?? '~').localeCompare(String(b.proposed_date ?? '~')) || Number(a.event_id) - Number(b.event_id));
      const events = matched.slice(0, 100).map((event): EventSearchResult => ({
        event_id: Number(event.event_id), name: text(event.name) ?? '', organisation: text(event.organisation),
        category: text(event.category), status: String(event.status), proposed_date: text(event.proposed_date),
        coordinator_id: text(event.coordinator_id),
        coordinator_name: text(tables.users.find(user => user.user_id === event.coordinator_id)?.name),
        venues: tables.venues.filter(venue => venueIds(event.event_id).has(venue.venue_id)).map(venue => String(venue.name)).sort()
      }));
      return { events, truncated: matched.length > 100, filters };
    },
    async options() {
      await requireInternal();
      const coordinators = new Set(tables.account_roles.filter(row => row.role === 'event_coordinator').map(row => row.user_id));
      return {
        venues: tables.venues.filter(venue => !venue.deleted_at)
          .map(venue => ({ venue_id: Number(venue.venue_id), name: String(venue.name) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        coordinators: tables.users.filter(user => coordinators.has(user.user_id))
          .map(user => ({ user_id: String(user.user_id), name: String(user.name) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      };
    }
  };
}

/**
 * SG2-70 events across two organisations:
 * - 701 Harbour Gala: social, Planning, `coordinator`, booked at Regression Hall, 1 Nov 2030.
 * - 702 Coastal Leaders Summit: conference, Approved, `coordinator`, requested at Quiet Room, 2 Nov 2030.
 * - 703 Quiet Trust Workshop: workshop, Awaiting Assignment, no coordinator, 5 Nov 2030.
 * - 704 Harbour secret draft: a draft with "Harbour" in its name, never found.
 */
export function seedEventSearch(database: MemoryDatabase) {
  const { events, venue_bookings: bookings, venue_booking_requests: requests } = database.tables;
  const base = { ...events[0], organiser_id: 'user-organiser' };
  events.push(
    { ...base, event_id: 701, name: 'Harbour Gala', organisation: 'Harbour Foundation', category: 'social',
      status: 'planning', coordinator_id: 'user-coordinator', proposed_date: '2030-11-01T02:00:00.000Z' },
    { ...base, event_id: 702, name: 'Coastal Leaders Summit', organisation: 'Coastal Partners', category: 'conference',
      status: 'approved', coordinator_id: 'user-coordinator', proposed_date: '2030-11-02T02:00:00.000Z' },
    { ...base, event_id: 703, name: 'Quiet Trust Workshop', organisation: 'Quiet Trust', category: 'workshop',
      status: 'unassigned', coordinator_id: null, proposed_date: '2030-11-05T02:00:00.000Z' },
    { ...base, event_id: 704, name: 'Harbour secret draft', organisation: 'Harbour Foundation', category: 'social',
      status: 'draft', coordinator_id: null, proposed_date: '2030-11-01T02:00:00.000Z' }
  );
  bookings.push({ booking_id: 701, venue_id: 1, event_id: 701, starts_at: '2030-11-01T01:00:00.000Z',
    ends_at: '2030-11-01T09:00:00.000Z', status: 'confirmed' });
  requests.push({ request_id: 702, event_id: 702, venue_id: 2, starts_at: '2030-11-02T01:00:00.000Z',
    ends_at: '2030-11-02T09:00:00.000Z', status: 'pending', layout: null, venue_requirements: null, notes: null,
    requested_by: 'user-coordinator', requested_at: '2030-10-01T00:00:00.000Z', decided_by: null, decided_at: null,
    decision_reason: null, venue_booking_id: null });
}
