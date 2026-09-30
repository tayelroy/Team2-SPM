import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchClarifications, insertClarification } from './clarifications';

type Result = { data: unknown; error: { message: string } | null };

const ROW = {
  clarification_id: 5,
  event_id: 7,
  sender_id: 'coordinator-1',
  message: 'Which room layout do you need?',
  created_at: '2026-09-30T02:00:00.000Z'
};

function fakeSelectClient(
  result: Result,
  capture?: (filters: { eventId: unknown; orders: string[] }) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'event_clarifications');
      return {
        select: (_columns: string) => {
          const filters: { eventId?: unknown } = {};
          const orders: string[] = [];
          const chain = {
            eq(column: string, value: unknown) {
              if (column === 'event_id') filters.eventId = value;
              return chain;
            },
            order(column: string, options: { ascending: boolean }) {
              orders.push(`${column}:${options.ascending ? 'asc' : 'desc'}`);
              return chain;
            },
            then(resolve: (value: Result) => unknown) {
              capture?.({ eventId: filters.eventId, orders });
              return Promise.resolve(result).then(resolve);
            }
          };
          return chain;
        }
      };
    }
  } as unknown as SupabaseClient;
}

function fakeInsertClient(result: Result, capture?: (row: Record<string, unknown>) => void): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'event_clarifications');
      return {
        insert: (row: Record<string, unknown>) => {
          capture?.(row);
          return { select: async () => result };
        }
      };
    }
  } as unknown as SupabaseClient;
}

describe('fetchClarifications', () => {
  test('reads one event thread oldest first so it reads as a conversation', async () => {
    let captured: { eventId: unknown; orders: string[] } | undefined;
    const result = await fetchClarifications(
      fakeSelectClient({ data: [{ ...ROW, sender: { name: 'Casey Coordinator' } }], error: null }, (c) => (captured = c)),
      7
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.clarifications[0].message, 'Which room layout do you need?');
      assert.equal(result.clarifications[0].sender_name, 'Casey Coordinator');
    }
    assert.equal(captured?.eventId, 7);
    assert.deepEqual(captured?.orders, ['created_at:asc', 'clarification_id:asc']);
  });


  for (const [label, sender, expected] of [
    ['a joined array', [{ name: 'Olly Organiser' }], 'Olly Organiser'],
    ['a flat sender_name', undefined, 'Flat Name'],
    ['no sender at all', undefined, null]
  ] as const) {
    test(`resolves the sender from ${label}`, async () => {
      const row: Record<string, unknown> = { ...ROW };
      if (sender) row.sender = sender;
      if (label === 'a flat sender_name') row.sender_name = 'Flat Name';
      const result = await fetchClarifications(fakeSelectClient({ data: [row], error: null }), 7);
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.clarifications[0].sender_name, expected);
    });
  }

  test('an empty thread is a success, not a failure', async () => {
    const result = await fetchClarifications(fakeSelectClient({ data: null, error: null }), 7);
    assert.deepEqual(result, { ok: true, clarifications: [] });
  });

  test('reports unavailable when the query errors', async () => {
    const result = await fetchClarifications(
      fakeSelectClient({ data: null, error: { message: 'connection reset' } }),
      7
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });
});

describe('insertClarification', () => {
  test('appends the message against the event and its sender', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await insertClarification(
      fakeInsertClient({ data: [ROW], error: null }, (row) => (captured = row)),
      7,
      'coordinator-1',
      'Which room layout do you need?'
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.clarification.clarification_id, 5);
    assert.deepEqual(captured, {
      event_id: 7,
      sender_id: 'coordinator-1',
      message: 'Which room layout do you need?'
    });
  });

  test('reports unavailable when the insert errors', async () => {
    const result = await insertClarification(
      fakeInsertClient({ data: null, error: { message: 'connection reset' } }),
      7,
      'coordinator-1',
      'hello'
    );
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'connection reset' });
  });

  for (const data of [[], null]) {
    test(`reports unavailable when the insert returns ${JSON.stringify(data)}`, async () => {
      const result = await insertClarification(fakeInsertClient({ data, error: null }), 7, 'coordinator-1', 'hello');
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.message, /not returned/);
    });
  }
});
