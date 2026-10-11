import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEventArrangementFacts } from './eventArrangements';

/**
 * A fake Supabase client recording selected fields and event filters.
 */
function fakeClient(responses: Record<string, { data: unknown; error: unknown }>, captured: Record<string, unknown>) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          captured[`${table}.columns`] = columns;
          return {
            eq: async (col: string, val: unknown) => {
              assert.equal(col, 'event_id');
              captured[table] = val;
              return responses[table];
            }
          };
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
        venue_booking_requests: { data: [{ status: 'approved' }, { status: 'pending' }], error: null },
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
    assert.equal(captured.equipment_requests, 101);
    assert.equal(captured.equipment_reservations, 101);
    assert.equal(captured['equipment_requests.columns'], 'request_id, status, shortfall, placement_venue_id');
    assert.equal(captured['equipment_reservations.columns'], 'request_id');
    assert.deepEqual(result, {
      ok: true,
      facts: {
        venue_requests: [{ status: 'approved' }, { status: 'pending' }],
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
});
