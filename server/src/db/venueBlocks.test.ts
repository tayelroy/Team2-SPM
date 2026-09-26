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

const values = { starts_at: '2026-10-01T09:00:00.000Z', ends_at: '2026-10-01T17:00:00.000Z', reason: 'Carpet replacement' };
const block = { unavailability_id: 4, ...values };
const booking = { booking_id: 7, event_id: 3, starts_at: '2026-10-01T10:00:00+00:00', ends_at: '2026-10-01T12:00:00+00:00' };

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

test('SG2-45: list reads the venue\'s blocks that have not yet ended, earliest first', async () => {
  const calls = stubFetch(() => Response.json([block]));
  assert.deepEqual(await createVenueBlockStore('staff-token').list(1, '2026-09-26T00:00:00.000Z'), [block]);
  assert.equal(calls[0].pathname, '/rest/v1/venue_unavailability');
  assert.equal(calls[0].params.get('select'), 'unavailability_id,starts_at,ends_at,reason');
  assert.equal(calls[0].params.get('venue_id'), 'eq.1');
  assert.equal(calls[0].params.get('ends_at'), 'gt.2026-09-26T00:00:00.000Z');
  assert.equal(calls[0].params.get('order'), 'starts_at.asc');
});

test('create confirms the venue, finds no confirmed overlap, then inserts the block', async () => {
  const calls = stubFetch(call => {
    if (call.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (call.pathname === '/rest/v1/venue_bookings') return Response.json([]);
    return Response.json(block);
  });
  assert.deepEqual(await createVenueBlockStore('staff-token').create(1, values), { outcome: 'created', block });
  assert.deepEqual(calls.map(call => `${call.method} ${call.pathname}`), [
    'GET /rest/v1/venues', 'GET /rest/v1/venue_bookings', 'POST /rest/v1/venue_unavailability'
  ]);
  const overlap = calls[1].params;
  assert.equal(overlap.get('venue_id'), 'eq.1');
  assert.equal(overlap.get('status'), 'eq.confirmed');
  assert.equal(overlap.get('starts_at'), `lt.${values.ends_at}`);
  assert.equal(overlap.get('ends_at'), `gt.${values.starts_at}`);
  assert.deepEqual(calls[2].body, { venue_id: 1, ...values });
});

test('create refuses a period overlapping a confirmed booking without inserting', async () => {
  const calls = stubFetch(call => call.pathname === '/rest/v1/venues' ? Response.json({ venue_id: 1 }) : Response.json([booking]));
  assert.deepEqual(await createVenueBlockStore('staff-token').create(1, values), { outcome: 'conflict', booking });
  assert.equal(calls.length, 2);
});

test('create returns missing and never writes when the venue does not exist', async () => {
  const calls = stubFetch(() => Response.json(null));
  assert.deepEqual(await createVenueBlockStore('staff-token').create(999, values), { outcome: 'missing' });
  assert.equal(calls.length, 1);
});

test('a booking confirmed between the check and the insert is named from the database trigger\'s refusal', async () => {
  let bookingReads = 0;
  stubFetch(call => {
    if (call.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (call.pathname === '/rest/v1/venue_bookings') return Response.json(bookingReads++ === 0 ? [] : [booking]);
    return Response.json({ code: '23P01', message: 'overlap' }, { status: 409 });
  });
  assert.deepEqual(await createVenueBlockStore('staff-token').create(1, values), { outcome: 'conflict', booking });
});

test('a trigger refusal whose booking can no longer be found fails closed', async () => {
  stubFetch(call => {
    if (call.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (call.pathname === '/rest/v1/venue_bookings') return Response.json([]);
    return Response.json({ code: '23P01', message: 'overlap' }, { status: 409 });
  });
  await assert.rejects(createVenueBlockStore('staff-token').create(1, values), { status: 503 });
});

test('remove deletes only that venue\'s block and reports whether one was removed', async () => {
  const calls = stubFetch(() => Response.json([{ unavailability_id: 4 }]));
  assert.equal(await createVenueBlockStore('staff-token').remove(1, 4), true);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].params.get('venue_id'), 'eq.1');
  assert.equal(calls[0].params.get('unavailability_id'), 'eq.4');
  mock.restoreAll();
  stubFetch(() => Response.json([]));
  assert.equal(await createVenueBlockStore('staff-token').remove(1, 4), false);
});

for (const status of [401, 403, 500]) test(`database error ${status} is mapped to a safe response`, async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ message: 'SECRET' }, { status }));
  const store = createVenueBlockStore('token');
  const expected = { status: status === 500 ? 503 : status };
  await assert.rejects(store.list(1, '2026-09-26T00:00:00.000Z'), expected);
  await assert.rejects(store.create(1, values), expected);
  await assert.rejects(store.remove(1, 4), expected);
});

test('an insert refused by row level security is mapped to 403, not treated as a booking conflict', async () => {
  const calls = stubFetch(call => {
    if (call.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (call.pathname === '/rest/v1/venue_bookings') return Response.json([]);
    return Response.json({ code: '42501', message: 'row-level security' }, { status: 403 });
  });
  await assert.rejects(createVenueBlockStore('staff-token').create(1, values), { status: 403 });
  assert.equal(calls.length, 3);
});

test('an error while checking for a confirmed booking is mapped to a safe response', async () => {
  stubFetch(call => call.pathname === '/rest/v1/venues'
    ? Response.json({ venue_id: 1 })
    : Response.json({ message: 'SECRET' }, { status: 500 }));
  await assert.rejects(createVenueBlockStore('staff-token').create(1, values), { status: 503 });
});

for (const config of [{ supabaseUrl: undefined }, { supabaseAnonKey: undefined }, { supabaseUrl: 'http://example.com' }]) {
  test(`configuration never falls back to admin: ${Object.entries(config).map(([key, value]) => `${key}=${String(value)}`).join(', ')}`, () => {
    Object.assign(dbConfig, config);
    assert.throws(() => createVenueBlockStore('token'), { status: 503 });
  });
}
