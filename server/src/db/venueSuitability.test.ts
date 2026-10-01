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
      for (const method of ['select', 'eq', 'in', 'order', 'maybeSingle', 'insert']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

const exception = { exception_id: 1, request_id: 31, approved_by: 'user-venue', approver_role: 'venue_staff',
  expected_attendance: 150, venue_capacity: 120, approved_at: '2030-06-01T00:00:00.000Z' };

test('SG2-47: the store reads one event and one booking request by id', async () => {
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

test('SG2-47: the store lists every venue in name order, or only the one asked for', async () => {
  const calls: Call[] = [];
  const store = createVenueSuitabilityStore(fakeAdmin({ venues: [{ data: [{ venue_id: 1 }], error: null }, { data: [], error: null }] }, calls));
  assert.deepEqual(await store.venues(), [{ venue_id: 1 }]);
  assert.deepEqual(await store.venues(3), []);
  assert.deepEqual(calls.filter(call => call.method === 'eq').map(call => call.args), [['venue_id', 3]]);
  assert.deepEqual(calls.filter(call => call.method === 'order').map(call => call.args[0]), ['name', 'venue_id', 'name', 'venue_id']);
});

test('SG2-47: exceptions come back with each approver\'s name, looked up once per approver', async () => {
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

test('SG2-47: recording an exception inserts the approval and returns it with the approver\'s name', async () => {
  const calls: Call[] = [];
  const store = createVenueSuitabilityStore(fakeAdmin({
    venue_capacity_exceptions: [{ data: exception, error: null }],
    users: [{ data: [{ user_id: 'user-venue', name: 'Vera' }], error: null }]
  }, calls));
  const values = { request_id: 31, approved_by: 'user-venue', approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120 };
  assert.deepEqual(await store.recordException(values), { ...exception, approver_name: 'Vera' });
  assert.deepEqual(calls.find(call => call.method === 'insert')?.args, [values]);
});

test('SG2-47: any database failure is reported as temporarily unavailable', async () => {
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
