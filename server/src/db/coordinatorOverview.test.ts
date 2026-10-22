import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchEventSupervisor, fetchSupervisedEvents, OVERSIGHT_STATUSES } from './coordinatorOverview';

const USERS: Record<string, string> = { 'coord-1': 'Ada Coordinator', 'coord-2': 'Ben Coordinator' };

/** A stateful `events` table: filters, ordering (nulls last) and paging apply,
 * and the coordinator embed resolves from USERS, as PostgREST would answer. */
function eventsTable(rows: Record<string, unknown>[], failure?: string) {
  const pages: [number, number][] = [];
  const client = {
    from(table: string) {
      assert.equal(table, 'events');
      const filters: ((row: Record<string, unknown>) => boolean)[] = [];
      const orders: string[] = [];
      let window: [number, number] = [0, Infinity];
      let single = false;
      const answer = () => {
        if (failure) return { data: null, error: { message: failure } };
        const data = rows.filter(row => filters.every(keep => keep(row))).sort((a, b) => {
          for (const column of orders) {
            const [x, y] = [a[column] ?? null, b[column] ?? null];
            if (x === y) continue;
            if (x === null) return 1;
            if (y === null) return -1;
            return x < y ? -1 : 1;
          }
          return 0;
        }).slice(window[0], window[1] + 1).map(row => ({
          ...row, coordinator: row.coordinator_id ? { name: USERS[String(row.coordinator_id)] ?? null } : null
        }));
        return { data: single ? data[0] ?? null : data, error: null };
      };
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query; },
        in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query; },
        order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) {
          // Soonest first; an event with no proposed date goes last.
          assert.deepEqual(options, column === 'proposed_date' ? { ascending: true, nullsFirst: false } : { ascending: true });
          orders.push(column);
          return query;
        },
        range(from: number, to: number) { pages.push([from, to]); window = [from, to]; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve: (value: unknown) => void) { return resolve(answer()); }
      };
      return query;
    }
  } as unknown as SupabaseClient;
  return { client, pages };
}

const base = { organisation: 'Client Org', coordinator_assigned_by: 'lead-1' };

test('[NORMAL] [SG2-89:AC1] a Lead reads the active events they supervise with each coordinator and status, soonest first', async () => {
  const { client } = eventsTable([
    { ...base, event_id: 2, name: 'Later Forum', status: 'planning', proposed_date: '2030-07-01T00:00:00Z', coordinator_id: 'coord-2' },
    { ...base, event_id: 1, name: 'Sooner Forum', status: 'needs_clarification', proposed_date: '2030-06-01T00:00:00Z', coordinator_id: 'coord-1' }
  ]);
  assert.deepEqual(await fetchSupervisedEvents(client, 'lead-1'), {
    ok: true,
    events: [
      { event_id: 1, name: 'Sooner Forum', organisation: 'Client Org', status: 'needs_clarification',
        proposed_date: '2030-06-01T00:00:00Z', coordinator_id: 'coord-1', coordinator_name: 'Ada Coordinator' },
      { event_id: 2, name: 'Later Forum', organisation: 'Client Org', status: 'planning',
        proposed_date: '2030-07-01T00:00:00Z', coordinator_id: 'coord-2', coordinator_name: 'Ben Coordinator' }
    ]
  });
});

test('[BOUNDARY] [SG2-89:AC1] [SG2-89:AC6] only live statuses count as active, including events awaiting clarification', async () => {
  assert.deepEqual(OVERSIGHT_STATUSES, [
    'submitted', 'under_review', 'needs_clarification', 'approved', 'planning',
    'awaiting_safety_check', 'safety_rejected', 'preparation', 'confirmed'
  ]);
  const { client } = eventsTable(['draft', 'unassigned', 'completed', 'cancelled', 'rejected', 'confirmed'].map((status, index) => ({
    ...base, event_id: index + 1, name: status, status, proposed_date: null, coordinator_id: 'coord-1'
  })));
  const result = await fetchSupervisedEvents(client, 'lead-1');
  assert.deepEqual(result.ok && result.events.map(event => event.status), ['confirmed']);
});

