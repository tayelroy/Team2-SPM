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

test('[NORMAL] [SG2-43:AC1] SG2-43: replace deletes the venue\'s rows then inserts the new set, after confirming the venue exists', async () => {
  const calls: { method: string; pathname: string; query: URLSearchParams; body?: unknown }[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://venue-test.supabase.co');
    assert.equal(headers.get('authorization'), 'Bearer staff-token');
    assert.equal(headers.get('apikey'), 'publishable-key');
    assert.equal(init?.redirect, 'error');
    calls.push({ method: init!.method ?? 'GET', pathname: url.pathname, query: url.searchParams, body: init?.body ? JSON.parse(init.body as string) : undefined });
    if (url.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    if (init!.method === 'DELETE') return Response.json([]);
    return Response.json([{ layout: 'classroom', other_description: null }, { layout: 'other', other_description: 'U-shape' }]);
  });
  const store = createVenueLayoutStore('staff-token');
  const result = await store.replace(1, [{ layout: 'classroom' }, { layout: 'other', other_description: 'U-shape' }]);
  assert.deepEqual(result, [{ layout: 'classroom', other_description: null }, { layout: 'other', other_description: 'U-shape' }]);
  assert.deepEqual(calls.map(call => [call.method, call.pathname]), [
    ['GET', '/rest/v1/venues'], ['DELETE', '/rest/v1/venue_layouts'], ['POST', '/rest/v1/venue_layouts']
  ]);
  assert.equal(calls[0].query.get('venue_id'), 'eq.1');
  assert.equal(calls[1].query.get('venue_id'), 'eq.1');
  assert.deepEqual(calls[2].body, [
    { venue_id: 1, layout: 'classroom', other_description: null },
    { venue_id: 1, layout: 'other', other_description: 'U-shape' }
  ]);
});

test('[BOUNDARY] [SG2-43:AC1] replace with an empty set deletes existing rows and returns without inserting', async () => {
  const calls: [string, string, string | null][] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    calls.push([init?.method ?? 'GET', url.pathname, url.searchParams.get('venue_id')]);
    if (url.pathname === '/rest/v1/venues') return Response.json({ venue_id: 1 });
    return Response.json([]);
  });
  const store = createVenueLayoutStore('staff-token');
  assert.deepEqual(await store.replace(1, []), []);
  assert.deepEqual(calls, [['GET', '/rest/v1/venues', 'eq.1'], ['DELETE', '/rest/v1/venue_layouts', 'eq.1']]);
});

test('[FAILURE] [SG2-43:AC1] replace returns null and never writes when the venue does not exist', async () => {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    calls.push(init?.method ?? 'GET');
    return Response.json(null);
  });
  const store = createVenueLayoutStore('staff-token');
  assert.equal(await store.replace(999, [{ layout: 'classroom' }]), null);
  assert.deepEqual(calls, ['GET']);
});

for (const status of [401, 403, 500]) test(`[FAILURE] [SG2-43:AC1] [SG2-43:AC2] database error ${status} is mapped to a safe response`, async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ message: 'SECRET' }, { status }));
  const store = createVenueLayoutStore('token');
  await assert.rejects(store.list(1), { status: status === 500 ? 503 : status });
  await assert.rejects(store.replace(1, []), { status: status === 500 ? 503 : status });
});

for (const stage of ['DELETE', 'POST'] as const) {
  test(`[FAILURE] [SG2-43:AC1] [SG2-43:AC2] replacement ${stage} failures stop subsequent writes and hide provider details`, async () => {
    for (const status of [401, 403, 500]) {
      const calls: string[] = [];
      mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        calls.push(method);
        if (method === 'GET') {
          assert.equal(url.pathname, '/rest/v1/venues');
          assert.equal(url.searchParams.get('venue_id'), 'eq.7');
          return Response.json({ venue_id: 7 });
        }
        assert.equal(url.pathname, '/rest/v1/venue_layouts');
        if (method === 'DELETE') assert.equal(url.searchParams.get('venue_id'), 'eq.7');
        if (method === stage) return Response.json({ message: 'PRIVATE_LAYOUT_DETAIL' }, { status });
        assert.equal(method, 'DELETE');
        return Response.json([]);
      });
      await assert.rejects(createVenueLayoutStore('staff-token').replace(7, [{ layout: 'classroom' }]),
        (error: unknown) => error instanceof Error && 'status' in error
          && error.status === (status === 500 ? 503 : status) && !error.message.includes('PRIVATE_LAYOUT_DETAIL'));
      assert.deepEqual(calls, stage === 'DELETE' ? ['GET', 'DELETE'] : ['GET', 'DELETE', 'POST']);
      mock.restoreAll();
    }
  });
}

for (const config of [{ supabaseUrl: undefined }, { supabaseAnonKey: undefined }, { supabaseUrl: 'http://example.com' }]) {
  test(`[FAILURE] [SG2-43:AC1] configuration never falls back to admin: ${Object.entries(config).map(([key, value]) => `${key}=${String(value)}`).join(', ')}`, () => {
    Object.assign(dbConfig, config);
    assert.throws(() => createVenueLayoutStore('token'), { status: 503 });
  });
}
