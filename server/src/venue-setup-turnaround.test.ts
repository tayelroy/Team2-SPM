import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from './auth/policy';
import { getAllVenuesAvailability, getVenueAvailability } from './venues/availability';
import { searchVenues } from './venues/search';
import { createVenueConflictStore } from './db/venueConflicts';
import { NO_PREPARATION, clashes, effectivePeriod, gapMinutes, preparationByVenue, shiftIso } from './venues/preparation';
import type { VenueSearchCriteria } from './venues/searchFields';

type Result = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

/** Chainable, thenable stand-in for the PostgREST query builder; each table
 * answers with the result given for it, or an empty list. */
function fakeClient(tables: Record<string, Result>, calls: Call[] = []): SupabaseClient {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = { then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve) };
      for (const method of ['select', 'eq', 'in', 'lt', 'gt', 'order', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

/** Prep Hall needs 30 minutes to set up and 45 to turn around (SG2-77). */
const PREP = { setup_minutes: 30, turnaround_minutes: 45 };
const talk = { starts_at: '2030-09-10T10:00:00.000Z', ends_at: '2030-09-10T12:00:00.000Z' };

// --- The rule -----------------------------------------------------------------

test('[NORMAL] [SG2-78:AC1] a 10:00-12:00 event with 30 minutes setup and 45 minutes turnaround occupies 09:30-12:45', () => {
  assert.deepEqual(effectivePeriod(talk, PREP), { starts_at: '2030-09-10T09:30:00.000Z', ends_at: '2030-09-10T12:45:00.000Z' });
  assert.equal(gapMinutes(PREP), 75);
  assert.equal(shiftIso('2030-09-10T10:00:00.000Z', -30), '2030-09-10T09:30:00.000Z');
});

test('[BOUNDARY] [SG2-78:AC2] bookings exactly setup plus turnaround apart do not clash; a minute closer on either side does', () => {
  assert.equal(clashes({ starts_at: '2030-09-10T13:15:00.000Z', ends_at: '2030-09-10T14:00:00.000Z' }, talk, PREP), false);
  assert.equal(clashes({ starts_at: '2030-09-10T13:14:00.000Z', ends_at: '2030-09-10T14:00:00.000Z' }, talk, PREP), true);
  assert.equal(clashes({ starts_at: '2030-09-10T08:00:00.000Z', ends_at: '2030-09-10T08:45:00.000Z' }, talk, PREP), false);
  assert.equal(clashes({ starts_at: '2030-09-10T08:00:00.000Z', ends_at: '2030-09-10T08:46:00.000Z' }, talk, PREP), true);
});

test('[BOUNDARY] [SG2-78:AC1] a venue with no times recorded needs no gap, so back-to-back bookings do not clash', () => {
  const timesFor = preparationByVenue([{ venue_id: 1, ...PREP }]);
  assert.deepEqual(timesFor(1), PREP);
  assert.deepEqual(timesFor(2), NO_PREPARATION);
  assert.equal(clashes({ starts_at: talk.ends_at, ends_at: '2030-09-10T13:00:00.000Z' }, talk, timesFor(2)), false);
});

// --- AC3/AC5: the availability calendar ---------------------------------------

const RANGE = { from: '2030-09-10T00:00:00.000Z', to: '2030-09-11T00:00:00.000Z' };

test('[NORMAL] [SG2-78:AC3] [SG2-78:AC5] availability shows setup and turnaround as occupied, marked separately from the event, which keeps its own times', async () => {
  const calls: Call[] = [];
  const client = fakeClient({
    venue_booking_occupancy: { data: [{ ...talk, status: 'confirmed', event_id: 7 }], error: null },
    venue_operations: { data: [{ venue_id: 1, ...PREP }], error: null }
  }, calls);
  assert.deepEqual(await getVenueAvailability(1, RANGE.from, RANGE.to, client), { outcome: 'ok', entries: [
    { start: '2030-09-10T09:30:00.000Z', end: talk.starts_at, kind: 'setup', label: 'Setup (30 min) for confirmed · event 7' },
    { start: talk.starts_at, end: talk.ends_at, kind: 'booking', label: 'confirmed · event 7' },
    { start: talk.ends_at, end: '2030-09-10T12:45:00.000Z', kind: 'turnaround', label: 'Turnaround (45 min) after confirmed · event 7' }
  ] });
  assert.deepEqual(calls.filter(call => call.table === 'venue_operations' && call.method === 'eq').map(call => call.args), [['venue_id', 1]]);
});

test('[BOUNDARY] [SG2-78:AC3] only the parts inside the range are shown: a booking ending just before it shows only its turnaround', async () => {
  const yesterday = { starts_at: '2030-09-09T22:00:00.000Z', ends_at: '2030-09-09T23:30:00.000Z', status: 'tentative', event_id: null };
  const client = fakeClient({
    venue_booking_occupancy: { data: [yesterday], error: null },
    venue_operations: { data: [{ venue_id: 1, ...PREP }], error: null }
  });
  assert.deepEqual(await getVenueAvailability(1, RANGE.from, RANGE.to, client), { outcome: 'ok', entries: [
    { start: '2030-09-09T23:30:00.000Z', end: '2030-09-10T00:15:00.000Z', kind: 'turnaround', label: 'Turnaround (45 min) after Tentative' }
  ] });
});

test('[NORMAL] [SG2-78:AC3] across all venues each booking uses its own venue\'s times', async () => {
  const client = fakeClient({
    venues: { data: [{ venue_id: 1, name: 'Prep Hall' }, { venue_id: 2, name: 'Plain Room' }], error: null },
    venue_booking_occupancy: { data: [{ venue_id: 1, ...talk, status: 'confirmed', event_id: null }, { venue_id: 2, ...talk, status: 'confirmed', event_id: null }], error: null },
    venue_operations: { data: [{ venue_id: 1, setup_minutes: 0, turnaround_minutes: 45 }], error: null }
  });
  const result = await getAllVenuesAvailability(RANGE.from, RANGE.to, client);
  assert.equal(result.outcome, 'ok');
  const kinds = result.outcome === 'ok' ? result.venues.map(venue => [venue.name, venue.entries.map(entry => entry.kind)]) : [];
  assert.deepEqual(kinds, [['Prep Hall', ['booking', 'turnaround']], ['Plain Room', ['booking']]]);
});

test('[FAILURE] [SG2-78:AC3] availability is unavailable when setup and turnaround times cannot be read', async () => {
  const down = { venue_operations: { data: null, error: { message: 'down' } } };
  assert.deepEqual(await getVenueAvailability(1, RANGE.from, RANGE.to, fakeClient(down)), { outcome: 'unavailable' });
  assert.deepEqual(await getAllVenuesAvailability(RANGE.from, RANGE.to, fakeClient(down)), { outcome: 'unavailable' });
});

test('[BOUNDARY] [SG2-78:AC1] when no times come back at all, bookings show without setup or turnaround', async () => {
  const empty = { venue_operations: { data: null, error: null } };
  const single = await getVenueAvailability(1, RANGE.from, RANGE.to, fakeClient({
    ...empty, venue_booking_occupancy: { data: [{ ...talk, status: 'confirmed', event_id: null }], error: null } }));
  assert.deepEqual(single, { outcome: 'ok', entries: [{ start: talk.starts_at, end: talk.ends_at, kind: 'booking', label: 'confirmed' }] });
  const all = await getAllVenuesAvailability(RANGE.from, RANGE.to, fakeClient({ ...empty,
    venues: { data: [{ venue_id: 1, name: 'Prep Hall' }], error: null },
    venue_booking_occupancy: { data: [{ venue_id: 1, ...talk, status: 'confirmed', event_id: null }], error: null } }));
  assert.deepEqual(all.outcome === 'ok' ? all.venues[0].entries.map(entry => entry.kind) : all, ['booking']);
});

// --- AC4: venue search --------------------------------------------------------

const prepHall = { venue_id: 1, name: 'Prep Hall', location: null, capacity: 100, facilities: null, accessibility_features: null, operating_information: null };
const plainRoom = { ...prepHall, venue_id: 2, name: 'Plain Room' };
const criteria = (starts_at: string, ends_at: string): VenueSearchCriteria =>
  ({ starts_at, ends_at, attendance: null, location: null, layout: null, facilities: [], accessibility: [] });

function catalogue(extra: Record<string, Result> = {}) {
  return fakeClient({
    venues: { data: [plainRoom, prepHall], error: null },
    venue_booking_occupancy: { data: [{ venue_id: 1, ...talk, status: 'confirmed' }, { venue_id: 2, ...talk, status: 'confirmed' }], error: null },
    venue_operations: { data: [{ venue_id: 1, ...PREP }], error: null },
    ...extra
  });
}
const names = async (from: string, to: string, extra?: Record<string, Result>) => {
  const result = await searchVenues(criteria(from, to), catalogue(extra));
  return result.outcome === 'ok' ? result.venues.map(venue => venue.name) : result.outcome;
};

test('[BOUNDARY] [SG2-78:AC4] search leaves out a venue whose turnaround the requested time would cut into, and returns it once there is room', async () => {
  // Prep Hall's talk ends at 12:00: an event at 13:14 leaves 74 of the 75 minutes needed.
  assert.deepEqual(await names('2030-09-10T13:14:00.000Z', '2030-09-10T14:00:00.000Z'), ['Plain Room']);
  assert.deepEqual(await names('2030-09-10T13:15:00.000Z', '2030-09-10T14:00:00.000Z'), ['Plain Room', 'Prep Hall']);
});

test('[NORMAL] [SG2-78:AC4] a venue with no setup or turnaround is returned straight after its booking ends', async () => {
  assert.deepEqual(await names('2030-09-10T12:00:00.000Z', '2030-09-10T13:00:00.000Z'), ['Plain Room']);
});

test('[FAILURE] [SG2-78:AC4] search is unavailable when setup and turnaround times cannot be read', async () => {
  assert.equal(await names(RANGE.from, RANGE.to, { venue_operations: { data: null, error: { message: 'down' } } }), 'unavailable');
});

// --- AC2: conflicts reported on a request (SG2-50) ------------------------------

test('[NORMAL] [SG2-78:AC2] a request\'s conflicts are read setup plus turnaround wider than its own times', async () => {
  const calls: Call[] = [];
  const store = createVenueConflictStore(fakeClient({ venue_operations: { data: PREP, error: null } }, calls));
  await store.conflicts({ venue_id: 1, starts_at: '2030-09-10T13:00:00.000Z', ends_at: '2030-09-10T14:00:00.000Z' }, { now: '2030-01-01T00:00:00.000Z' });
  for (const table of ['venue_bookings', 'venue_holds']) {
    assert.deepEqual(calls.filter(call => call.table === table && ['lt', 'gt'].includes(call.method) && call.args[0] !== 'expires_at').map(call => call.args), [
      ['starts_at', '2030-09-10T15:15:00.000Z'], ['ends_at', '2030-09-10T11:45:00.000Z']
    ], table);
  }
});

test('[FAILURE] [SG2-78:AC2] conflicts are unavailable when the venue\'s times cannot be read', async () => {
  const store = createVenueConflictStore(fakeClient({ venue_operations: { data: null, error: { message: 'down' } } }));
  await assert.rejects(store.conflicts({ venue_id: 1, ...talk }, { now: '2030-01-01T00:00:00.000Z' }),
    (error: unknown) => error instanceof AccessError && error.status === 503);
});