test('[CONFLICT] [SG2-89:AC1] an event another Lead reassigned since leaves this Lead\'s overview', async () => {
  const { client } = eventsTable([
    { ...base, event_id: 1, name: 'Mine', status: 'planning', proposed_date: null, coordinator_id: 'coord-1' },
    { ...base, event_id: 2, name: 'Taken over', status: 'planning', proposed_date: null, coordinator_id: 'coord-2', coordinator_assigned_by: 'lead-2' },
    { ...base, event_id: 3, name: 'Never recorded', status: 'planning', proposed_date: null, coordinator_id: 'coord-2', coordinator_assigned_by: null }
  ]);
  const result = await fetchSupervisedEvents(client, 'lead-1');
  assert.deepEqual(result.ok && result.events.map(event => event.name), ['Mine']);
});

test('[BOUNDARY] [SG2-89:AC1] an unnamed event, a missing date and an unnamed coordinator still read cleanly; undated events sort last', async () => {
  const { client } = eventsTable([
    { ...base, event_id: 1, name: '', status: 'approved', proposed_date: null, organisation: null, coordinator_id: 'coord-unknown' },
    { ...base, event_id: 2, name: 'Dated', status: 'approved', proposed_date: '2030-01-01T00:00:00Z', coordinator_id: 'coord-1' }
  ]);
  const result = await fetchSupervisedEvents(client, 'lead-1');
  assert.deepEqual(result.ok && result.events.map(event => [event.name, event.proposed_date, event.organisation, event.coordinator_name]), [
    ['Dated', '2030-01-01T00:00:00Z', 'Client Org', 'Ada Coordinator'],
    ['Untitled event', null, null, null]
  ]);
});

test('[BOUNDARY] [SG2-89:AC1] a Lead with more than 1,000 active events reads every page', async () => {
  const { client, pages } = eventsTable(Array.from({ length: 1001 }, (_, index) => ({
    ...base, event_id: index + 1, name: `Event ${index + 1}`, status: 'planning', proposed_date: null, coordinator_id: 'coord-1'
  })));
  const result = await fetchSupervisedEvents(client, 'lead-1');
  assert.equal(result.ok && result.events.length, 1001);
  assert.deepEqual(pages, [[0, 999], [1000, 1999]]);
});

test('[NORMAL] [SG2-89:AC1] a Lead with no supervised events reads an empty overview', async () => {
  const { client } = eventsTable([]);
  assert.deepEqual(await fetchSupervisedEvents(client, 'lead-1'), { ok: true, events: [] });
});

test('[FAILURE] [SG2-89:AC1] a failing read is reported as unavailable', async () => {
  const { client } = eventsTable([], 'connection reset');
  assert.deepEqual(await fetchSupervisedEvents(client, 'lead-1'), { ok: false, reason: 'unavailable', message: 'connection reset' });
  assert.deepEqual(await fetchEventSupervisor(client, 1), { ok: false, reason: 'unavailable', message: 'connection reset' });
});

test('[NORMAL] [SG2-89:AC1] the supervising Lead of one event is read before it is reassigned', async () => {
  const { client } = eventsTable([
    { event_id: 1, coordinator_assigned_by: 'lead-1' },
    { event_id: 2, coordinator_assigned_by: null }
  ]);
  assert.deepEqual(await fetchEventSupervisor(client, 1), { ok: true, supervisorId: 'lead-1' });
  assert.deepEqual(await fetchEventSupervisor(client, 2), { ok: true, supervisorId: null });
  assert.deepEqual(await fetchEventSupervisor(client, 3), { ok: true, supervisorId: null });
});

test('[NORMAL] [SG2-89:AC1] an empty answer reads as no supervised events', async () => {
  const client = {
    from: () => {
      const query = {
        select: () => query, eq: () => query, in: () => query, order: () => query, range: () => query,
        then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null })
      };
      return query;
    }
  } as unknown as SupabaseClient;
  assert.deepEqual(await fetchSupervisedEvents(client, 'lead-1'), { ok: true, events: [] });
});
