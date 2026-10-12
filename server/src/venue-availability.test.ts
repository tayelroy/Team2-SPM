import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import { dbConfig } from './db/config';
import {
  createAllVenuesAvailabilityHandler,
  createAvailabilityHandler,
  createVenueAvailabilityRouter,
  getAllVenuesAvailability,
  getVenueAvailability
} from './venues/availability';

// Documented account roles form the oracle, independent of the production list.
const ACCOUNT_ROLES = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'
] as const;

const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-10-31T00:00:00.000Z';
// SG2-78: bookings are read a day wider each side, so setup or turnaround
// reaching into the range from just outside it is not missed.
const WIDE_FROM = '2026-09-30T00:00:00.000Z';
const WIDE_TO = '2026-11-01T00:00:00.000Z';

type TableResult = { data?: unknown; error?: unknown };
type QueryCall = { table: string; method: string; args: unknown[] };

/**
 * Minimal stand-in for the PostgREST query builder: chainable on every method
 * and thenable at any point in the chain, since the two read paths stop the
 * chain at different methods (single-venue ends in .order(), all-venues ends
 * in .gt() for the booking/unavailability tables).
 */
function fakeClient(tables: Record<string, TableResult>, calls: QueryCall[] = []): SupabaseClient {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (value: TableResult) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject)
      };
      for (const method of ['select', 'eq', 'lt', 'gt', 'order']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

// --- getVenueAvailability -------------------------------------------------------

test('[NORMAL] [SG2-84:AC3] [SG2-84:AC4] tentative periods have their own kind and confirmed bookings retain their labels', async () => {
  const result = await getVenueAvailability(1, FROM, TO, fakeClient({ venue_booking_occupancy: { data: [
    { starts_at: FROM, ends_at: TO, status: 'tentative', event_id: 7 },
    { starts_at: FROM, ends_at: TO, status: 'tentative', event_id: null },
    { starts_at: FROM, ends_at: TO, status: 'confirmed', event_id: null }
  ], error: null } }));
  assert.deepEqual(result, { outcome: 'ok', entries: [
    { start: FROM, end: TO, kind: 'hold', label: 'Tentative · event 7' },
    { start: FROM, end: TO, kind: 'hold', label: 'Tentative' },
    { start: FROM, end: TO, kind: 'booking', label: 'confirmed' }
  ] });
});

test('[NORMAL] [SG2-44:AC1] [SG2-44:AC2] queries the chosen venue over the half-open range and merges occupied periods in start order', async () => {
  const calls: QueryCall[] = [];
  const client = fakeClient({
    venue_booking_occupancy: {
      data: [
        { starts_at: '2026-10-05T09:00:00.000Z', ends_at: '2026-10-05T12:00:00.000Z', status: 'held', event_id: null },
        { starts_at: '2026-10-01T09:00:00.000Z', ends_at: '2026-10-01T17:00:00.000Z', status: 'confirmed', event_id: 12 }
      ],
      error: null
    },
    venue_unavailability: {
      data: [
        { starts_at: '2026-10-03T00:00:00.000Z', ends_at: '2026-10-04T00:00:00.000Z', reason: 'Maintenance' }
      ],
      error: null
    }
  }, calls);

  const result = await getVenueAvailability(7, FROM, TO, client);

  for (const [table, from, to] of [['venue_booking_occupancy', WIDE_FROM, WIDE_TO], ['venue_unavailability', FROM, TO]]) {
    assert.deepEqual(calls.filter(call => call.table === table && ['eq', 'lt', 'gt'].includes(call.method)), [
      { table, method: 'eq', args: ['venue_id', 7] },
      { table, method: 'lt', args: ['starts_at', to] },
      { table, method: 'gt', args: ['ends_at', from] }
    ]);
  }

  assert.deepEqual(result, {
    outcome: 'ok',
    entries: [
      { start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T17:00:00.000Z', kind: 'booking', label: 'confirmed · event 12' },
      { start: '2026-10-03T00:00:00.000Z', end: '2026-10-04T00:00:00.000Z', kind: 'unavailable', label: 'Maintenance' },
      { start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T12:00:00.000Z', kind: 'booking', label: 'held' }
    ]
  });
});

test('[BOUNDARY] [SG2-44:AC1] [SG2-44:AC2] keeps entries that share a start instant', async () => {
  const client = fakeClient({
    venue_booking_occupancy: {
      data: [{ starts_at: '2026-10-05T09:00:00.000Z', ends_at: '2026-10-05T10:00:00.000Z', status: 'held', event_id: null }],
      error: null
    },
    venue_unavailability: {
      data: [{ starts_at: '2026-10-05T09:00:00.000Z', ends_at: '2026-10-05T11:00:00.000Z', reason: 'Deep clean' }],
      error: null
    }
  });

  const result = await getVenueAvailability('5', FROM, TO, client);
  assert.deepEqual(result, { outcome: 'ok', entries: [
    { start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T10:00:00.000Z', kind: 'booking', label: 'held' },
    { start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T11:00:00.000Z', kind: 'unavailable', label: 'Deep clean' }
  ] });
});

test('[BOUNDARY] [SG2-44:AC1] returns an empty list when both queries return null', async () => {
  const client = fakeClient({
    venue_booking_occupancy: { data: null, error: null },
    venue_unavailability: { data: null, error: null }
  });
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, client), { outcome: 'ok', entries: [] });
});

test('[FAILURE] [SG2-44:AC1] is unavailable when the bookings query fails', async () => {
  const client = fakeClient({
    venue_booking_occupancy: { data: null, error: { message: 'boom' } },
    venue_unavailability: { data: [], error: null }
  });
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, client), { outcome: 'unavailable' });
});

test('[FAILURE] [SG2-44:AC1] is unavailable when the unavailability query fails', async () => {
  const client = fakeClient({
    venue_booking_occupancy: { data: [], error: null },
    venue_unavailability: { data: null, error: { message: 'boom' } }
  });
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, client), { outcome: 'unavailable' });
});

