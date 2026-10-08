import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchUnassignedQueue } from './assignmentQueue';

const USERS: Record<string, string> = { 'org-1': 'Olivia Organiser', 'org-2': 'Oscar Organiser' };

/** A stateful `events` table: filters apply, ordering applies, the organiser
 * embed resolves from USERS, exactly as PostgREST would answer. */
function eventsTable(rows: Record<string, unknown>[] | null, failure?: string) {
  const asked: string[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, 'events');
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const orders: [string, boolean, boolean][] = [];
      const query = {
        select(columns: string) { asked.push(columns); return query; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query; },
        is(column: string, value: null) { filters.push(row => (row[column] ?? null) === value); return query; },
        order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) {
          orders.push([column, options.ascending, options.nullsFirst ?? !options.ascending]);
          return query;
        },
        then(resolve: (value: unknown) => void) {
          if (failure) return resolve({ data: null, error: { message: failure } });
          if (rows === null) return resolve({ data: null, error: null });
          const data = rows.filter(row => filters.every(keep => keep(row))).sort((a, b) => {
            for (const [column, ascending, nullsFirst] of orders) {
              const [x, y] = [a[column] ?? null, b[column] ?? null];
              if (x === y) continue;
              if (x === null) return nullsFirst ? -1 : 1;
              if (y === null) return nullsFirst ? 1 : -1;
              return (x < y ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          }).map(row => ({ ...row, organiser: row.organiser_id ? { name: USERS[String(row.organiser_id)] } : null }));
          return resolve({ data, error: null });
        }
      };
      return query;
    }
  } as unknown as SupabaseClient;
  return { client, asked };
}

const base = { organiser_id: 'org-1', proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 120 };

test('[NORMAL] [SG2-87:AC1] [SG2-87:AC3] the queue holds unassigned requests with the basic event details', async () => {
  const { client } = eventsTable([
    { ...base, event_id: 1, name: 'Leadership Forum', status: 'unassigned', coordinator_id: null, submitted_at: '2026-10-06T01:00:00.000Z' }
  ]);
  assert.deepEqual(await fetchUnassignedQueue(client), {
    ok: true,
    entries: [{
      event_id: 1, name: 'Leadership Forum', organiser_name: 'Olivia Organiser',
      proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 120, submitted_at: '2026-10-06T01:00:00.000Z'
    }]
  });
});

test('[CONFLICT] [SG2-87:AC5] an event leaves the queue once assigned (moved to submitted), and drafts or reviewed requests never enter it', async () => {
  const { client } = eventsTable([
    { ...base, event_id: 1, name: 'Queued', status: 'unassigned', coordinator_id: null, submitted_at: '2026-10-06T01:00:00.000Z' },
    { ...base, event_id: 2, name: 'Just assigned', status: 'submitted', coordinator_id: 'coord-1', submitted_at: '2026-10-06T00:00:00.000Z' },
    { ...base, event_id: 3, name: 'Draft', status: 'draft', coordinator_id: null, submitted_at: null },
    { ...base, event_id: 4, name: 'Under review', status: 'under_review', coordinator_id: 'coord-1', submitted_at: '2026-10-05T00:00:00.000Z' },
    { ...base, event_id: 5, name: 'Returned for clarification', status: 'needs_clarification', coordinator_id: null, submitted_at: '2026-10-04T00:00:00.000Z' }
  ]);
  const result = await fetchUnassignedQueue(client);
  assert.deepEqual(result.ok && result.entries.map(entry => entry.event_id), [1]);
});

test('[BOUNDARY] [SG2-87:AC3] oldest submission first, ties by event id, and a request with no recorded submission time last', async () => {
  const { client } = eventsTable([
    { ...base, event_id: 9, name: 'Before submitted_at existed', status: 'unassigned', coordinator_id: null, submitted_at: null },
    { ...base, event_id: 7, name: 'Second, same instant', status: 'unassigned', coordinator_id: null, submitted_at: '2026-10-06T01:00:00.000Z' },
    { ...base, event_id: 8, name: 'Newest', status: 'unassigned', coordinator_id: null, submitted_at: '2026-10-06T02:00:00.000Z' },
    { ...base, event_id: 6, name: 'First, same instant', status: 'unassigned', coordinator_id: null, submitted_at: '2026-10-06T01:00:00.000Z' },
    { ...base, event_id: 5, name: '', organiser_id: null, status: 'unassigned', coordinator_id: null, submitted_at: '2026-10-05T23:59:59.999Z',
      proposed_date: null, expected_attendance: null }
  ]);
  const result = await fetchUnassignedQueue(client);
  assert.ok(result.ok);
  assert.deepEqual(result.entries.map(entry => entry.event_id), [5, 6, 7, 8, 9]);
  assert.deepEqual(result.entries[0], {
    event_id: 5, name: '', organiser_name: null, proposed_date: null, expected_attendance: null, submitted_at: '2026-10-05T23:59:59.999Z'
  });
});

test('[BOUNDARY] [SG2-87:AC3] a request with no name reads as an empty name, and no rows at all read as an empty queue', async () => {
  const unnamed = eventsTable([
    { ...base, event_id: 3, name: null, status: 'unassigned', coordinator_id: null, submitted_at: '2026-10-06T01:00:00.000Z' }
  ]);
  const result = await fetchUnassignedQueue(unnamed.client);
  assert.deepEqual(result.ok && result.entries.map(entry => [entry.event_id, entry.name]), [[3, '']]);
  assert.deepEqual(await fetchUnassignedQueue(eventsTable(null).client), { ok: true, entries: [] });
});

test('[FAILURE] [SG2-87:AC2] a database failure is reported as unavailable, not as an empty queue', async () => {
  const { client } = eventsTable([], 'permission denied for table events');
  assert.deepEqual(await fetchUnassignedQueue(client), {
    ok: false, reason: 'unavailable', message: 'permission denied for table events'
  });
});
