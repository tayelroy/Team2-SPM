import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createVenueBookingRequestStore } from './venueBookingRequests';

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
      for (const method of ['select', 'eq', 'in', 'not', 'lt', 'gt', 'order', 'range', 'maybeSingle', 'insert']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

const row = { request_id: 41, event_id: 7, venue_id: 1, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z',
  status: 'pending', layout: 'theatre', venue_requirements: 'A stage', requested_by: 'user-coordinator', requested_at: '2030-01-01T00:00:00.000Z',
  decided_by: null, decided_at: null, decision_reason: null };
const { requested_by: _requester, decided_by: _decider, ...visible } = row;
const values = { event_id: 7, venue_id: 1, starts_at: row.starts_at, ends_at: row.ends_at, layout: 'theatre' as const,
  venue_requirements: 'A stage', requested_by: 'user-coordinator' };

test('[NORMAL] [SG2-48:AC1] [SG2-48:AC3] making a request inserts only the request and returns it with the venue and requester by name; venue_bookings is never touched', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingRequestStore(fakeAdmin({
    venue_booking_requests: [{ data: row, error: null }],
    venues: [{ data: [{ venue_id: 1, name: 'Atrium Hall' }], error: null }],
    users: [{ data: [{ user_id: 'user-coordinator', name: 'Casey' }], error: null }]
  }, calls));
  assert.deepEqual(await store.create(values), { ...visible, venue_name: 'Atrium Hall', requester_name: 'Casey', decider_name: null });
  assert.deepEqual(calls.find(call => call.method === 'insert')?.args, [values]);
  assert.deepEqual([...new Set(calls.map(call => call.table))], ['venue_booking_requests', 'venues', 'users']);
});

test('[NORMAL] [SG2-48:AC4] a duplicate is a live coordinator request from the same event for the same venue over an overlapping period', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingRequestStore(fakeAdmin({
    venue_booking_requests: [{ data: [row], error: null }, { data: [], error: null }],
    venues: [{ data: [{ venue_id: 1, name: 'Atrium Hall' }], error: null }],
    users: [{ data: [{ user_id: 'user-coordinator', name: 'Casey' }], error: null }]
  }, calls));
  assert.equal((await store.duplicate(values))?.request_id, 41);
  assert.equal(await store.duplicate({ ...values, venue_id: 2 }), null);
  const filters = calls.filter(call => call.table === 'venue_booking_requests' && ['eq', 'in', 'not', 'lt', 'gt', 'range'].includes(call.method));
  // A tentative hold's own request (SG2-84) has no requester and is not compared.
  assert.deepEqual(filters.slice(0, 7).map(call => [call.method, ...call.args]), [
    ['eq', 'event_id', 7], ['eq', 'venue_id', 1], ['in', 'status', ['pending', 'approved']], ['not', 'requested_by', 'is', null],
    ['lt', 'starts_at', row.ends_at], ['gt', 'ends_at', row.starts_at], ['range', 0, 0]
  ]);
});

test('[NORMAL] [SG2-48:AC3] an event\'s requests are listed earliest first; earlier rows without a requester or venue name still list', async () => {
  const calls: Call[] = [];
  const legacy = { ...row, request_id: 12, venue_id: 9, requested_by: null, layout: null };
  const store = createVenueBookingRequestStore(fakeAdmin({
    venue_booking_requests: [{ data: [legacy, row], error: null }, { data: [legacy], error: null }, { data: [], error: null }],
    venues: [{ data: [{ venue_id: 1, name: 'Atrium Hall' }], error: null }, { data: [], error: null }],
    users: [{ data: [{ user_id: 'user-coordinator', name: 'Casey' }], error: null }]
  }, calls));
  const listed = await store.list(7);
  assert.deepEqual(listed.map(item => [item.request_id, item.venue_name, item.requester_name]), [[12, null, null], [41, 'Atrium Hall', 'Casey']]);
  assert.deepEqual(calls.find(call => call.table === 'users' && call.method === 'in')?.args, ['user_id', ['user-coordinator']]);
  assert.deepEqual(calls.filter(call => call.table === 'venue_booking_requests' && call.method === 'order').map(call => call.args[0]), ['requested_at', 'request_id']);
  // A list with no requester at all does not look any up.
  assert.deepEqual((await store.list(8)).map(item => item.requester_name), [null]);
  assert.equal(calls.filter(call => call.table === 'users' && call.method === 'select').length, 1);
  assert.deepEqual(await store.list(9), []);
});

test('[NORMAL] [SG2-48:AC1] [SG2-48:request-store] the event, the venue and the venue\'s layouts are read by id', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingRequestStore(fakeAdmin({
    events: [{ data: { event_id: 7 }, error: null }],
    venues: [{ data: [{ venue_id: 1 }], error: null }, { data: [], error: null }],
    venue_layouts: [{ data: [{ layout: 'theatre' }, { layout: 'banquet' }], error: null }]
  }, calls));
  assert.deepEqual(await store.event(7), { event_id: 7 });
  assert.deepEqual(await store.venue(1), { venue_id: 1 });
  assert.equal(await store.venue(99), null);
  assert.deepEqual(await store.layouts(1), ['theatre', 'banquet']);
  assert.deepEqual(calls.filter(call => call.method === 'eq').map(call => [call.table, ...call.args]), [
    ['events', 'event_id', 7], ['venues', 'venue_id', 1], ['venues', 'venue_id', 99], ['venue_layouts', 'venue_id', 1]
  ]);
});