// --- SG2-80: bookings inside a period the venue was marked unavailable for ---

const A = { starts_at: '2026-10-02T09:00:00+00:00', ends_at: '2026-10-02T12:00:00+00:00' };
const B = { starts_at: '2026-10-03T09:00:00+00:00', ends_at: '2026-10-03T12:00:00+00:00' };

test('[NORMAL] [SG2-80:AC3] [SG2-80:AC5] a flagged confirmed booking is labelled as affected beside the unavailable period', async () => {
  const calls: QueryCall[] = [];
  const result = await getVenueAvailability(1, FROM, TO, fakeClient({
    venue_booking_occupancy: { data: [
      { ...A, status: 'confirmed', event_id: 12 }, { ...B, status: 'confirmed', event_id: null }
    ], error: null },
    venue_unavailability: { data: [{ starts_at: FROM, ends_at: TO, reason: 'Air conditioning failed' }], error: null },
    venue_affected_bookings: { data: [A], error: null }
  }, calls));
  assert.deepEqual(result, { outcome: 'ok', entries: [
    { start: FROM, end: TO, kind: 'unavailable', label: 'Air conditioning failed' },
    { start: A.starts_at, end: A.ends_at, kind: 'booking', label: 'confirmed · event 12 · affected by venue unavailability' },
    { start: B.starts_at, end: B.ends_at, kind: 'booking', label: 'confirmed' }
  ] });
  assert.deepEqual(calls.filter(call => call.table === 'venue_affected_bookings').map(call => [call.method, ...call.args]), [
    ['select', 'starts_at, ends_at'], ['eq', 'venue_id', 1], ['lt', 'starts_at', TO], ['gt', 'ends_at', FROM]
  ]);
});

test('[BOUNDARY] [SG2-80:AC3] only the confirmed booking is flagged, not a held booking or another venue\'s booking with the same period', async () => {
  const single = await getVenueAvailability(1, FROM, TO, fakeClient({
    venue_booking_occupancy: { data: [{ ...A, status: 'held', event_id: 4 }], error: null },
    venue_affected_bookings: { data: [A], error: null }
  }));
  assert.deepEqual(single, { outcome: 'ok', entries: [{ start: A.starts_at, end: A.ends_at, kind: 'booking', label: 'held · event 4' }] });
  const all = await getAllVenuesAvailability(FROM, TO, fakeClient({
    venues: { data: [{ venue_id: 1, name: 'Atrium' }, { venue_id: 2, name: 'Hall' }], error: null },
    venue_booking_occupancy: { data: [{ ...A, venue_id: 1, status: 'confirmed', event_id: 5 }, { ...A, venue_id: 2, status: 'confirmed', event_id: 6 }], error: null },
    venue_affected_bookings: { data: [{ ...A, venue_id: 2 }], error: null }
  }));
  assert.deepEqual(all, { outcome: 'ok', venues: [
    { venueId: 1, name: 'Atrium', entries: [{ start: A.starts_at, end: A.ends_at, kind: 'booking', label: 'confirmed · event 5' }] },
    { venueId: 2, name: 'Hall', entries: [{ start: A.starts_at, end: A.ends_at, kind: 'booking', label: 'confirmed · event 6 · affected by venue unavailability' }] }
  ] });
});

