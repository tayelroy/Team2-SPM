import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEventArrangementFacts } from './eventArrangements';

/**
 * A fake Supabase client that answers `from(table).select(cols).eq(col, val)`
 * per table, recording which event id each query filtered on.
 */
function fakeClient(responses: Record<string, { data: unknown; error: unknown }>, captured: Record<string, unknown>) {
  return {
    from(table: string) {
      return {
        select(_columns: string) {
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
  test('[NORMAL] [SG2-57:AC1] reads venue and equipment rows for the event', async () => {
    const captured: Record<string, unknown> = {};
    const client = fakeClient(
      {
        venue_booking_requests: { data: [{ status: 'approved' }, { status: 'pending' }], error: null },
        equipment_requests: {
          data: [{ status: 'pending', shortfall: 0, placement_venue_id: 7 }],
          error: null
        }
      },
      captured
    );

    const result = await fetchEventArrangementFacts(client, 101);

    assert.equal(result.ok, true);
    assert.equal(captured.venue_booking_requests, 101);
    assert.equal(captured.equipment_requests, 101);
    if (result.ok) {
      assert.equal(result.facts.venue_requests.length, 2);
      assert.equal(result.facts.equipment_requests[0].placement_venue_id, 7);
    }
  });

  test('[BOUNDARY] [SG2-57:AC2] missing rows come back as empty arrays, not null', async () => {
    const client = fakeClient(
      {
        venue_booking_requests: { data: null, error: null },
        equipment_requests: { data: null, error: null }
      },
      {}
    );

    const result = await fetchEventArrangementFacts(client, 101);

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.facts.venue_requests, []);
      assert.deepEqual(result.facts.equipment_requests, []);
    }
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
