import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { dbConfig } from './config';
import { createVenueStore } from './venues';

const original = { ...dbConfig };
const values = { name: 'Atrium', location: 'Level 1', capacity: 100, facilities: 'Stage', accessibility_features: 'Lift', operating_information: 'Weekdays' };
beforeEach(() => {
  dbConfig.supabaseUrl = 'https://venue-test.supabase.co';
  dbConfig.supabaseAnonKey = 'publishable-key';
  dbConfig.supabaseServiceRoleKey = 'NEVER_SEND_ADMIN';
});
afterEach(() => { mock.restoreAll(); Object.assign(dbConfig, original); });

test('read, create and update carry caller identity, public key, column allowlist and timeout', async () => {
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://venue-test.supabase.co');
    assert.equal(url.pathname, '/rest/v1/venues');
    assert.equal(headers.get('authorization'), 'Bearer staff-token');
    assert.equal(headers.get('apikey'), 'publishable-key');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    assert.match(url.searchParams.get('select')!, /^venue_id,name,/);
    calls.push(init!.method!);
    if (init!.method === 'GET') {
      assert.equal(url.searchParams.get('order'), 'name.asc,venue_id.asc');
      return Response.json([{ venue_id: 1, ...values }]);
    }
    assert.deepEqual(JSON.parse(init!.body as string), values);
    if (init!.method === 'PATCH') assert.equal(url.searchParams.get('venue_id'), 'eq.1');
    return Response.json({ venue_id: 1, ...values });
  });
  const store = createVenueStore('staff-token');
  assert.deepEqual(await store.list(), [{ venue_id: 1, ...values }]);
  assert.deepEqual(await store.save(values), { venue_id: 1, ...values });
  assert.deepEqual(await store.save(values, 1), { venue_id: 1, ...values });
  assert.deepEqual(calls, ['GET', 'POST', 'PATCH']);
});

for (const status of [401, 403, 500]) test(`database error ${status} is mapped to a safe response`, async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ message: 'SECRET' }, { status }));
  const store = createVenueStore('token');
  await assert.rejects(store.list(), { status: status === 500 ? 503 : status });
  await assert.rejects(store.save(values), { status: status === 500 ? 503 : status });
});

for (const config of [{ supabaseUrl: undefined }, { supabaseAnonKey: undefined }, { supabaseUrl: 'http://example.com' }]) {
  test(`configuration never falls back to admin: ${Object.entries(config).map(([key, value]) => `${key}=${String(value)}`).join(', ')}`, () => {
    Object.assign(dbConfig, config);
    assert.throws(() => createVenueStore('token'), { status: 503 });
  });
}