test('[BOUNDARY] [SG2-80:AC3] null affected-booking data flags nothing', async () => {
  const booking = { ...A, status: 'confirmed', event_id: 5 };
  assert.deepEqual(await getVenueAvailability(1, FROM, TO, fakeClient({
    venue_booking_occupancy: { data: [booking], error: null }, venue_affected_bookings: { data: null, error: null }
  })), { outcome: 'ok', entries: [{ start: A.starts_at, end: A.ends_at, kind: 'booking', label: 'confirmed · event 5' }] });
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, fakeClient({
    venues: { data: [{ venue_id: 1, name: 'Atrium' }], error: null },
    venue_booking_occupancy: { data: [{ ...booking, venue_id: 1 }], error: null }, venue_affected_bookings: { data: null, error: null }
  })), { outcome: 'ok', venues: [{ venueId: 1, name: 'Atrium', entries: [{ start: A.starts_at, end: A.ends_at, kind: 'booking', label: 'confirmed · event 5' }] }] });
});

test('[FAILURE] [SG2-80:AC3] both reads are unavailable when the affected-booking query fails', async () => {
  const failing = { venue_affected_bookings: { data: null, error: { message: 'boom' } } };
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, fakeClient(failing)), { outcome: 'unavailable' });
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, fakeClient(failing)), { outcome: 'unavailable' });
});

test('[FAILURE] [SG2-44:AC1] is unavailable without a Supabase client', async () => {
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, null), { outcome: 'unavailable' });
});

for (const badId of ['0', '-1', '3.5', 'abc', '', 5.5, 0, -2, null, undefined, {}]) {
  test(`${badId === '0' || badId === 0 ? '[BOUNDARY]' : '[FAILURE]'} [SG2-44:AC1] rejects a non-positive-integer venue id: ${JSON.stringify(badId)}`, async () => {
    assert.deepEqual(await getVenueAvailability(badId, FROM, TO, fakeClient({})), {
      outcome: 'invalid',
      message: 'A positive integer venue id is required.'
    });
  });
}

for (const [from, to] of [
  [undefined, TO],
  [TO, undefined],
  ['', TO],
  ['not-a-date', TO],
  [TO, 'nope'],
  [['x'], TO]
] as Array<[unknown, unknown]>) {
  test(`[FAILURE] [SG2-44:AC1] rejects non ISO date-times: ${JSON.stringify([from, to])}`, async () => {
    assert.deepEqual(await getVenueAvailability('5', from, to, fakeClient({})), {
      outcome: 'invalid',
      message: 'from and to must be ISO 8601 date-times.'
    });
  });
}

for (const [from, to] of [[TO, TO], [TO, FROM]]) {
  test(`[BOUNDARY] [SG2-44:AC1] rejects a non-increasing range: ${JSON.stringify([from, to])}`, async () => {
    assert.deepEqual(await getVenueAvailability('5', from, to, fakeClient({})), {
      outcome: 'invalid',
      message: 'from must be earlier than to.'
    });
  });
}

test('[BOUNDARY] [SG2-44:AC1] accepts exactly 366 days and rejects one millisecond beyond the limit without querying', async () => {
  const calls: QueryCall[] = [];
  const client = fakeClient({}, calls);
  assert.deepEqual(
    await getVenueAvailability('5', '2026-01-01T00:00:00.000Z', '2027-01-02T00:00:00.000Z', client),
    { outcome: 'ok', entries: [] }
  );
  assert.ok(calls.length > 0);
  calls.length = 0;
  assert.deepEqual(
    await getVenueAvailability('5', '2026-01-01T00:00:00.000Z', '2027-01-02T00:00:00.001Z', client),
    { outcome: 'invalid', message: 'The date range must not exceed 366 days.' }
  );
  assert.deepEqual(calls, []);
});

