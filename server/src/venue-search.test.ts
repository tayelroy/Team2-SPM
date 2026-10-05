import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization, type Role } from './auth';
import { dbConfig } from './db/config';
import { createVenueSearchHandler, createVenueSearchRouter, searchVenues } from './venues/search';
import { parseVenueSearch, type VenueSearchCriteria } from './venues/searchFields';

const ACCOUNT_ROLES = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'
] as const;

const FROM = '2030-06-15T00:00:00.000Z';
const TO = '2030-06-15T12:00:00.000Z';

type TableResult = { data?: unknown; error?: unknown };
type QueryCall = { table: string; method: string; args: unknown[] };

/** Chainable, thenable stand-in for the PostgREST query builder. */
function fakeClient(tables: Record<string, TableResult>, calls: QueryCall[] = []): SupabaseClient {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (value: TableResult) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject)
      };
      for (const method of ['select', 'lt', 'gt', 'order']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

const hall = { venue_id: 1, name: 'Atrium Hall', location: 'Level 1, North Wing', capacity: 100,
  facilities: 'Stage, PA, projection', accessibility_features: 'Step-free, hearing loop', operating_information: '08:00–22:00' };
const terrace = { ...hall, venue_id: 3, name: 'Rooftop Terrace', location: 'Level 12', capacity: 125,
  facilities: 'Bar, outdoor power', accessibility_features: 'Lift access' };
const seminar = { ...hall, venue_id: 2, name: 'Seminar Room A', location: 'Level 3, East Wing', capacity: 60,
  facilities: 'Whiteboards, screen', accessibility_features: 'Step-free' };
const unrecorded = { ...hall, venue_id: 4, name: 'Unrecorded Room', location: null, capacity: null, facilities: null, accessibility_features: null };

function catalogue(extra: Record<string, TableResult> = {}) {
  return fakeClient({
    venues: { data: [hall, seminar, terrace, unrecorded], error: null },
    venue_layouts: { data: [
      { venue_id: 1, layout: 'theatre', other_description: null },
      { venue_id: 3, layout: 'banquet', other_description: null },
      { venue_id: 3, layout: 'other', other_description: 'Cocktail' }
    ], error: null },
    ...extra
  });
}

function criteria(overrides: Partial<VenueSearchCriteria> = {}): VenueSearchCriteria {
  return { starts_at: FROM, ends_at: TO, attendance: null, location: null, layout: null, facilities: [], accessibility: [], ...overrides };
}

async function names(overrides: Partial<VenueSearchCriteria> = {}, extra: Record<string, TableResult> = {}) {
  const result = await searchVenues(criteria(overrides), catalogue(extra));
  assert.equal(result.outcome, 'ok');
  return result.outcome === 'ok' ? result.venues.map(venue => venue.name) : [];
}

// --- searchVenues ------------------------------------------------------------

test('[NORMAL] [SG2-46:AC2] SG2-46: with no criteria every free venue is returned in name order with its layouts', async () => {
  const calls: QueryCall[] = [];
  const client = fakeClient({ venues: { data: [hall, terrace], error: null }, venue_layouts: {
    data: [{ venue_id: 3, layout: 'banquet', other_description: null }], error: null } }, calls);
  const result = await searchVenues(criteria(), client);
  assert.deepEqual(result, { outcome: 'ok', venues: [
    { ...hall, layouts: [], held: [] },
    { ...terrace, layouts: [{ layout: 'banquet', other_description: null }], held: [] }
  ] });
  for (const table of ['venue_unavailability', 'venue_booking_occupancy']) {
    assert.deepEqual(calls.filter(call => call.table === table && ['lt', 'gt'].includes(call.method)), [
      { table, method: 'lt', args: ['starts_at', TO] },
      { table, method: 'gt', args: ['ends_at', FROM] }
    ]);
  }
  assert.deepEqual(calls.find(call => call.table === 'venues' && call.method === 'order')?.args, ['name', { ascending: true }]);
});

test('[CONFLICT] [SG2-45:AC1] [SG2-46:AC2] AC2: a blocked venue or one with a confirmed booking in the period is not returned', async () => {
  assert.deepEqual(await names({}, {
    venue_unavailability: { data: [{ venue_id: 1, starts_at: FROM, ends_at: TO }], error: null },
    venue_booking_occupancy: { data: [{ venue_id: 2, starts_at: FROM, ends_at: TO, status: 'confirmed' }], error: null }
  }), ['Rooftop Terrace', 'Unrecorded Room']);
});

test('[CONFLICT] [SG2-84:AC3] active tentative holds exclude a venue from available search results', async () => {
  const result = await searchVenues(criteria(), catalogue({ venue_booking_occupancy: { data: [
    { venue_id: 3, starts_at: FROM, ends_at: TO, status: 'tentative' }
  ], error: null } }));
  assert.deepEqual(result.outcome === 'ok' && result.venues.map(venue => venue.name), ['Atrium Hall', 'Seminar Room A', 'Unrecorded Room']);
});

test('[NORMAL] [SG2-46:AC2] legacy held bookings remain searchable with ordered warning periods', async () => {
  const later = { venue_id: 3, starts_at: '2030-06-15T09:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', status: 'held' };
  const earlier = { ...later, starts_at: '2030-06-15T01:00:00.000Z', ends_at: '2030-06-15T02:00:00.000Z' };
  const result = await searchVenues(criteria({ attendance: 101 }), catalogue({ venue_booking_occupancy: { data: [later, earlier], error: null } }));
  assert.deepEqual(result.outcome === 'ok' && result.venues.map(venue => [venue.name, venue.held]), [
    ['Rooftop Terrace', [{ starts_at: earlier.starts_at, ends_at: earlier.ends_at }, { starts_at: later.starts_at, ends_at: later.ends_at }]]
  ]);
});

test('[NORMAL] [SG2-43:AC3] [SG2-46:AC2] AC2: attendance, location, layout, facilities and accessibility must all be met', async () => {
  assert.deepEqual(await names({ attendance: 100 }), ['Atrium Hall', 'Rooftop Terrace'], 'capacity is inclusive; unrecorded capacity never fits');
  assert.deepEqual(await names({ location: 'level 1' }), ['Atrium Hall', 'Rooftop Terrace'], 'location is a case-insensitive substring');
  assert.deepEqual(await names({ layout: 'banquet' }), ['Rooftop Terrace']);
  assert.deepEqual(await names({ layout: 'classroom' }), []);
  assert.deepEqual(await names({ facilities: ['stage', 'projection'] }), ['Atrium Hall']);
  assert.deepEqual(await names({ facilities: ['stage', 'bar'] }), [], 'every keyword must appear');
  assert.deepEqual(await names({ accessibility: ['step-free'] }), ['Atrium Hall', 'Seminar Room A']);
  assert.deepEqual(await names({ attendance: 50, accessibility: ['step-free'], layout: 'theatre' }), ['Atrium Hall']);
});

test('[BOUNDARY] [SG2-46:AC2] attendance at capacity fits and capacity plus one excludes the venue', async () => {
  assert.deepEqual(await names({ attendance: 99 }), ['Atrium Hall', 'Rooftop Terrace']);
  assert.deepEqual(await names({ attendance: 100 }), ['Atrium Hall', 'Rooftop Terrace']);
  assert.deepEqual(await names({ attendance: 101 }), ['Rooftop Terrace']);
});

test('[BOUNDARY] [SG2-46:AC2] search accepts exactly 31 days and refuses the next millisecond', () => {
  assert.deepEqual(parseVenueSearch({ from: FROM, to: '2030-07-16T00:00:00.000Z' }), {
    ok: true, criteria: { starts_at: FROM, ends_at: '2030-07-16T00:00:00.000Z', attendance: null,
      location: null, layout: null, facilities: [], accessibility: [] }
  });
  assert.deepEqual(parseVenueSearch({ from: FROM, to: '2030-07-16T00:00:00.001Z' }), {
    ok: false, message: 'The search period must not exceed 31 days.'
  });
});

test('[BOUNDARY] [SG2-46:AC2] text and keyword counts stop at 255 characters and 10 terms', () => {
  const text = '🏛'.repeat(255);
  const ten = 'a,b,c,d,e,f,g,h,i,j';
  assert.deepEqual(parseVenueSearch({ from: FROM, to: TO, location: text, facilities: ten }), {
    ok: true, criteria: { starts_at: FROM, ends_at: TO, attendance: null, location: text, layout: null,
      facilities: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], accessibility: [] }
  });
  for (const query of [{ location: '🏛'.repeat(256) }, { facilities: `${ten},k` }]) {
    assert.deepEqual(parseVenueSearch({ from: FROM, to: TO, ...query }), {
      ok: false, message: 'Text criteria must be single values within 255 characters, with at most 10 keywords each.'
    });
  }
});

