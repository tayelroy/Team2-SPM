import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createVenueClashStore } from './venueClashes';

type Result = { data?: unknown; error?: unknown };
type Call = { table: string; method: string; args: unknown[] };

/** Chainable, thenable stand-in for the PostgREST query builder. Each table
 * answers its queries in turn from the results given for it. */
function fakeAdmin(tables: Record<string, Result[]>, calls: Call[] = []): SupabaseClient {
  return {
    from(table: string) {
      const result = tables[table]?.shift() ?? { data: [], error: null };
      const builder: Record<string, unknown> = { then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve) };
      for (const method of ['select', 'in', 'order']) {
        builder[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return builder; };
      }
      return builder;
    }
  } as unknown as SupabaseClient;
}

const pair = { booking_id: 11, other_booking_id: 12, venue_id: 1, flagged_at: '2030-01-01T00:00:00.000Z' };
const summit = { booking_id: 11, venue_id: 1, event_id: 7, starts_at: '2030-10-01T02:00:00.000Z', ends_at: '2030-10-01T04:00:00.000Z' };
const forum = { booking_id: 12, venue_id: 1, event_id: 8, starts_at: '2030-10-01T04:30:00.000Z', ends_at: '2030-10-01T05:30:00.000Z' };

test('[NORMAL] [SG2-79:AC3] each flagged pair is listed from both bookings\' sides, with venue, event and coordinator, earliest first', async () => {
  const calls: Call[] = [];
  const store = createVenueClashStore(fakeAdmin({
    venue_booking_clashes: [{ data: [pair], error: null }],
    venue_bookings: [{ data: [forum, summit], error: null }],
    events: [{ data: [{ event_id: 7, name: 'Morning Summit', coordinator_id: 'c1' }, { event_id: 8, name: 'Afternoon Forum', coordinator_id: 'c2' }], error: null }],
    venues: [{ data: [{ venue_id: 1, name: 'Clash Hall' }], error: null }]
  }, calls));
  const a = { ...summit, venue_name: 'Clash Hall', event_name: 'Morning Summit', coordinator_id: 'c1' };
  const b = { ...forum, venue_name: 'Clash Hall', event_name: 'Afternoon Forum', coordinator_id: 'c2' };
  assert.deepEqual(await store.list(), [
    { booking: a, clashes_with: b, flagged_at: pair.flagged_at },
    { booking: b, clashes_with: a, flagged_at: pair.flagged_at }
  ]);
  assert.deepEqual(calls.filter(call => call.method === 'in').map(call => [call.table, ...call.args]), [
    ['venue_bookings', 'booking_id', [11, 12]], ['events', 'event_id', [8, 7]], ['venues', 'venue_id', [1]]
  ]);
});

test('[BOUNDARY] [SG2-79:AC3] with nothing flagged no bookings are read; a booking with no event is listed without a name', async () => {
  const calls: Call[] = [];
  assert.deepEqual(await createVenueClashStore(fakeAdmin({ venue_booking_clashes: [{ data: [], error: null }] }, calls)).list(), []);
  assert.deepEqual([...new Set(calls.map(call => call.table))], ['venue_booking_clashes']);
  const legacy = createVenueClashStore(fakeAdmin({
    venue_booking_clashes: [{ data: [pair], error: null }],
    venue_bookings: [{ data: [{ ...summit, event_id: null }, { ...forum, event_id: null }], error: null }],
    venues: [{ data: [], error: null }]
  }));
  const [first] = await legacy.list();
  assert.deepEqual([first.booking.event_name, first.booking.coordinator_id, first.booking.venue_name], [null, null, null]);
});

test('[CONFLICT] [SG2-79:AC5] a flag whose booking was removed between the two reads is left out', async () => {
  const store = createVenueClashStore(fakeAdmin({
    venue_booking_clashes: [{ data: [pair], error: null }],
    venue_bookings: [{ data: [summit], error: null }]
  }));
  assert.deepEqual(await store.list(), []);
});

test('[FAILURE] [SG2-79:AC3] any failed read is reported as temporarily unavailable', async () => {
  const down = { data: null, error: { message: 'down' } };
  for (const tables of <Record<string, Result[]>[]>[
    { venue_booking_clashes: [down] },
    { venue_booking_clashes: [{ data: [pair], error: null }], venue_bookings: [down] },
    { venue_booking_clashes: [{ data: [pair], error: null }], venue_bookings: [{ data: [summit, forum], error: null }], events: [down] }
  ]) {
    await assert.rejects(createVenueClashStore(fakeAdmin(tables)).list(), (error: unknown) => error instanceof AccessError && error.status === 503);
  }
});

test('[BOUNDARY] [SG2-79:AC3] bookings starting at the same moment are listed by booking number', async () => {
  // Two venues, each with a clashing pair whose first booking starts at 10:00.
  const store = createVenueClashStore(fakeAdmin({
    venue_booking_clashes: [{ data: [{ ...pair, booking_id: 21, other_booking_id: 22 }, pair], error: null }],
    venue_bookings: [{ data: [summit, forum, { ...summit, booking_id: 21, venue_id: 2 }, { ...forum, booking_id: 22, venue_id: 2 }], error: null }]
  }));
  assert.deepEqual((await store.list()).map(row => row.booking.booking_id), [11, 21, 12, 22]);
});