// --- getAllVenuesAvailability --------------------------------------------------

test('[NORMAL] [SG2-44:AC1] [SG2-44:AC2] queries every venue over the chosen range and groups sorted entries by venue', async () => {
  const calls: QueryCall[] = [];
  const client = fakeClient({
    venues: {
      data: [
        { venue_id: 1, name: 'Atrium' },
        { venue_id: 2, name: 'Rooftop' },
        { venue_id: 3, name: 'Empty Room' }
      ],
      error: null
    },
    venue_booking_occupancy: {
      data: [
        { venue_id: 1, starts_at: '2026-10-05T09:00:00.000Z', ends_at: '2026-10-05T12:00:00.000Z', status: 'held', event_id: null },
        { venue_id: 1, starts_at: '2026-10-01T09:00:00.000Z', ends_at: '2026-10-01T17:00:00.000Z', status: 'confirmed', event_id: 12 }
      ],
      error: null
    },
    venue_unavailability: {
      data: [
        { venue_id: 2, starts_at: '2026-10-03T00:00:00.000Z', ends_at: '2026-10-04T00:00:00.000Z', reason: 'Maintenance' }
      ],
      error: null
    }
  }, calls);

  const result = await getAllVenuesAvailability(FROM, TO, client);

  assert.deepEqual(calls.filter(call => call.table === 'venues' && call.method === 'order'), [
    { table: 'venues', method: 'order', args: ['name', { ascending: true }] }
  ]);
  for (const [table, from, to] of [['venue_booking_occupancy', WIDE_FROM, WIDE_TO], ['venue_unavailability', FROM, TO]]) {
    assert.deepEqual(calls.filter(call => call.table === table && ['eq', 'lt', 'gt'].includes(call.method)), [
      { table, method: 'lt', args: ['starts_at', to] },
      { table, method: 'gt', args: ['ends_at', from] }
    ]);
  }

  assert.deepEqual(result, {
    outcome: 'ok',
    venues: [
      {
        venueId: 1,
        name: 'Atrium',
        entries: [
          { start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T17:00:00.000Z', kind: 'booking', label: 'confirmed · event 12' },
          { start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T12:00:00.000Z', kind: 'booking', label: 'held' }
        ]
      },
      {
        venueId: 2,
        name: 'Rooftop',
        entries: [
          { start: '2026-10-03T00:00:00.000Z', end: '2026-10-04T00:00:00.000Z', kind: 'unavailable', label: 'Maintenance' }
        ]
      },
      { venueId: 3, name: 'Empty Room', entries: [] }
    ]
  });
});

test('[BOUNDARY] [SG2-44:AC1] all-venues read treats a null venue list as empty', async () => {
  const client = fakeClient({ venues: { data: null, error: null } });
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, client), { outcome: 'ok', venues: [] });
});

test('[BOUNDARY] [SG2-44:AC1] all-venues read treats null booking/unavailability data as empty', async () => {
  const client = fakeClient({
    venues: { data: [{ venue_id: 1, name: 'Atrium' }], error: null },
    venue_booking_occupancy: { data: null, error: null },
    venue_unavailability: { data: null, error: null }
  });
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, client), {
    outcome: 'ok',
    venues: [{ venueId: 1, name: 'Atrium', entries: [] }]
  });
});

test('[FAILURE] [SG2-44:AC1] all-venues read rejects an invalid range', async () => {
  assert.deepEqual(await getAllVenuesAvailability('not-a-date', TO, fakeClient({})), {
    outcome: 'invalid',
    message: 'from and to must be ISO 8601 date-times.'
  });
});

test('[FAILURE] [SG2-44:AC1] all-venues read is unavailable without a Supabase client', async () => {
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, null), { outcome: 'unavailable' });
});

test('[FAILURE] [SG2-44:AC1] all-venues read is unavailable when the venue list query fails', async () => {
  const client = fakeClient({ venues: { data: null, error: { message: 'boom' } } });
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, client), { outcome: 'unavailable' });
});

test('[FAILURE] [SG2-44:AC1] all-venues read is unavailable when the bookings query fails', async () => {
  const client = fakeClient({
    venues: { data: [], error: null },
    venue_booking_occupancy: { data: null, error: { message: 'boom' } }
  });
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, client), { outcome: 'unavailable' });
});

