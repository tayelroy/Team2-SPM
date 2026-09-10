import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization, ROLES } from './auth';
import { dbConfig } from './db/config';
import {
  createAvailabilityHandler,
  createVenuesRouter,
  getVenueAvailability
} from './venues/availability';

const FROM = '2026-10-01T00:00:00.000Z';
const TO = '2026-10-31T00:00:00.000Z';

type TableResult = { data?: unknown; error?: unknown };

/** Minimal stand-in for the PostgREST query builder used by getVenueAvailability. */
function fakeClient(tables: Record<string, TableResult>): SupabaseClient {
  return {
    from(table: string) {
      const result = tables[table] ?? { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'lt', 'gt']) {
        builder[method] = () => builder;
      }
      builder.order = () => Promise.resolve(result);
      return builder;
    }
  } as unknown as SupabaseClient;
}

// --- getVenueAvailability -------------------------------------------------------

test('merges bookings and unavailability into one list sorted by start', async () => {
  const client = fakeClient({
    venue_bookings: {
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
  });

  const result = await getVenueAvailability(7, FROM, TO, client);

  assert.deepEqual(result, {
    outcome: 'ok',
    entries: [
      { start: '2026-10-01T09:00:00.000Z', end: '2026-10-01T17:00:00.000Z', kind: 'booking', label: 'confirmed · event 12' },
      { start: '2026-10-03T00:00:00.000Z', end: '2026-10-04T00:00:00.000Z', kind: 'unavailable', label: 'Maintenance' },
      { start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T12:00:00.000Z', kind: 'booking', label: 'held' }
    ]
  });
});

test('keeps entries that share a start instant', async () => {
  const client = fakeClient({
    venue_bookings: {
      data: [{ starts_at: '2026-10-05T09:00:00.000Z', ends_at: '2026-10-05T10:00:00.000Z', status: 'held', event_id: null }],
      error: null
    },
    venue_unavailability: {
      data: [{ starts_at: '2026-10-05T09:00:00.000Z', ends_at: '2026-10-05T11:00:00.000Z', reason: 'Deep clean' }],
      error: null
    }
  });

  const result = await getVenueAvailability('5', FROM, TO, client);
  assert.equal(result.outcome === 'ok' && result.entries.length, 2);
});

test('returns an empty list when nothing overlaps the range', async () => {
  const client = fakeClient({
    venue_bookings: { data: null, error: null },
    venue_unavailability: { data: null, error: null }
  });
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, client), { outcome: 'ok', entries: [] });
});

test('is unavailable when the bookings query fails', async () => {
  const client = fakeClient({
    venue_bookings: { data: null, error: { message: 'boom' } },
    venue_unavailability: { data: [], error: null }
  });
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, client), { outcome: 'unavailable' });
});

test('is unavailable when the unavailability query fails', async () => {
  const client = fakeClient({
    venue_bookings: { data: [], error: null },
    venue_unavailability: { data: null, error: { message: 'boom' } }
  });
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, client), { outcome: 'unavailable' });
});

test('is unavailable without a Supabase client', async () => {
  assert.deepEqual(await getVenueAvailability('5', FROM, TO, null), { outcome: 'unavailable' });
});

for (const badId of ['0', '-1', '3.5', 'abc', '', 5.5, 0, -2, null, undefined, {}]) {
  test(`rejects a non-positive-integer venue id: ${JSON.stringify(badId)}`, async () => {
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
  test(`rejects non ISO date-times: ${JSON.stringify([from, to])}`, async () => {
    assert.deepEqual(await getVenueAvailability('5', from, to, fakeClient({})), {
      outcome: 'invalid',
      message: 'from and to must be ISO 8601 date-times.'
    });
  });
}

for (const [from, to] of [[TO, TO], [TO, FROM]]) {
  test(`rejects a non-increasing range: ${JSON.stringify([from, to])}`, async () => {
    assert.deepEqual(await getVenueAvailability('5', from, to, fakeClient({})), {
      outcome: 'invalid',
      message: 'from must be earlier than to.'
    });
  });
}

test('rejects a range longer than 366 days', async () => {
  assert.deepEqual(
    await getVenueAvailability('5', '2026-01-01T00:00:00.000Z', '2027-06-01T00:00:00.000Z', fakeClient({})),
    { outcome: 'invalid', message: 'The date range must not exceed 366 days.' }
  );
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

test('handler passes the path, query, and caller-scoped client through and returns 200', async () => {
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

test('handler maps an invalid result to 400', async () => {
  const app = handlerApp(async () => ({ outcome: 'invalid', message: 'bad range' }));
  const res = await request(app).get('/v/5/availability').set('Authorization', 'Bearer tok');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'bad range' });
});

test('handler maps an unavailable result to 503', async () => {
  const app = handlerApp(async () => ({ outcome: 'unavailable' }));
  const res = await request(app).get('/v/5/availability').set('Authorization', 'Bearer tok');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'Venue availability is temporarily unavailable.' });
});

test('handler passes a null client when the request carries no bearer token', async () => {
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

test('handler ignores a non-bearer Authorization header', async () => {
  let clientArg: unknown = 'unset';
  const app = handlerApp(async (_venueId, _from, _to, client) => {
    clientArg = client;
    return { outcome: 'unavailable' };
  });

  const res = await request(app).get('/v/5/availability').set('Authorization', 'Basic nope');
  assert.equal(res.status, 503);
  assert.equal(clientArg, null);
});

// --- createVenuesRouter + policy (SG2-44 AC3) -------------------------------

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
    undefined,
    createAuthorization({ resolvePrincipal: async () => ({ userId, role: role as never }) })
  );
}

test('venues router defaults to the shared authorization instance', () => {
  assert.equal(typeof createVenuesRouter(), 'function');
});

test('unauthenticated availability requests are refused', async () => {
  const res = await request(appAs('event_coordinator')).get('/api/venues/5/availability');
  assert.equal(res.status, 401);
});

for (const role of ROLES) {
  test(`SG2-44: availability view obeys the policy for ${role}`, async () => {
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
