import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createVenueBookingReleaseStore, createVenueBookingStore } from './venueBookings';

type Result = { data?: unknown; error?: unknown; status?: number };
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
      for (const method of ['select', 'eq', 'in', 'gt', 'order', 'maybeSingle']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

const row = { booking_id: 11, venue_id: 1, event_id: 7, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z',
  status: 'cancelled', cancelled_by: 'user-venue', cancelled_at: '2030-01-01T00:00:00.000Z', cancellation_reason: 'Burst pipe' };
const filters = (calls: Call[], table: string) => calls.filter(call => call.table === table && call.method !== 'select').map(call => [call.method, ...call.args]);

test('[NORMAL] [SG2-51:AC3] [SG2-51:AC5] an event\'s confirmed and released bookings come with venue, event and releaser by name', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingStore(fakeAdmin({
    venue_bookings: [{ data: [row, { ...row, booking_id: 12, venue_id: 2, status: 'confirmed', cancelled_by: null, cancelled_at: null, cancellation_reason: null }], error: null }],
    venues: [{ data: [{ venue_id: 1, name: 'Atrium Hall' }, { venue_id: 2, name: 'Annex' }], error: null }],
    events: [{ data: [{ event_id: 7, name: 'Leadership Summit' }], error: null }],
    users: [{ data: [{ user_id: 'user-venue', name: 'Vera' }], error: null }]
  }, calls));
  const { cancelled_by: _by, ...visible } = row;
  assert.deepEqual(await store.forEvent(7), [
    { ...visible, venue_name: 'Atrium Hall', event_name: 'Leadership Summit', canceller_name: 'Vera' },
    { ...visible, booking_id: 12, venue_id: 2, status: 'confirmed', cancelled_at: null, cancellation_reason: null,
      venue_name: 'Annex', event_name: 'Leadership Summit', canceller_name: null }
  ]);
  assert.deepEqual(filters(calls, 'venue_bookings'), [['eq', 'event_id', 7], ['in', 'status', ['confirmed', 'cancelled']], ['order', 'starts_at'], ['order', 'booking_id']]);
  assert.deepEqual(filters(calls, 'users'), [['in', 'user_id', ['user-venue']]]);
});

test('[BOUNDARY] [SG2-51:AC2] a venue lists only bookings that end after now; with none, no names are looked up', async () => {
  const calls: Call[] = [];
  const store = createVenueBookingStore(fakeAdmin({ venue_bookings: [{ data: [], error: null }] }, calls));
  assert.deepEqual(await store.forVenue(1, '2030-01-01T00:00:00.000Z'), []);
  assert.deepEqual(filters(calls, 'venue_bookings'), [
    ['eq', 'venue_id', 1], ['in', 'status', ['confirmed', 'cancelled']], ['gt', 'ends_at', '2030-01-01T00:00:00.000Z'], ['order', 'starts_at'], ['order', 'booking_id']
  ]);
  assert.deepEqual([...new Set(calls.map(call => call.table))], ['venue_bookings']);
});

test('[NORMAL] [SG2-51:AC1] a booking with no event and no releaser is listed without names; venues and events are read as for suitability', async () => {
  const store = createVenueBookingStore(fakeAdmin({
    venue_bookings: [{ data: [{ ...row, event_id: null, status: 'confirmed', cancelled_by: null }], error: null }],
    venues: [{ data: [], error: null }, { data: [{ venue_id: 1, name: 'Atrium Hall' }], error: null }, { data: [], error: null }],
    events: [{ data: { event_id: 7, name: 'Leadership Summit' }, error: null }]
  }));
  const [listed] = await store.forVenue(1, '2030-01-01T00:00:00.000Z');
  assert.deepEqual([listed.venue_name, listed.event_name, listed.canceller_name], [null, null, null]);
  assert.equal(await store.venueExists(1), true);
  assert.equal(await store.venueExists(9), false);
  assert.deepEqual(await store.event(7), { event_id: 7, name: 'Leadership Summit' });
});

test('[FAILURE] [SG2-51:AC1] any failed read is reported as temporarily unavailable', async () => {
  const down = { data: null, error: { message: 'down' } };
  for (const [tables, read] of [
    [{ venue_bookings: [down] }, 'event'],
    [{ venue_bookings: [down] }, 'venue'],
    [{ venue_bookings: [{ data: [row], error: null }], users: [down] }, 'event']
  ] as const) {
    const store = createVenueBookingStore(fakeAdmin(tables as unknown as Record<string, Result[]>));
    await assert.rejects(read === 'event' ? store.forEvent(7) : store.forVenue(1, 'now'),
      (error: unknown) => error instanceof AccessError && error.status === 503);
  }
});

test('[NORMAL] [SG2-51:AC1] [SG2-51:AC5] a release is one database call made with the caller\'s own token', async () => {
  const calls: unknown[] = [];
  const client = { rpc: async (...args: unknown[]) => { calls.push(args); return { data: { outcome: 'released', booking_id: 11, cancelled_at: 'now' }, error: null, status: 200 }; } };
  let token = '';
  const store = createVenueBookingReleaseStore('staff-token', given => { token = given; return client as unknown as SupabaseClient; });
  assert.deepEqual(await store.release(11, 'Burst pipe'), { outcome: 'released', booking_id: 11, cancelled_at: 'now' });
  assert.equal(token, 'staff-token');
  assert.deepEqual(calls, [['release_venue_booking', { p_booking_id: 11, p_reason: 'Burst pipe' }]]);
});

test('[FAILURE] [SG2-51:AC1] database refusals become sign-in, permission or availability errors without the database text', async () => {
  const cases: [Result, number][] = [
    [{ data: null, error: { message: 'jwt expired' }, status: 401 }, 401],
    [{ data: null, error: { message: 'denied' }, status: 403 }, 403],
    [{ data: null, error: { code: '42501', message: 'Access denied' }, status: 400 }, 403],
    [{ data: null, error: { message: 'offline' }, status: 500 }, 503],
    [{ data: null, error: null, status: 200 }, 503]
  ];
  for (const [result, status] of cases) {
    const store = createVenueBookingReleaseStore('t', () => ({ rpc: async () => result }) as unknown as SupabaseClient);
    await assert.rejects(store.release(11, 'x'), (error: unknown) => error instanceof AccessError && error.status === status);
  }
  assert.throws(() => createVenueBookingReleaseStore('t', () => null), (error: unknown) => error instanceof AccessError && error.status === 503);
});
