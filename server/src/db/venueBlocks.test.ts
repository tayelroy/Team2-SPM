import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { dbConfig } from './config';
import { createVenueBlockStore } from './venueBlocks';

const original = { ...dbConfig };
beforeEach(() => {
  dbConfig.supabaseUrl = 'https://venue-test.supabase.co';
  dbConfig.supabaseAnonKey = 'publishable-key';
  dbConfig.supabaseServiceRoleKey = 'NEVER_SEND_ADMIN';
});
afterEach(() => { mock.restoreAll(); Object.assign(dbConfig, original); });

const values = { starts_at: '2026-10-01T09:00:00.000Z', ends_at: '2026-10-01T17:00:00.000Z', category: 'maintenance' as const, reason: 'Carpet replacement' };
const affected = { booking_id: 7, event_id: 3, event_name: 'Gala Night', event_status: 'confirmed',
  starts_at: '2026-10-01T10:00:00+00:00', ends_at: '2026-10-01T12:00:00+00:00' };
const block = { unavailability_id: 4, ...values, created_at: '2026-09-26T00:00:00+00:00', created_by_name: 'Vera Staff', affected: [affected] };

type Call = { method: string; pathname: string; params: URLSearchParams; body?: unknown };

function stubFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://venue-test.supabase.co');
    assert.equal(headers.get('authorization'), 'Bearer staff-token');
    assert.equal(headers.get('apikey'), 'publishable-key');
    assert.equal(init?.redirect, 'error');
    const call = { method: init?.method ?? 'GET', pathname: url.pathname, params: url.searchParams,
      body: init?.body ? JSON.parse(init.body as string) : undefined };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

test('[NORMAL] [SG2-45:AC1] [SG2-80:AC6] list reads the venue\'s unended periods, with recorder and affected events, from the definer function', async () => {
  const calls = stubFetch(() => Response.json([block]));
  assert.deepEqual(await createVenueBlockStore('staff-token').list(1, '2026-09-26T00:00:00.000Z'), [block]);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].pathname, '/rest/v1/rpc/list_venue_unavailability');
  assert.deepEqual(calls[0].body, { p_venue_id: 1, p_after: '2026-09-26T00:00:00.000Z' });
});

test('[NORMAL] [SG2-80:AC2] [SG2-80:AC3] create inserts without checking for confirmed bookings, then reads back the flagged period', async () => {
  const calls = stubFetch(call => {
    if (call.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (call.pathname === '/rest/v1/venue_unavailability') return Response.json({ unavailability_id: 4 });
    return Response.json([{ ...block, unavailability_id: 3 }, block]);
  });
  assert.deepEqual(await createVenueBlockStore('staff-token').create(1, values), { outcome: 'created', block });
  assert.deepEqual(calls.map(call => `${call.method} ${call.pathname}`), [
    'GET /rest/v1/venues', 'POST /rest/v1/venue_unavailability', 'POST /rest/v1/rpc/list_venue_unavailability'
  ]);
  assert.deepEqual(calls[1].body, { venue_id: 1, ...values });
  assert.equal(calls[1].params.get('select'), 'unavailability_id');
  assert.deepEqual(calls[2].body, { p_venue_id: 1, p_after: values.starts_at });
});

test('[FAILURE] [SG2-45:AC1] create returns missing and never writes when the venue does not exist', async () => {
  const calls = stubFetch(() => Response.json(null));
  assert.deepEqual(await createVenueBlockStore('staff-token').create(999, values), { outcome: 'missing' });
  assert.equal(calls.length, 1);
});

test('[CONFLICT] [SG2-80:AC6] a period removed before it can be read back fails closed instead of reporting it saved', async () => {
  stubFetch(call => {
    if (call.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (call.pathname === '/rest/v1/venue_unavailability') return Response.json({ unavailability_id: 4 });
    return Response.json([]);
  });
  await assert.rejects(createVenueBlockStore('staff-token').create(1, values), { status: 503 });
});

test('[NORMAL] [SG2-45:AC3] remove deletes only that venue\'s block and reports whether one was removed', async () => {
  const calls = stubFetch(() => Response.json([{ unavailability_id: 4 }]));
  assert.equal(await createVenueBlockStore('staff-token').remove(1, 4), true);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].params.get('venue_id'), 'eq.1');
  assert.equal(calls[0].params.get('unavailability_id'), 'eq.4');
  mock.restoreAll();
  stubFetch(() => Response.json([]));
  assert.equal(await createVenueBlockStore('staff-token').remove(1, 4), false);
});

for (const status of [401, 403, 500]) test(`[FAILURE] [SG2-45:AC1] database error ${status} is mapped to a safe response`, async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ message: 'SECRET' }, { status }));
  const store = createVenueBlockStore('token');
  const expected = { status: status === 500 ? 503 : status };
  await assert.rejects(store.list(1, '2026-09-26T00:00:00.000Z'), expected);
  await assert.rejects(store.create(1, values), expected);
  await assert.rejects(store.remove(1, 4), expected);
});

test('[FAILURE] [SG2-25:AC2] [SG2-45:AC1] an insert refused by row level security is mapped to 403 and nothing is read back', async () => {
  const calls = stubFetch(call => call.pathname === '/rest/v1/venues'
    ? Response.json({ venue_id: 1 })
    : Response.json({ code: '42501', message: 'row-level security' }, { status: 403 }));
  await assert.rejects(createVenueBlockStore('staff-token').create(1, values), { status: 403 });
  assert.equal(calls.length, 2);
});

test('[FAILURE] [SG2-80:AC6] an error reading the saved period back is mapped to a safe response', async () => {
  stubFetch(call => {
    if (call.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (call.pathname === '/rest/v1/venue_unavailability') return Response.json({ unavailability_id: 4 });
    return Response.json({ message: 'SECRET' }, { status: 500 });
  });
  await assert.rejects(createVenueBlockStore('staff-token').create(1, values), { status: 503 });
});

for (const config of [{ supabaseUrl: undefined }, { supabaseAnonKey: undefined }, { supabaseUrl: 'http://example.com' }]) {
  test(`[FAILURE] [SG2-45:AC1] configuration never falls back to admin: ${Object.entries(config).map(([key, value]) => `${key}=${String(value)}`).join(', ')}`, () => {
    Object.assign(dbConfig, config);
    assert.throws(() => createVenueBlockStore('token'), { status: 503 });
  });
}
