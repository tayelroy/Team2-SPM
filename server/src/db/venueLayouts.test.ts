import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { dbConfig } from './config';
import { createVenueLayoutStore } from './venueLayouts';

const original = { ...dbConfig };
beforeEach(() => {
  dbConfig.supabaseUrl = 'https://venue-test.supabase.co';
  dbConfig.supabaseAnonKey = 'publishable-key';
  dbConfig.supabaseServiceRoleKey = 'NEVER_SEND_ADMIN';
});
afterEach(() => { mock.restoreAll(); Object.assign(dbConfig, original); });

test('SG2-43: replace deletes the venue\'s rows then inserts the new set, after confirming the venue exists', async () => {
  const calls: { method: string; pathname: string; body?: unknown }[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://venue-test.supabase.co');
    assert.equal(headers.get('authorization'), 'Bearer staff-token');
    assert.equal(headers.get('apikey'), 'publishable-key');
    assert.equal(init?.redirect, 'error');
    calls.push({ method: init!.method ?? 'GET', pathname: url.pathname, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (init!.method === 'DELETE') return Response.json([]);
    return Response.json([{ layout: 'classroom', other_description: null }, { layout: 'other', other_description: 'U-shape' }]);
  });
  const store = createVenueLayoutStore('staff-token');
  const result = await store.replace(1, [{ layout: 'classroom' }, { layout: 'other', other_description: 'U-shape' }]);
  assert.deepEqual(result, [{ layout: 'classroom', other_description: null }, { layout: 'other', other_description: 'U-shape' }]);
  assert.deepEqual(calls.map(call => call.method), ['GET', 'DELETE', 'POST']);
  assert.deepEqual(calls[2].body, [
    { venue_id: 1, layout: 'classroom', other_description: null },
    { venue_id: 1, layout: 'other', other_description: 'U-shape' }
  ]);
});

test('replace with an empty set deletes existing rows and returns without inserting', async () => {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    calls.push(init?.method ?? 'GET');
    if (url.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    return Response.json([]);
  });
  const store = createVenueLayoutStore('staff-token');
  assert.deepEqual(await store.replace(1, []), []);
  assert.deepEqual(calls, ['GET', 'DELETE']);
});

test('replace returns null and never writes when the venue does not exist', async () => {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    calls.push(init?.method ?? 'GET');
    return Response.json(null);
  });
  const store = createVenueLayoutStore('staff-token');
  assert.equal(await store.replace(999, [{ layout: 'classroom' }]), null);
  assert.deepEqual(calls, ['GET']);
});

for (const status of [401, 403, 500]) test(`database error ${status} is mapped to a safe response`, async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ message: 'SECRET' }, { status }));
  const store = createVenueLayoutStore('token');
  await assert.rejects(store.list(1), { status: status === 500 ? 503 : status });
  await assert.rejects(store.replace(1, []), { status: status === 500 ? 503 : status });
});

for (const config of [{ supabaseUrl: undefined }, { supabaseAnonKey: undefined }, { supabaseUrl: 'http://example.com' }]) {
  test(`configuration never falls back to admin: ${Object.entries(config).map(([key, value]) => `${key}=${String(value)}`).join(', ')}`, () => {
    Object.assign(dbConfig, config);
    assert.throws(() => createVenueLayoutStore('token'), { status: 503 });
  });
}
