import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createVenueSuitabilityStore } from './venueSuitability';

type Result = { data?: unknown; error?: unknown };
type Call = { table: string; method: string; args: unknown[] };

/** Chainable, thenable stand-in for the PostgREST query builder. Each table
 * answers its queries in turn from the results given for it. */
function fakeAdmin(tables: Record<string, Result[]>, calls: Call[] = []): SupabaseClient {
  return {
    from(table: string) {
      const result = tables[table]?.shift() ?? { data: [], error: null };
      const builder: Record<string, unknown> = {
        then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve)
      };
      for (const method of ['select', 'eq', 'is', 'in', 'order', 'range', 'maybeSingle', 'insert']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

const exception = { exception_id: 1, request_id: 31, approved_by: 'user-venue', approver_role: 'venue_staff',
  expected_attendance: 150, venue_capacity: 120, approved_at: '2030-06-01T00:00:00.000Z' };

test('[NORMAL] [SG2-47:AC3] [SG2-66:AC2] [SG2-66:AC5] capacity discovery reads pending and booked requests with each approver\'s role in its named-FK database query', async () => {
  const calls: Call[] = [];
  const row = { request_id: 31, event: { organiser_id: 'owner' }, venue: { name: 'Theatre' }, venue_booking: null, exceptions: [] };
  const store = createVenueSuitabilityStore(fakeAdmin({ venue_booking_requests: [{ data: [row], error: null }] }, calls));
  assert.deepEqual(await store.capacityCandidates(), [row]);
  assert.deepEqual(calls.filter(call => call.method === 'eq').map(call => call.args), []);
  assert.deepEqual(calls.filter(call => call.method === 'in').map(call => call.args), [['status', ['pending', 'approved']]]);
  const selection = String(calls.find(call => call.method === 'select')!.args[0]);
  assert.match(selection, /venue_booking:venue_bookings!venue_booking_requests_venue_booking_id_fkey\(status\)/);
  assert.match(selection, /event:events!venue_booking_requests_event_id_fkey!inner\(/);
  assert.match(selection, /venue:venues!venue_booking_requests_venue_id_fkey!inner\(/);
  assert.match(selection, /exceptions:venue_capacity_exceptions!venue_capacity_exceptions_request_id_fkey\(expected_attendance,approver_role\)/);
  assert.deepEqual(calls.find(call => call.method === 'range')!.args, [0, 999]);
});

test('[BOUNDARY] [SG2-47:AC3] staff discovery reads beyond the default thousand-row database page', async () => {
  const calls: Call[] = [];
  const first = Array.from({ length: 1000 }, (_, index) => ({ request_id: index + 1 }));
  const store = createVenueSuitabilityStore(fakeAdmin({ venue_booking_requests: [
    { data: first, error: null }, { data: [{ request_id: 1001 }], error: null }
  ] }, calls));
  assert.deepEqual((await store.capacityCandidates()).map(row => row.request_id), Array.from({ length: 1001 }, (_, index) => index + 1));
  assert.deepEqual(calls.filter(call => call.method === 'range').map(call => call.args), [[0, 999], [1000, 1999]]);
  assert.deepEqual(calls.filter(call => call.method === 'order').map(call => call.args), [['request_id'], ['request_id']]);
});

test('[FAILURE] [SG2-47:AC3] missing rows or a failed capacity-worklist read never return a partial successful list', async () => {
  for (const result of [{ data: null, error: null }, { data: null, error: { message: 'PRIVATE database details' } }]) {
    await assert.rejects(createVenueSuitabilityStore(fakeAdmin({ venue_booking_requests: [result] })).capacityCandidates(),
      (error: unknown) => error instanceof AccessError && error.status === 503);
  }
});

test('[NORMAL] [SG2-47:suitability-store] the store reads one event and one booking request by id', async () => {
  const calls: Call[] = [];
  const event = { event_id: 7 };
  const store = createVenueSuitabilityStore(fakeAdmin({
    events: [{ data: event, error: null }, { data: null, error: null }],
    venue_booking_requests: [{ data: { request_id: 31 }, error: null }]
  }, calls));
  assert.deepEqual(await store.event(7), event);
  assert.equal(await store.event(8), null);
  assert.deepEqual(await store.request(31), { request_id: 31 });
  assert.deepEqual(calls.filter(call => call.method === 'eq').map(call => call.args), [['event_id', 7], ['event_id', 8], ['request_id', 31]]);
});

test('[NORMAL] [SG2-47:suitability-store] the store lists every venue in name order, or only the one asked for', async () => {
  const calls: Call[] = [];
  const store = createVenueSuitabilityStore(fakeAdmin({ venues: [{ data: [{ venue_id: 1 }], error: null }, { data: [], error: null }] }, calls));
  assert.deepEqual(await store.venues(), [{ venue_id: 1 }]);
  assert.deepEqual(await store.venues(3), []);
  assert.deepEqual(calls.filter(call => call.method === 'eq').map(call => call.args), [['venue_id', 3]]);
  assert.deepEqual(calls.filter(call => call.method === 'order').map(call => call.args[0]), ['name', 'venue_id', 'name', 'venue_id']);
});

test('[NORMAL] [SG2-47:AC3] exceptions come back with each approver\'s name, looked up once per approver', async () => {
  const calls: Call[] = [];
  const store = createVenueSuitabilityStore(fakeAdmin({
    venue_capacity_exceptions: [{ data: [exception, { ...exception, exception_id: 2 }, { ...exception, exception_id: 3, approved_by: 'user-gone' }], error: null }, { data: [], error: null }],
    users: [{ data: [{ user_id: 'user-venue', name: 'Vera' }], error: null }]
  }, calls));
  const records = await store.exceptions(31);
  assert.deepEqual(records.map(record => record.approver_name), ['Vera', 'Vera', null]);
  assert.deepEqual(calls.find(call => call.method === 'in')?.args, ['user_id', ['user-venue', 'user-gone']]);
  assert.deepEqual(await store.exceptions(32), []);
  assert.equal(calls.filter(call => call.table === 'users' && call.method === 'select').length, 1);
});

test('[NORMAL] [SG2-47:AC3] recording an exception inserts the approval and returns it with the approver\'s name', async () => {
  const calls: Call[] = [];
  const store = createVenueSuitabilityStore(fakeAdmin({
    venue_capacity_exceptions: [{ data: exception, error: null }],
    users: [{ data: [{ user_id: 'user-venue', name: 'Vera' }], error: null }]
  }, calls));
  const values = { request_id: 31, approved_by: 'user-venue', approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120 };
  assert.deepEqual(await store.recordException(values), { ...exception, approver_name: 'Vera' });
  assert.deepEqual(calls.find(call => call.method === 'insert')?.args, [values]);
});

test('[CONFLICT] [SG2-47:AC3] an approval already recorded by a concurrent approver is reported as a duplicate, not a failure', async () => {
  const calls: Call[] = [];
  const store = createVenueSuitabilityStore(fakeAdmin({
    venue_capacity_exceptions: [{ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }]
  }, calls));
  const values = { request_id: 31, approved_by: 'user-other-venue', approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120 };
  assert.equal(await store.recordException(values), null);
  assert.equal(calls.filter(call => call.table === 'users').length, 0);
});

test('[FAILURE] [SG2-47:suitability-unavailable] any database failure is reported as temporarily unavailable', async () => {
  const failure = { data: null, error: { message: 'offline' } };
  const values = { request_id: 31, approved_by: 'user-venue', approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120 };
  const attempts: [string, Record<string, Result[]>, (store: ReturnType<typeof createVenueSuitabilityStore>) => Promise<unknown>][] = [
    ['event', { events: [failure] }, store => store.event(7)],
    ['venues', { venues: [failure] }, store => store.venues()],
    ['request', { venue_booking_requests: [failure] }, store => store.request(31)],
    ['exceptions', { venue_capacity_exceptions: [failure] }, store => store.exceptions(31)],
    ['approver names', { venue_capacity_exceptions: [{ data: [exception], error: null }], users: [failure] }, store => store.exceptions(31)],
    ['insert', { venue_capacity_exceptions: [failure] }, store => store.recordException(values)],
    ['insert without a row', { venue_capacity_exceptions: [{ data: null, error: null }] }, store => store.recordException(values)]
  ];
  for (const [name, tables, attempt] of attempts) {
    await assert.rejects(attempt(createVenueSuitabilityStore(fakeAdmin(tables))), (error: unknown) => error instanceof AccessError && error.status === 503, name);
  }
});

test('[NORMAL] [BOUNDARY] [SG2-106:AC2] deleted venues are left out of suggestions and new bookings, but a past request still finds its venue by ID', async () => {
  const calls: Call[] = [];
  const store = createVenueSuitabilityStore(fakeAdmin({}, calls));
  await store.venues();
  await store.venues(4);
  await store.venues(4, true);
  const filters = calls.filter(call => call.table === 'venues' && ['is', 'eq'].includes(call.method)).map(call => [call.method, ...call.args]);
  assert.deepEqual(filters, [['is', 'deleted_at', null], ['is', 'deleted_at', null], ['eq', 'venue_id', 4], ['eq', 'venue_id', 4]]);
});