test('[FAILURE] [SG2-44:AC1] all-venues read is unavailable when the unavailability query fails', async () => {
  const client = fakeClient({
    venues: { data: [], error: null },
    venue_booking_occupancy: { data: [], error: null },
    venue_unavailability: { data: null, error: { message: 'boom' } }
  });
  assert.deepEqual(await getAllVenuesAvailability(FROM, TO, client), { outcome: 'unavailable' });
});

// --- createAvailabilityHandler ------------------------------------------------

function handlerApp(
  getAvailability: typeof getVenueAvailability,
  makeClient: (token: string) => SupabaseClient | null = () => ({}) as SupabaseClient
) {
  const app = express();
  app.get('/v/:venueId/availability', createAvailabilityHandler(getAvailability, makeClient));
  return app;
}

test('[NORMAL] [SG2-44:AC1] [SG2-44:AC2] handler passes the path, query, and caller-scoped client through and returns 200', async () => {
  const calls: { args?: unknown[]; token?: string } = {};
  const app = handlerApp(
    async (...args) => {
      calls.args = args;
      return { outcome: 'ok', entries: [{ start: 's', end: 'e', kind: 'booking', label: 'held' }] };
    },
    (token) => {
      calls.token = token;
      return { scoped: token } as unknown as SupabaseClient;
    }
  );

  const res = await request(app).get('/v/5/availability?from=A&to=B').set('Authorization', 'Bearer tok-123');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { venueId: 5, from: 'A', to: 'B', entries: [{ start: 's', end: 'e', kind: 'booking', label: 'held' }] });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(calls.token, 'tok-123');
  assert.deepEqual(calls.args, ['5', 'A', 'B', { scoped: 'tok-123' }]);
});

test('[FAILURE] [SG2-44:AC1] handler maps an invalid result to 400', async () => {
  const app = handlerApp(async () => ({ outcome: 'invalid', message: 'bad range' }));
  const res = await request(app).get('/v/5/availability').set('Authorization', 'Bearer tok');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'bad range' });
});

test('[FAILURE] [SG2-44:AC1] handler maps an unavailable result to 503', async () => {
  const app = handlerApp(async () => ({ outcome: 'unavailable' }));
  const res = await request(app).get('/v/5/availability').set('Authorization', 'Bearer tok');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'Venue availability is temporarily unavailable.' });
});

test('[FAILURE] [SG2-44:AC3] handler passes a null client when the request carries no bearer token', async () => {
  let clientArg: unknown = 'unset';
  let madeClient = false;
  const app = handlerApp(
    async (_venueId, _from, _to, client) => {
      clientArg = client;
      return { outcome: 'unavailable' };
    },
    () => {
      madeClient = true;
      return {} as SupabaseClient;
    }
  );

  const res = await request(app).get('/v/5/availability');
  assert.equal(res.status, 503);
  assert.equal(clientArg, null);
  assert.equal(madeClient, false);
});

test('[FAILURE] [SG2-44:AC3] handler ignores a non-bearer Authorization header', async () => {
  let clientArg: unknown = 'unset';
  const app = handlerApp(async (_venueId, _from, _to, client) => {
    clientArg = client;
    return { outcome: 'unavailable' };
  });

  const res = await request(app).get('/v/5/availability').set('Authorization', 'Basic nope');
  assert.equal(res.status, 503);
  assert.equal(clientArg, null);
});

// --- createAllVenuesAvailabilityHandler -----------------------------------

function allVenuesHandlerApp(
  getAvailability: typeof getAllVenuesAvailability,
  makeClient: (token: string) => SupabaseClient | null = () => ({}) as SupabaseClient
) {
  const app = express();
  app.get('/v/availability', createAllVenuesAvailabilityHandler(getAvailability, makeClient));
  return app;
}

test('[NORMAL] [SG2-44:AC1] all-venues handler passes query and caller-scoped client through and returns 200', async () => {
  const calls: { args?: unknown[]; token?: string } = {};
  const app = allVenuesHandlerApp(
    async (...args) => {
      calls.args = args;
      return { outcome: 'ok', venues: [{ venueId: 1, name: 'Atrium', entries: [] }] };
    },
    (token) => {
      calls.token = token;
      return { scoped: token } as unknown as SupabaseClient;
    }
  );

  const res = await request(app).get('/v/availability?from=A&to=B').set('Authorization', 'Bearer tok-123');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { from: 'A', to: 'B', venues: [{ venueId: 1, name: 'Atrium', entries: [] }] });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(calls.token, 'tok-123');
  assert.deepEqual(calls.args, ['A', 'B', { scoped: 'tok-123' }]);
});

