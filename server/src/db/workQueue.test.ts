import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchWorkQueue } from './workQueue';

function fixture(rows: Record<string, unknown>[], failure?: 'error' | 'null') {
  const calls: unknown[][] = [];
  const client = { from(table: string) {
    assert.equal(table, 'internal_work_items');
    const filters: [string, unknown][] = [];
    const query = {
      select(columns: string) {
        assert.equal(columns, 'kind,item_id,event_id,title,event_name,status,starts_at,ends_at,category,details');
        return query;
      },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      is(key: string, value: null) { filters.push([key, value]); return query; },
      order(key: string) { assert.ok(['kind', 'item_id'].includes(key)); return query; },
      async range(start: number, end: number) {
        calls.push([filters, start, end]);
        return { data: failure === 'null' ? null : rows.filter(row => filters.every(([key, value]) => row[key] === value)).slice(start, end + 1),
          error: failure === 'error' ? { message: 'DATABASE_SECRET' } : null };
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, calls };
}

test('coordinator list and detail include shared reviews and own assignments, never another coordinator or role', async () => {
  const rows = [
    { kind: 'event', item_id: 1, audience: 'event_coordinator', assigned_to: null },
    { kind: 'event', item_id: 2, audience: 'event_coordinator', assigned_to: 'coordinator-1' },
    { kind: 'event', item_id: 3, audience: 'event_coordinator', assigned_to: 'coordinator-2' },
    { kind: 'venue', item_id: 1, audience: 'venue_staff', assigned_to: null },
  ];
  const { client, calls } = fixture(rows);
  const principal = { userId: 'coordinator-1', role: 'event_coordinator' as const };
  assert.deepEqual(await fetchWorkQueue(client, principal), rows.slice(0, 2));
  assert.deepEqual(calls, [
    [[['audience', 'event_coordinator'], ['assigned_to', null]], 0, 999],
    [[['audience', 'event_coordinator'], ['assigned_to', 'coordinator-1']], 0, 999],
  ]);
  assert.deepEqual(await fetchWorkQueue(client, principal, { kind: 'event', item_id: 2 }), [rows[1]]);
  for (const selection of [{ kind: 'event' as const, item_id: 3 }, { kind: 'venue' as const, item_id: 1 }]) {
    assert.deepEqual(await fetchWorkQueue(client, principal, selection), []);
  }
});

test('staff queries use verified role and return all pages, including an empty queue', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({ kind: 'venue', item_id: index + 1, audience: 'venue_staff', assigned_to: null }));
  const { client, calls } = fixture(rows);
  assert.deepEqual(await fetchWorkQueue(client, { userId: 'staff', role: 'venue_staff' }), rows);
  assert.deepEqual(calls.map(call => call.slice(1)), [[0, 999], [1000, 1999]]);
  assert.deepEqual(await fetchWorkQueue(client, { userId: 'staff', role: 'technical_support_staff' }), []);
});

for (const failure of ['error', 'null'] as const) {
  test(`database ${failure} fails the queue instead of returning a misleading empty result`, async () => {
    await assert.rejects(fetchWorkQueue(fixture([], failure).client, { userId: 'staff', role: 'venue_staff' }),
      { message: 'Work queue unavailable' });
  });
}
