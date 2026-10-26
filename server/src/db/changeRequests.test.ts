import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDatabaseChangeRequestSource, raiseEventChangeRequest } from './changeRequests';
import type { ChangeRequestEvent } from '../changeRequests/mockChangeRequests';

const ROW = {
  change_request_id: 41, event_id: 7, field: 'expected_attendance', from_value: 120, to_value: 180,
  reason: 'More guests confirmed.', status: 'pending', created_at: '2026-10-24T02:00:00+00:00'
};
const REQUEST = {
  id: '41', requested_at: '2026-10-24T02:00:00+00:00', reason: 'More guests confirmed.', status: 'pending',
  changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }]
};
const INPUT = { eventId: 7, actorId: 'organiser-1', field: 'expected_attendance' as const, to: 180, reason: 'More guests confirmed.' };
const EVENT = { event_id: 7, expected_attendance: 120, proposed_date: null, description: null } as ChangeRequestEvent;

const rpcClient = (data: unknown, error: unknown = null) =>
  ({ rpc: async () => ({ data, error }) }) as unknown as SupabaseClient;

/** A chainable stand-in for the query builder: records each call and resolves
 * to `reply` whether awaited directly or through maybeSingle(). */
function tableClient(reply: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['from', 'select', 'eq', 'order', 'update']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
  }
  builder.maybeSingle = async () => { calls.push(['maybeSingle']); return reply; };
  builder.then = (resolve: (value: unknown) => unknown) => resolve(reply);
  return { client: builder as unknown as SupabaseClient, calls };
}

describe('raise_event_change_request adapter (SG2-64)', () => {
  test('[NORMAL] [CONFLICT] [FAILURE] [SG2-64:AC1] [SG2-64:AC2] [SG2-64:AC4] the raise adapter passes what, to what and why, returns the stored request or the refusal, and fails closed on a malformed answer', async () => {
    {
      const calls: unknown[] = [];
      const client = {
        rpc: async (name: string, args: unknown) => {
          calls.push([name, args]);
          return { data: { outcome: 'ok', coordinator_notified: true, request: ROW }, error: null };
        }
      } as unknown as SupabaseClient;
      assert.deepEqual(await raiseEventChangeRequest(client, INPUT),
        { outcome: 'ok', request: REQUEST, coordinator_notified: true });
      assert.deepEqual(calls, [['raise_event_change_request', {
        p_event_id: 7, p_actor_id: 'organiser-1', p_field: 'expected_attendance', p_to_value: 180, p_reason: 'More guests confirmed.'
      }]]);
    }
    {
      assert.deepEqual(await raiseEventChangeRequest(rpcClient({ outcome: 'not_found' }), INPUT), { outcome: 'not_found' });
      assert.deepEqual(await raiseEventChangeRequest(rpcClient({ outcome: 'unchanged' }), INPUT), { outcome: 'unchanged' });
      assert.deepEqual(await raiseEventChangeRequest(rpcClient({ outcome: 'closed', status: 'cancelled' }), INPUT),
        { outcome: 'closed', status: 'cancelled' });
    }
    {
      assert.deepEqual(await raiseEventChangeRequest(rpcClient(null, { message: 'down' }), INPUT), { outcome: 'unavailable' });
      for (const data of [null, 'ok', { outcome: 'other' }, { outcome: 'closed' },
        { outcome: 'ok', coordinator_notified: 'yes', request: ROW },
        { outcome: 'ok', coordinator_notified: true, request: null },
        { outcome: 'ok', coordinator_notified: true, request: { ...ROW, field: 'status' } },
        { outcome: 'ok', coordinator_notified: true, request: { ...ROW, to_value: { nested: true } } },
        { outcome: 'ok', coordinator_notified: true, request: { ...ROW, from_value: [1] } },
        { outcome: 'ok', coordinator_notified: true, request: { ...ROW, change_request_id: '41' } },
        { outcome: 'ok', coordinator_notified: true, request: { ...ROW, reason: null } },
        { outcome: 'ok', coordinator_notified: true, request: { ...ROW, created_at: 1 } },
        { outcome: 'ok', coordinator_notified: true, request: { ...ROW, status: 'accepted' } }]) {
        assert.deepEqual(await raiseEventChangeRequest(rpcClient(data), INPUT), { outcome: 'unavailable' }, JSON.stringify(data));
      }
    }
  });
});

describe('database change request source (SG2-64 AC2/AC3)', () => {
  test('[NORMAL] [BOUNDARY] [FAILURE] [SG2-64:AC3] the database source lists and gets pending requests in the SG2-66 shape, marks one accepted only while pending, and fails closed', async () => {
    {
      const { client, calls } = tableClient({ data: [ROW, { ...ROW, change_request_id: 42, field: 'name', from_value: null, to_value: 'Gala' }], error: null });
      const list = await createDatabaseChangeRequestSource(() => client).list(EVENT);
      assert.deepEqual(list, [REQUEST, { ...REQUEST, id: '42',
        changes: [{ field: 'name', label: 'Event name', from: null, to: 'Gala' }] }]);
      assert.deepEqual(calls, [
        ['from', 'event_change_requests'],
        ['select', 'change_request_id, event_id, field, from_value, to_value, reason, status, created_at'],
        ['eq', 'event_id', 7], ['eq', 'status', 'pending'], ['order', 'created_at'], ['order', 'change_request_id']
      ]);
    }
    {
      const read = tableClient({ data: ROW, error: null });
      assert.deepEqual(await createDatabaseChangeRequestSource(() => read.client).get(EVENT, '41'), REQUEST);
      assert.deepEqual(read.calls.slice(-2), [['eq', 'change_request_id', 41], ['maybeSingle']]);
      const write = tableClient({ data: null, error: null });
      await createDatabaseChangeRequestSource(() => write.client).markAccepted(EVENT, '41');
      assert.deepEqual(write.calls, [['from', 'event_change_requests'], ['update', { status: 'accepted' }],
        ['eq', 'event_id', 7], ['eq', 'change_request_id', 41], ['eq', 'status', 'pending']]);
    }
    {
      const { client, calls } = tableClient({ data: ROW, error: null });
      const source = createDatabaseChangeRequestSource(() => client);
      for (const id of ['0', '01', 'mock-7-attendance', '12345678901234567']) {
        assert.equal(await source.get(EVENT, id), null, id);
      }
      assert.deepEqual(calls, []);
      assert.deepEqual(await source.get(EVENT, '1234567890123456'), REQUEST);
    }
    {
      const none = createDatabaseChangeRequestSource(() => null);
      await assert.rejects(none.list(EVENT));
      const failed = createDatabaseChangeRequestSource(() => tableClient({ data: null, error: { message: 'down' } }).client);
      await assert.rejects(failed.list(EVENT));
      await assert.rejects(failed.get(EVENT, '41'));
      await assert.rejects(failed.markAccepted(EVENT, '41'));
      const odd = createDatabaseChangeRequestSource(() => tableClient({ data: 'rows', error: null }).client);
      await assert.rejects(odd.list(EVENT));
      const missing = createDatabaseChangeRequestSource(() => tableClient({ data: null, error: null }).client);
      assert.equal(await missing.get(EVENT, '41'), null);
      const malformed = createDatabaseChangeRequestSource(() => tableClient({ data: [ROW, { ...ROW, field: 'status' }], error: null }).client);
      assert.deepEqual(await malformed.list(EVENT), [REQUEST]);
    }
  });
});
