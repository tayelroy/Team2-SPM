import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { COMMITTED_BOOKING_STATUSES, createVenueConflictStore } from './venueConflicts';

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
      for (const method of ['select', 'eq', 'in', 'lt', 'gt', 'order', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

const period = { venue_id: 1, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z' };
const options = { now: '2030-01-01T00:00:00.000Z', excludeRequestId: 41 };
const booking = { booking_id: 12, event_id: 9, starts_at: '2030-06-15T04:00:00.000Z', ends_at: '2030-06-15T06:00:00.000Z', status: 'confirmed' };
const hold = { hold_id: 3, event_id: 8, request_id: 50, starts_at: '2030-06-15T01:00:00.000Z', ends_at: '2030-06-15T03:00:00.000Z', status: 'tentative' };

const filters = (calls: Call[], table: string) => calls.filter(call => call.table === table && call.method !== 'select').map(call => [call.method, ...call.args]);

test('[NORMAL] [SG2-50:AC1] conflicts are the held or confirmed bookings and live holds overlapping the period at the venue, earliest first, with each event', async () => {
  const calls: Call[] = [];
  const store = createVenueConflictStore(fakeAdmin({
    venue_bookings: [{ data: [booking], error: null }],
    venue_holds: [{ data: [hold], error: null }],
    events: [{ data: [{ event_id: 9, name: 'Gala Night', coordinator_id: 'user-a' }, { event_id: 8, name: 'Partner Lunch', coordinator_id: 'user-b' }], error: null }]
  }, calls));
  assert.deepEqual(await store.conflicts(period, options), [
    { kind: 'hold', reference_id: 3, event_id: 8, event_name: 'Partner Lunch', coordinator_id: 'user-b', starts_at: hold.starts_at, ends_at: hold.ends_at, status: 'tentative' },
    { kind: 'booking', reference_id: 12, event_id: 9, event_name: 'Gala Night', coordinator_id: 'user-a', starts_at: booking.starts_at, ends_at: booking.ends_at, status: 'confirmed' }
  ]);
  // Strictly overlapping: a period that only touches another does not conflict.
  assert.deepEqual(filters(calls, 'venue_bookings'), [
    ['eq', 'venue_id', 1], ['in', 'status', ['held', 'confirmed']],
    ['lt', 'starts_at', period.ends_at], ['gt', 'ends_at', period.starts_at], ['order', 'starts_at']
  ]);
  assert.deepEqual(filters(calls, 'venue_holds'), [
    ['eq', 'venue_id', 1], ['eq', 'status', 'tentative'], ['gt', 'expires_at', options.now],
    ['lt', 'starts_at', period.ends_at], ['gt', 'ends_at', period.starts_at], ['order', 'starts_at']
  ]);
  assert.deepEqual(filters(calls, 'events'), [['in', 'event_id', [9, 8]]]);
});

test('[BOUNDARY] [SG2-50:AC3] only held and confirmed bookings and unexpired tentative holds count; the request\'s own hold does not', async () => {
  assert.deepEqual(COMMITTED_BOOKING_STATUSES, ['held', 'confirmed']);
  const calls: Call[] = [];
  const store = createVenueConflictStore(fakeAdmin({
    venue_bookings: [{ data: [], error: null }],
    venue_holds: [{ data: [{ ...hold, request_id: 41 }], error: null }]
  }, calls));
  assert.deepEqual(await store.conflicts(period, options), []);
  // Nothing left to name, so events are not read.
  assert.equal(calls.some(call => call.table === 'events'), false);
});

test('[NORMAL] [SG2-50:AC1] a booking with no event, or for an event since removed, is still reported without a name', async () => {
  const calls: Call[] = [];
  const store = createVenueConflictStore(fakeAdmin({
    venue_bookings: [{ data: [{ ...booking, event_id: null }, { ...booking, booking_id: 13, event_id: 77 }], error: null }],
    venue_holds: [{ data: [], error: null }],
    events: [{ data: [], error: null }]
  }, calls));
  const rows = await store.conflicts(period, { now: options.now });
  assert.deepEqual(rows.map(row => [row.reference_id, row.event_id, row.event_name, row.coordinator_id]), [[12, null, null, null], [13, 77, null, null]]);
  assert.deepEqual(filters(calls, 'events'), [['in', 'event_id', [77]]]);
  const unnamed = createVenueConflictStore(fakeAdmin({ venue_bookings: [{ data: [{ ...booking, event_id: null }], error: null }] }, calls));
  assert.deepEqual((await unnamed.conflicts(period, options)).map(row => row.reference_id), [12]);
});

test('[FAILURE] [SG2-50:AC1] any failed read is reported as temporarily unavailable', async () => {
  for (const tables of <Record<string, Result[]>[]>[
    { venue_bookings: [{ data: null, error: { message: 'down' } }] },
    { venue_holds: [{ data: null, error: { message: 'down' } }] },
    { venue_bookings: [{ data: [booking], error: null }], events: [{ data: null, error: { message: 'down' } }] }
  ]) {
    await assert.rejects(createVenueConflictStore(fakeAdmin(tables)).conflicts(period, options),
      (error: unknown) => error instanceof AccessError && error.status === 503);
  }
});

test('[NORMAL] [SG2-50:AC1] the request and its event are read as for venue suitability', async () => {
  const request = { request_id: 41, event_id: 7, venue_id: 1, starts_at: period.starts_at, ends_at: period.ends_at, status: 'pending' };
  const event = { event_id: 7, name: 'Leadership Forum' };
  const calls: Call[] = [];
  const store = createVenueConflictStore(fakeAdmin({
    venue_booking_requests: [{ data: request, error: null }],
    events: [{ data: event, error: null }]
  }, calls));
  assert.deepEqual(await store.request(41), request);
  assert.deepEqual(await store.event(7), event);
  assert.deepEqual(calls.filter(call => call.method === 'eq').map(call => [call.table, ...call.args]),
    [['venue_booking_requests', 'request_id', 41], ['events', 'event_id', 7]]);
});