test('[CONFLICT] [SG2-48:AC4] the same request made twice at once is refused by the database and reported as a duplicate, not a failure', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingRequestStore(fakeAdmin({
    venue_booking_requests: [{ data: null, error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } }]
  }, calls));
  assert.equal(await store.create(values), null);
  assert.equal(calls.filter(call => call.table !== 'venue_booking_requests').length, 0);
});

test('[FAILURE] [SG2-48:AC1] [SG2-48:request-unavailable] any database failure is reported as temporarily unavailable', async () => {
  const failure = { data: null, error: { message: 'offline' } };
  const attempts: [string, Record<string, Result[]>, (store: ReturnType<typeof createVenueBookingRequestStore>) => Promise<unknown>][] = [
    ['layouts', { venue_layouts: [failure] }, store => store.layouts(1)],
    ['duplicate', { venue_booking_requests: [failure] }, store => store.duplicate(values)],
    ['insert', { venue_booking_requests: [failure] }, store => store.create(values)],
    ['insert without a row', { venue_booking_requests: [{ data: null, error: null }] }, store => store.create(values)],
    ['list', { venue_booking_requests: [failure] }, store => store.list(7)],
    ['venue names', { venue_booking_requests: [{ data: [row], error: null }], venues: [failure] }, store => store.list(7)],
    ['requester names', { venue_booking_requests: [{ data: [row], error: null }], venues: [{ data: [], error: null }], users: [failure] }, store => store.list(7)]
  ];
  for (const [name, tables, attempt] of attempts) {
    await assert.rejects(attempt(createVenueBookingRequestStore(fakeAdmin(tables))), (error: unknown) => error instanceof AccessError && error.status === 503, name);
  }
});

test('[NORMAL] [SG2-49:AC2] [SG2-49:AC3] one request is read with its decision, decider and reason; requester and decider are looked up together', async () => {
  const calls: Call[] = [];
  const rejected = { ...row, status: 'rejected', decided_by: 'user-venue', decided_at: '2030-01-02T00:00:00.000Z', decision_reason: 'Rewiring' };
  const store = createVenueBookingRequestStore(fakeAdmin({
    venue_booking_requests: [{ data: rejected, error: null }, { data: null, error: null }],
    venues: [{ data: [{ venue_id: 1, name: 'Atrium Hall' }], error: null }],
    users: [{ data: [{ user_id: 'user-coordinator', name: 'Casey' }, { user_id: 'user-venue', name: 'Vera' }], error: null }]
  }, calls));
  assert.deepEqual(await store.request(41), { ...visible, status: 'rejected', decided_at: '2030-01-02T00:00:00.000Z', decision_reason: 'Rewiring',
    venue_name: 'Atrium Hall', requester_name: 'Casey', decider_name: 'Vera' });
  assert.deepEqual(calls.find(call => call.table === 'users' && call.method === 'in')?.args, ['user_id', ['user-coordinator', 'user-venue']]);
  assert.equal(await store.request(99), null);
});

test('[NORMAL] [SG2-49:AC1] a request\'s tentative hold, if any, and its capacity exceptions are read by request id', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingRequestStore(fakeAdmin({
    venue_holds: [{ data: { hold_id: 12 }, error: null }, { data: null, error: null }],
    venue_capacity_exceptions: [{ data: [], error: null }]
  }, calls));
  assert.equal(await store.hold(41), 12);
  assert.equal(await store.hold(42), null);
  assert.deepEqual(await store.exceptions(41), []);
  assert.deepEqual(calls.filter(call => call.method === 'eq').map(call => [call.table, ...call.args]),
    [['venue_holds', 'request_id', 41], ['venue_holds', 'request_id', 42], ['venue_capacity_exceptions', 'request_id', 41]]);
});

test('[FAILURE] [SG2-49:AC3] a failure reading a request or its hold is reported as temporarily unavailable', async () => {
  const failure = { data: null, error: { message: 'offline' } };
  const attempts: [string, Record<string, Result[]>, (store: ReturnType<typeof createVenueBookingRequestStore>) => Promise<unknown>][] = [
    ['request', { venue_booking_requests: [failure] }, store => store.request(41)],
    ['hold', { venue_holds: [failure] }, store => store.hold(41)]
  ];
  for (const [name, tables, attempt] of attempts) {
    await assert.rejects(attempt(createVenueBookingRequestStore(fakeAdmin(tables))), (error: unknown) => error instanceof AccessError && error.status === 503, name);
  }
});

test('[NORMAL] [SG2-50:AC1] the request store reads conflicts from the venue\'s bookings and holds', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingRequestStore(fakeAdmin({
    venue_bookings: [{ data: [{ booking_id: 12, event_id: null, starts_at: row.starts_at, ends_at: row.ends_at, status: 'confirmed' }], error: null }]
  }, calls));
  const conflicts = await store.conflicts(row, { now: '2030-01-01T00:00:00.000Z', excludeRequestId: 41 });
  assert.deepEqual(conflicts.map(conflict => [conflict.kind, conflict.reference_id]), [['booking', 12]]);
  assert.deepEqual([...new Set(calls.map(call => call.table))], ['venue_bookings', 'venue_holds']);
});
