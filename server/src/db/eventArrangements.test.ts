import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEventArrangementFacts } from './eventArrangements';

/**
 * A fake Supabase client recording selected fields, event filters and bounds.
 */
function fakeClient(responses: Record<string, { data: unknown; error: unknown }>, captured: Record<string, unknown>) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          captured[`${table}.columns`] = columns;
          return {
            eq: (col: string, val: unknown) => {
              assert.equal(col, 'event_id');
              captured[table] = val;
              if (table !== 'equipment_reservations') return Promise.resolve(responses[table]);
              return { limit: async (count: number) => {
                captured[`${table}.limit`] = count;
                return responses[table];
              } };
            }
          };
        }
      };
    }
  } as unknown as SupabaseClient;
}

describe('Event arrangement facts DB operations (SG2-57)', () => {
  test('[NORMAL] [SG2-57:AC1] [SG2-39:AC2] [SG2-55:AC4] reads venue and equipment rows for the event', async () => {
    const captured: Record<string, unknown> = {};
    const client = fakeClient(
      {
        venue_booking_requests: { data: [{ status: 'approved' }, { status: 'pending' }], error: null },
        equipment_requests: {
          data: [{ status: 'pending', shortfall: 0, placement_venue_id: 7 }],
          error: null
        },
        equipment_reservations: { data: [{ reservation_id: 12 }], error: null }
      },
      captured
    );

    const result = await fetchEventArrangementFacts(client, 101);

    assert.equal(result.ok, true);
    assert.equal(captured.venue_booking_requests, 101);
    assert.equal(captured.equipment_requests, 101);
    assert.equal(captured.equipment_reservations, 101);
    assert.equal(captured['equipment_reservations.columns'], 'reservation_id');
    assert.equal(captured['equipment_reservations.limit'], 1);
    if (result.ok) {
      assert.equal(result.facts.venue_requests.length, 2);
      assert.equal(result.facts.equipment_requests[0].placement_venue_id, 7);
      assert.equal(result.facts.equipment_reserved, true);
      assert.deepEqual(Object.keys(result.facts).sort(), ['equipment_requests', 'equipment_reserved', 'venue_requests']);
    }
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

  test('[NORMAL] [SG2-39:AC2] [SG2-55:AC4] an unlinked legacy reservation counts without any equipment request', async () => {
    const captured: Record<string, unknown> = {};
    const client = fakeClient({
      venue_booking_requests: { data: [], error: null },
      equipment_requests: { data: [], error: null },
      // request_id is deliberately not selected or filtered: legacy rows have
      // no link, and the sole projected identity is enough to prove existence.
      equipment_reservations: { data: [{ reservation_id: 93 }], error: null }
    }, captured);
    assert.deepEqual(await fetchEventArrangementFacts(client, 42), {
      ok: true, facts: { venue_requests: [], equipment_requests: [], equipment_reserved: true }
    });
    assert.equal(captured.equipment_reservations, 42);
    assert.equal(captured['equipment_reservations.columns'], 'reservation_id');
    assert.equal(captured['equipment_reservations.limit'], 1);
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