test('[NORMAL] [SG2-46:AC3] AC3: no accessibility keywords means accessibility is not a matching requirement', async () => {
  assert.deepEqual(await names({ accessibility: [] }), ['Atrium Hall', 'Seminar Room A', 'Rooftop Terrace', 'Unrecorded Room']);
});

for (const table of ['venues', 'venue_layouts', 'venue_unavailability', 'venue_booking_occupancy']) {
  test(`[FAILURE] [SG2-46:AC2] a failed read of ${table} makes the search unavailable`, async () => {
    const result = await searchVenues(criteria(), catalogue({ [table]: { data: null, error: { message: 'SECRET' } } }));
    assert.deepEqual(result, { outcome: 'unavailable' });
  });
}

// --- parseVenueSearch ----------------------------------------------------------

test('[NORMAL] [SG2-46:AC2] parseVenueSearch normalises a complete query', () => {
  assert.deepEqual(parseVenueSearch({
    from: '2030-06-15T08:00:00+08:00', to: '2030-06-15T23:59:00+08:00', attendance: '80', location: ' North Wing ',
    layout: 'Theatre', facilities: 'Stage, PA ,,', accessibility: 'Step-free'
  }), { ok: true, criteria: {
    starts_at: '2030-06-15T00:00:00.000Z', ends_at: '2030-06-15T15:59:00.000Z', attendance: 80, location: 'north wing',
    layout: 'theatre', facilities: ['stage', 'pa'], accessibility: ['step-free']
  } });
  assert.deepEqual(parseVenueSearch({ from: FROM, to: TO, attendance: '', location: '  ', facilities: '' }),
    { ok: true, criteria: criteria() }, 'blank criteria are not applied');
});

