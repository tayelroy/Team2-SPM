import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { AccessError, createAuthorization, type Role } from '../auth';
import type { VenueRecord } from '../venues/fields';
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

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-42:AC1] [SG2-42:AC2] [SG2-42:AC3] SG2-42 regression: production app persists staff edits through the adapter, coordinator reloads and searches them, revoked staff cannot write', async () => {
  const untouched = { venue_id: 7, ...values, name: 'Other hall' };
  let rows: VenueRecord[] = [untouched];
  let staffRole: Role = 'venue_staff';
  const calls: string[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.origin, 'https://venue-test.supabase.co');
    assert.ok(['Bearer staff-token', 'Bearer coordinator-token'].includes(headers.get('authorization')!));
    assert.equal(headers.get('apikey'), 'publishable-key');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    if (url.pathname !== '/rest/v1/venues') {
      assert.equal(headers.get('authorization'), 'Bearer coordinator-token');
      assert.equal(init?.method, 'GET');
      assert.ok(['/rest/v1/venue_layouts', '/rest/v1/venue_unavailability', '/rest/v1/venue_booking_occupancy', '/rest/v1/venue_operations'].includes(url.pathname));
      return Response.json([]);
    }
    assert.equal(url.searchParams.get('select'), 'venue_id,name,location,capacity,facilities,accessibility_features,operating_information');
    calls.push(init!.method!);
    if (init!.method === 'GET') {
      assert.ok(['name.asc,venue_id.asc', 'name.asc'].includes(url.searchParams.get('order')!));
      return Response.json(rows);
    }
    assert.equal(headers.get('authorization'), 'Bearer staff-token');
    const body = JSON.parse(init!.body as string);
    const id = init!.method === 'POST' ? 8 : Number(url.searchParams.get('venue_id')?.replace('eq.', ''));
    if (init!.method === 'POST') assert.equal(url.searchParams.has('venue_id'), false);
    else assert.equal(init!.method, 'PATCH');
    if (init!.method === 'PATCH' && !rows.some(row => row.venue_id === id)) return Response.json(null);
    const saved = { ...body, venue_id: id };
    rows = [...rows.filter(row => row.venue_id !== id), saved];
    return Response.json(saved);
  });
  const access = createAuthorization({ resolvePrincipal: async token => ({ userId: token,
    role: token === 'staff-token' ? staffRole : 'event_coordinator' }) });
  const app = createApp(undefined, access);
  const created = await request(app).post('/api/venues').set('Authorization', 'Bearer staff-token').send(values);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.venue, { ...values, venue_id: 8 });
  const changed = { name: 'Updated hall', location: 'West wing', capacity: 250, facilities: 'Projector',
    accessibility_features: 'Ramp', operating_information: 'Saturday only' };
  const updated = await request(app).put('/api/venues/8').set('Authorization', 'Bearer staff-token').send(changed);
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.venue, { ...changed, venue_id: 8 });
  const reloaded = await request(app).get('/api/venues').set('Authorization', 'Bearer coordinator-token');
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.headers['cache-control'], 'no-store');
  assert.deepEqual(reloaded.body.venues, [untouched, { ...changed, venue_id: 8 }]);
  const searched = await request(app).get('/api/venues/search')
    .set('Authorization', 'Bearer coordinator-token')
    .query({ from: '2030-06-15T09:00:00.000Z', to: '2030-06-15T10:00:00.000Z', attendance: 200, location: 'West wing' });
  assert.equal(searched.status, 200);
  assert.deepEqual(searched.body, { venues: [{ venue_id: 8, ...changed, layouts: [], held: [] }] });
  assert.equal((await request(app).put('/api/venues/999').set('Authorization', 'Bearer staff-token').send(values)).status, 404);
  assert.deepEqual(calls, ['POST', 'PATCH', 'GET', 'GET', 'PATCH']);
  staffRole = 'event_coordinator';
  for (const token of ['staff-token', 'coordinator-token']) {
    for (const method of ['post', 'put'] as const) {
      const response = await request(app)[method](`/api/venues${method === 'put' ? '/8' : ''}`)
        .set('Authorization', `Bearer ${token}`).send(values);
      assert.equal(response.status, 403);
    }
  }
  // Denied requests must never reach Supabase, even with the same token after a role change.
  assert.equal(calls.length, 5);
  assert.deepEqual(rows, [untouched, { ...changed, venue_id: 8 }]);
});