test('[FAILURE] [SG2-44:AC1] all-venues handler maps an invalid result to 400', async () => {
  const app = allVenuesHandlerApp(async () => ({ outcome: 'invalid', message: 'bad range' }));
  const res = await request(app).get('/v/availability').set('Authorization', 'Bearer tok');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'bad range' });
});

test('[FAILURE] [SG2-44:AC1] all-venues handler maps an unavailable result to 503', async () => {
  const app = allVenuesHandlerApp(async () => ({ outcome: 'unavailable' }));
  const res = await request(app).get('/v/availability').set('Authorization', 'Bearer tok');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'Venue availability is temporarily unavailable.' });
});

test('[FAILURE] [SG2-44:AC3] all-venues handler passes a null client when the request carries no bearer token', async () => {
  let clientArg: unknown = 'unset';
  let madeClient = false;
  const app = allVenuesHandlerApp(
    async (_from, _to, client) => {
      clientArg = client;
      return { outcome: 'unavailable' };
    },
    () => {
      madeClient = true;
      return {} as SupabaseClient;
    }
  );

  const res = await request(app).get('/v/availability');
  assert.equal(res.status, 503);
  assert.equal(clientArg, null);
  assert.equal(madeClient, false);
});

// --- createVenueAvailabilityRouter + policy (SG2-44 AC3) -------------------------------

const userId = '10000000-0000-4000-8000-000000000001';
const originalConfig = { ...dbConfig };

beforeEach(() => {
  dbConfig.supabaseUrl = 'https://venue-test.supabase.co';
  dbConfig.supabaseAnonKey = 'sb_publishable_venue';
  dbConfig.supabaseServiceRoleKey = undefined;
});

afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
});

function appAs(role: string) {
  return createApp(
    undefined,
    createAuthorization({ resolvePrincipal: async () => ({ userId, role: role as never }) })
  );
}

test('[FAILURE] [SG2-44:AC3] the default availability router refuses unauthenticated requests to both routes', async () => {
  const app = express();
  app.use('/api/venues', createVenueAvailabilityRouter());
  for (const path of ['/api/venues/availability', '/api/venues/5/availability']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Authentication required' });
  }
});

test('[FAILURE] [SG2-44:AC3] unauthenticated availability requests are refused', async () => {
  const res = await request(appAs('event_coordinator')).get('/api/venues/5/availability');
  assert.equal(res.status, 401);
});

for (const role of ACCOUNT_ROLES) {
  test(`${['event_coordinator', 'venue_staff', 'technical_support_staff'].includes(role) ? '[NORMAL]' : '[FAILURE]'} [SG2-44:AC3] SG2-44: availability view obeys the policy for ${role}`, async () => {
    const allowed = ['event_coordinator', 'venue_staff', 'technical_support_staff'].includes(role);
    mock.method(globalThis, 'fetch', async () => Response.json([]));

    const res = await request(appAs(role))
      .get(`/api/venues/5/availability?from=${FROM}&to=${TO}`)
      .set('Authorization', 'Bearer verified-token');

    assert.equal(res.status, allowed ? 200 : 403);
    if (allowed) {
      assert.deepEqual(res.body, { venueId: 5, from: FROM, to: TO, entries: [] });
    }
  });
}

for (const role of ACCOUNT_ROLES) {
  test(`${['event_coordinator', 'venue_staff', 'technical_support_staff'].includes(role) ? '[NORMAL]' : '[FAILURE]'} [SG2-44:AC3] SG2-44: all-venues availability view obeys the policy for ${role}`, async () => {
    const allowed = ['event_coordinator', 'venue_staff', 'technical_support_staff'].includes(role);
    mock.method(globalThis, 'fetch', async () => Response.json([]));

    const res = await request(appAs(role))
      .get(`/api/venues/availability?from=${FROM}&to=${TO}`)
      .set('Authorization', 'Bearer verified-token');

    assert.equal(res.status, allowed ? 200 : 403);
    if (allowed) {
      assert.deepEqual(res.body, { from: FROM, to: TO, venues: [] });
    }
  });
}