test('[BOUNDARY] [FAILURE] [SG2-46:AC2] parseVenueSearch rejects malformed periods and criteria', () => {
  const period = { from: FROM, to: TO };
  const cases: [Record<string, unknown>, RegExp][] = [
    [{}, /ISO 8601/], [{ from: FROM }, /ISO 8601/], [{ from: 'nope', to: TO }, /ISO 8601/], [{ from: 5, to: TO }, /ISO 8601/],
    [{ from: TO, to: FROM }, /earlier/], [{ from: FROM, to: FROM }, /earlier/],
    [{ from: FROM, to: '2030-07-17T00:00:00.000Z' }, /31 days/],
    [{ ...period, attendance: '0' }, /attendance/], [{ ...period, attendance: '1.5' }, /attendance/],
    [{ ...period, attendance: '2147483648' }, /attendance/], [{ ...period, attendance: ['1', '2'] }, /attendance/],
    [{ ...period, location: ['a', 'b'] }, /single values/], [{ ...period, location: 'x'.repeat(256) }, /single values/],
    [{ ...period, facilities: 'a,b,c,d,e,f,g,h,i,j,k' }, /at most 10/], [{ ...period, accessibility: ['a'] }, /single values/],
    [{ ...period, layout: 'stadium' }, /listed layouts/]
  ];
  for (const [query, message] of cases) {
    const parsed = parseVenueSearch(query);
    assert.equal(parsed.ok, false, JSON.stringify(query));
    assert.match(parsed.ok ? '' : parsed.message, message);
  }
  assert.equal(parseVenueSearch({ from: FROM, to: '2030-07-16T00:00:00.000Z' }).ok, true, 'exactly 31 days is allowed');
  assert.equal(parseVenueSearch({ ...period, attendance: '2147483647' }).ok, true);
});

// --- handler and router ------------------------------------------------------------

function app(role: Role, handler = createVenueSearchHandler(async (search) => ({ outcome: 'ok', venues: [{ ...hall, layouts: [], held: [], searched: search } as never] }), () => catalogue())) {
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) });
  const server = express();
  server.use('/api/venues', createVenueSearchRouter(access, handler));
  return server;
}

const auth = { Authorization: 'Bearer valid-token' };
const query = `from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&attendance=80`;

for (const role of ACCOUNT_ROLES) test(`${role === 'event_coordinator' ? '[NORMAL]' : '[FAILURE]'} [SG2-25:AC1] [SG2-46:AC2] SG2-46: only event coordinators can search venues (${role})`, async () => {
  const response = await request(app(role)).get(`/api/venues/search?${query}`).set(auth);
  assert.equal(response.status, role === 'event_coordinator' ? 200 : 403);
});

test('[NORMAL] [SG2-46:AC2] the handler passes the parsed criteria to the search and returns its venues', async () => {
  const response = await request(app('event_coordinator')).get(`/api/venues/search?${query}`).set(auth);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body.venues[0].searched, { ...criteria(), attendance: 80 });
});

test('[FAILURE] [SG2-46:AC2] invalid criteria are rejected before any query', async () => {
  let searched = false;
  const handler = createVenueSearchHandler(async () => { searched = true; return { outcome: 'ok', venues: [] }; }, () => catalogue());
  const response = await request(app('event_coordinator', handler)).get('/api/venues/search?from=bad').set(auth);
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: 'from and to must be ISO 8601 date-times.' });
  assert.equal(searched, false);
});

test('[FAILURE] [SG2-46:AC2] an unconfigured database, a failed read or a thrown error returns 503 without details', async () => {
  const failures = [
    createVenueSearchHandler(async () => ({ outcome: 'ok', venues: [] }), () => null),
    createVenueSearchHandler(async () => ({ outcome: 'unavailable' }), () => catalogue()),
    createVenueSearchHandler(async () => { throw new Error('SECRET'); }, () => catalogue())
  ];
  for (const handler of failures) {
    const response = await request(app('event_coordinator', handler)).get(`/api/venues/search?${query}`).set(auth);
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Venue search is temporarily unavailable.' });
  }
});

const original = { ...dbConfig };
beforeEach(() => { for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined; });
afterEach(() => { Object.assign(dbConfig, original); });

test('[FAILURE] [SG2-25:AC3] [SG2-46:AC2] the production app requires authentication and uses the default handler and client', async () => {
  assert.equal((await request(createApp()).get(`/api/venues/search?${query}`)).status, 401);
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role: 'event_coordinator' }) });
  const response = await request(createApp(undefined, access)).get(`/api/venues/search?${query}`).set(auth);
  assert.equal(response.status, 503, 'no database is configured in unit tests');
});