test('[FAILURE] [SG2-42:AC1] [SG2-42:AC3] failed transport returns 503; writes are not retried and attempts receive a five-second timeout', async () => {
  const controller = new AbortController();
  const timeout = mock.method(AbortSignal, 'timeout', () => controller.signal);
  const transport = mock.method(globalThis, 'fetch', async (_input: unknown, _init?: RequestInit) => {
    throw new DOMException('Connection timed out', 'TimeoutError');
  });
  const store = createVenueStore('token');
  await assert.rejects(store.list(), { status: 503 });
  const readAttempts = transport.mock.callCount();
  await assert.rejects(store.save(values), { status: 503 });
  assert.ok(readAttempts >= 1);
  assert.equal(transport.mock.callCount(), readAttempts + 1);
  for (const call of transport.mock.calls) assert.equal(call.arguments[1]?.signal, controller.signal);
  for (const call of timeout.mock.calls) assert.deepEqual(call.arguments, [5000]);
  assert.equal(timeout.mock.callCount(), transport.mock.callCount());
});

for (const status of [401, 403, 500]) test(`[FAILURE] [SG2-42:AC1] [SG2-42:AC3] database error ${status} is mapped to a safe response`, async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ message: 'SECRET' }, { status }));
  const store = createVenueStore('token');
  await assert.rejects(store.list(), { status: status === 500 ? 503 : status });
  await assert.rejects(store.save(values), { status: status === 500 ? 503 : status });
});

for (const config of [{ supabaseUrl: undefined }, { supabaseAnonKey: undefined }, { supabaseUrl: 'http://example.com' }]) {
  test(`[FAILURE] [SG2-42:AC1] [SG2-42:AC3] configuration never falls back to admin: ${Object.entries(config).map(([key, value]) => `${key}=${String(value)}`).join(', ')}`, () => {
    Object.assign(dbConfig, config);
    assert.throws(() => createVenueStore('token'), { status: 503 });
  });
}

test('[NORMAL] [FAILURE] [SG2-106:AC1] [SG2-106:AC2] [SG2-106:AC5] reads and edits skip deleted venues, and delete goes through one RPC under the caller token', async () => {
  const seen: string[] = [];
  const replies: [number, unknown][] = [[200, { outcome: 'blocked', blockers: [] }], [403, { code: '42501', message: 'Access denied' }],
    [400, { code: '42501', message: 'Access denied' }], [500, { code: 'XX000', message: 'SECRET' }], [200, null], [401, { message: 'jwt' }]];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer staff-token');
    if (url.pathname === '/rest/v1/venues') {
      seen.push(`${init!.method} ${url.searchParams.get('deleted_at')}`);
      return init!.method === 'GET' ? Response.json([]) : new Response(null, { status: 204 });
    }
    assert.equal(url.pathname, '/rest/v1/rpc/delete_venue');
    assert.equal(init!.method, 'POST');
    assert.deepEqual(JSON.parse(init!.body as string), { p_venue_id: 4 });
    const [status, body] = replies.shift()!;
    return new Response(body === null ? 'null' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  const store = createVenueStore('staff-token');
  await store.list();
  assert.equal(await store.save(values, 4), null);
  assert.deepEqual(seen, ['GET is.null', 'PATCH is.null']);
  assert.deepEqual(await store.remove(4), { outcome: 'blocked', blockers: [] });
  for (const status of [403, 403, 503, 503, 401]) {
    await assert.rejects(store.remove(4), failure => failure instanceof AccessError && failure.status === status && !/SECRET/.test(failure.message));
  }
});
