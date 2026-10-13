import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEventArrangementFacts } from './eventArrangements';

/**
 * A fake Supabase client recording selected fields and filters. The event filter
 * is recorded under the table name, any other filter under `table.column`.
 * A table without a response reads as empty.
 */
function fakeClient(responses: Record<string, { data: unknown; error: unknown }>, captured: Record<string, unknown>) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          captured[`${table}.columns`] = columns;
          const chain = {
            eq(col: string, val: unknown) {
              captured[col === 'event_id' ? table : `${table}.${col}`] = val;
              return chain;
            },
            then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
              return Promise.resolve(responses[table] ?? { data: [], error: null }).then(resolve, reject);
            }
          };
          return chain;
        }
      };
    }
  } as unknown as SupabaseClient;
}

describe('Event arrangement facts DB operations (SG2-57)', () => {
  test('[NORMAL] [SG2-57:AC1] [SG2-39:AC2] [SG2-55:AC4] [SG2-58:AC1] reads venue and equipment rows and marks each request reserved or not', async () => {
    const captured: Record<string, unknown> = {};
    const client = fakeClient(
      {
        venue_booking_requests: {
          data: [
            { request_id: 1, status: 'approved', venue_booking_id: 21 },
            { request_id: 2, status: 'pending', venue_booking_id: null }
          ],
          error: null
        },
        venue_holds: { data: [], error: null },
        venue_bookings: { data: [{ booking_id: 21 }], error: null },
        equipment_requests: {
          data: [
            { request_id: 551, status: 'approved', shortfall: 0, placement_venue_id: 7 },
            { request_id: 552, status: 'pending', shortfall: 0, placement_venue_id: 7 }
          ],
          error: null
        },
        // PostgREST may serialise a bigint request_id as a string.
        equipment_reservations: { data: [{ request_id: '551' }], error: null }
      },
      captured
    );

    const result = await fetchEventArrangementFacts(client, 101);

    assert.equal(captured.venue_booking_requests, 101);
    assert.equal(captured['venue_booking_requests.columns'], 'request_id, status, venue_booking_id');
    assert.equal(captured.venue_holds, 101);
    assert.equal(captured['venue_holds.columns'], 'request_id, booking_id');
    assert.equal(captured.venue_bookings, 101);
    assert.equal(captured['venue_bookings.columns'], 'booking_id');
    assert.equal(captured['venue_bookings.status'], 'confirmed');
    assert.equal(captured.equipment_requests, 101);
    assert.equal(captured.equipment_reservations, 101);
    assert.equal(captured['equipment_requests.columns'], 'request_id, status, shortfall, placement_venue_id');
    assert.equal(captured['equipment_reservations.columns'], 'request_id');
    assert.deepEqual(result, {
      ok: true,
      facts: {
        venue_requests: [{ status: 'approved', booked: true }, { status: 'pending', booked: false }],
        equipment_requests: [
          { status: 'approved', shortfall: 0, placement_venue_id: 7, reserved: true },
          { status: 'pending', shortfall: 0, placement_venue_id: 7, reserved: false }
        ],
        equipment_reserved: true
      }
    });
  });

  test('[BOUNDARY] [SG2-57:AC2] [SG2-39:AC2] missing rows come back as empty arrays, not null', async () => {
    for (const data of [null, []]) {
      const client = fakeClient(
        {
          venue_booking_requests: { data: null, error: null },
          venue_holds: { data: null, error: null },
          venue_bookings: { data: null, error: null },
          equipment_requests: { data: null, error: null },
          equipment_reservations: { data, error: null }
        },
        {}
      );

      const result = await fetchEventArrangementFacts(client, 101);

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.facts.venue_requests, []);
        assert.deepEqual(result.facts.equipment_requests, []);
        assert.equal(result.facts.equipment_reserved, false);
      }
    }
  });

  test('[NORMAL] [SG2-39:AC2] [SG2-55:AC4] [SG2-58:AC2] an unlinked legacy reservation counts as a reservation but reserves no request', async () => {
    const captured: Record<string, unknown> = {};
    const client = fakeClient({
      venue_booking_requests: { data: [], error: null },
      equipment_requests: { data: [{ request_id: 9, status: 'pending', shortfall: 0, placement_venue_id: 1 }], error: null },
      // Legacy rows have no link, so they prove existence but reserve nothing.
      equipment_reservations: { data: [{ request_id: null }], error: null }
    }, captured);
    assert.deepEqual(await fetchEventArrangementFacts(client, 42), {
      ok: true,
      facts: {
        venue_requests: [],
        equipment_requests: [{ status: 'pending', shortfall: 0, placement_venue_id: 1, reserved: false }],
        equipment_reserved: true
      }
    });
    assert.equal(captured.equipment_reservations, 42);
    assert.equal(captured['equipment_reservations.columns'], 'request_id');
  });

  test('[FAILURE] [SG2-39:AC2] [SG2-55:AC4] a failed reservation existence query makes arrangement facts unavailable', async () => {
    const client = fakeClient({
      venue_booking_requests: { data: [], error: null },
      equipment_requests: { data: [], error: null },
      equipment_reservations: { data: null, error: { message: 'Reservation query failed' } }
    }, {});
    assert.deepEqual(await fetchEventArrangementFacts(client, 101), {
      ok: false, reason: 'unavailable', message: 'Reservation query failed'
    });
  });

  test('[FAILURE] [SG2-57:AC1] a venue query error is reported as unavailable', async () => {
    const client = fakeClient(
      {
        venue_booking_requests: { data: null, error: { message: 'boom' } },
        equipment_requests: { data: [], error: null }
      },
      {}
    );

    const result = await fetchEventArrangementFacts(client, 101);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
    }
  });

  test('[FAILURE] [SG2-57:AC1] an equipment query error is reported as unavailable', async () => {
    const client = fakeClient(
      {
        venue_booking_requests: { data: [], error: null },
        equipment_requests: { data: null, error: { message: 'boom' } }
      },
      {}
    );

    const result = await fetchEventArrangementFacts(client, 101);

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
    }
  });

  test('[CONFLICT] [SG2-58:AC2] a venue request is booked only while a confirmed booking is linked directly or through its converted hold', async () => {
    const captured: Record<string, unknown> = {};
    const client = fakeClient({
      venue_booking_requests: {
        data: [
          // Converted from a hold: the booking is recorded on the hold only.
          { request_id: 31, status: 'approved', venue_booking_id: null },
          // Decided directly, then released: the booking is no longer confirmed.
          { request_id: 32, status: 'approved', venue_booking_id: 42 },
          // Converted from a hold, then released.
          { request_id: 33, status: 'approved', venue_booking_id: null },
          // Approved with no booking at all.
          { request_id: 34, status: 'approved', venue_booking_id: null },
          // PostgREST may serialise bigint ids as strings.
          { request_id: '35', status: 'approved', venue_booking_id: '45' }
        ],
        error: null
      },
      venue_holds: {
        data: [
          { request_id: 31, booking_id: 44 },
          { request_id: '31', booking_id: '41' },
          { request_id: 33, booking_id: 43 },
          { request_id: null, booking_id: 41 },
          { request_id: 34, booking_id: null }
        ],
        error: null
      },
      // Only confirmed bookings are read; 42, 43 and 44 were cancelled.
      venue_bookings: { data: [{ booking_id: 41 }, { booking_id: '45' }], error: null },
      equipment_requests: { data: [], error: null },
      equipment_reservations: { data: [], error: null }
    }, captured);

    const result = await fetchEventArrangementFacts(client, 7);

    assert.equal(captured['venue_bookings.status'], 'confirmed');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.facts.venue_requests.map(row => row.booked), [true, false, false, false, true]);
    }
  });

  test('[FAILURE] [SG2-58:AC2] a venue hold query error is reported as unavailable', async () => {
    const client = fakeClient({
      venue_booking_requests: { data: [], error: null },
      venue_holds: { data: null, error: { message: 'Hold query failed' } }
    }, {});
    assert.deepEqual(await fetchEventArrangementFacts(client, 101), {
      ok: false, reason: 'unavailable', message: 'Hold query failed'
    });
  });

  test('[FAILURE] [SG2-58:AC2] a venue booking query error is reported as unavailable', async () => {
    const client = fakeClient({
      venue_booking_requests: { data: [], error: null },
      venue_holds: { data: [], error: null },
      venue_bookings: { data: null, error: { message: 'Booking query failed' } }
    }, {});
    assert.deepEqual(await fetchEventArrangementFacts(client, 101), {
      ok: false, reason: 'unavailable', message: 'Booking query failed'
    });
  });
});
