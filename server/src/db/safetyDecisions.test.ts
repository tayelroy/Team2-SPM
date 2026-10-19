import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchSafetyDecisionEvent,
  listSafetyDecisions,
  recordSafetyDecision,
  reworkSafetyRejectedEvent
} from './safetyDecisions';
import { standInSafetyCheckQueue } from '../safetyChecks/standInQueue';

type Row = Record<string, unknown>;
type Response = { data: unknown; error: unknown };

/**
 * A fake service-role client: each table answers with its configured rows
 * (empty when unset), filtered by the eq/in calls made, and records every
 * query as `table select | filters`.
 */
function fakeClient(responses: Record<string, Response>, queries: string[] = []) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: ((row: Row) => boolean)[] = [];
          const notes: string[] = [];
          const respond = () => {
            queries.push(`${table} ${columns}${notes.length ? ` | ${notes.join(' ')}` : ''}`);
            const response = responses[table] ?? { data: [], error: null };
            if (!Array.isArray(response.data)) return response;
            return { ...response, data: (response.data as Row[]).filter(row => filters.every(filter => filter(row))) };
          };
          const chain = {
            eq(column: string, value: unknown) {
              notes.push(`${column}=${value}`);
              filters.push(row => row[column] === value);
              return chain;
            },
            in(column: string, values: unknown[]) {
              notes.push(`${column} in ${values.join(',')}`);
              filters.push(row => values.includes(row[column]));
              return chain;
            },
            order(column: string) { notes.push(`order ${column}`); return chain; },
            async maybeSingle() {
              const response = respond();
              return Array.isArray(response.data) ? { ...response, data: response.data[0] ?? null } : response;
            },
            then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
              return Promise.resolve(respond()).then(resolve, reject);
            }
          };
          return chain;
        }
      };
    }
  } as unknown as SupabaseClient;
}

const rpcClient = (data: unknown, error: unknown = null, calls: unknown[] = []) =>
  ({ rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data, error }; } }) as unknown as SupabaseClient;

const failed = { data: null, error: { message: 'secret provider detail' } };

describe('fetchSafetyDecisionEvent (SG2-92)', () => {
  test('[NORMAL] [SG2-92:AC6] reads only the status and who the event belongs to', async () => {
    const queries: string[] = [];
    const event = { event_id: 7, status: 'awaiting_safety_check', organiser_id: 'org-1', coordinator_id: 'coord-1' };
    assert.deepEqual(await fetchSafetyDecisionEvent(fakeClient({ events: { data: [event], error: null } }, queries), 7), { ok: true, event });
    assert.deepEqual(queries, ['events event_id, status, organiser_id, coordinator_id | event_id=7']);
  });

  test('[FAILURE] [SG2-92:AC6] a missing event and a failed read are told apart', async () => {
    assert.deepEqual(await fetchSafetyDecisionEvent(fakeClient({}), 7), { ok: false, reason: 'not_found' });
    assert.deepEqual(await fetchSafetyDecisionEvent(fakeClient({ events: failed }), 7), { ok: false, reason: 'unavailable' });
  });
});

describe('listSafetyDecisions (SG2-92)', () => {
  const approve = { decision_id: 3, event_id: 7, decision: 'approve', reason: null, arrangements: [], decided_by: 'safety-1', decided_at: '2030-06-02T00:00:00Z' };
  const changes = { decision_id: 2, event_id: 7, decision: 'request_changes', reason: 'Move the stage', arrangements: ['venue', 'equipment'], decided_by: 'safety-2', decided_at: '2030-06-01T00:00:00Z' };

  test('[NORMAL] [SG2-92:AC6] every decision comes back newest first with who made it, when and why', async () => {
    const queries: string[] = [];
    const client = fakeClient({
      event_safety_decisions: { data: [approve, changes], error: null },
      users: { data: [{ user_id: 'safety-1', name: 'Sam Safety' }], error: null }
    }, queries);
    assert.deepEqual(await listSafetyDecisions(client, 7), {
      ok: true,
      decisions: [
        { ...approve, decided_by_name: 'Sam Safety' },
        { ...changes, decided_by_name: null }
      ]
    });
    assert.deepEqual(queries, [
      'event_safety_decisions decision_id, event_id, decision, reason, arrangements, decided_by, decided_at | event_id=7 order decided_at order decision_id',
      'users user_id, name | user_id in safety-1,safety-2'
    ]);
  });

  test('[BOUNDARY] [SG2-92:AC6] an event without decisions reads no names, and an unreadable arrangement list is treated as empty', async () => {
    const queries: string[] = [];
    assert.deepEqual(await listSafetyDecisions(fakeClient({}, queries), 7), { ok: true, decisions: [] });
    assert.equal(queries.length, 1);
    const odd = { ...approve, arrangements: null };
    assert.deepEqual(await listSafetyDecisions(fakeClient({ event_safety_decisions: { data: [odd], error: null } }), 7),
      { ok: true, decisions: [{ ...approve, decided_by_name: null }] });
  });

  test('[BOUNDARY] [SG2-92:AC6] a successful read with no rows, for decisions or names, is an empty list rather than a failure', async () => {
    assert.deepEqual(await listSafetyDecisions(fakeClient({ event_safety_decisions: { data: null, error: null } }), 7), { ok: true, decisions: [] });
    assert.deepEqual(await listSafetyDecisions(fakeClient({
      event_safety_decisions: { data: [approve], error: null }, users: { data: null, error: null }
    }), 7), { ok: true, decisions: [{ ...approve, decided_by_name: null }] });
  });

  test('[FAILURE] [SG2-92:AC6] a row outside the vocabulary is skipped rather than guessed', async () => {
    const rows = [{ ...approve, decision: 'maybe' }, { ...changes, arrangements: ['catering'] }];
    assert.deepEqual(await listSafetyDecisions(fakeClient({ event_safety_decisions: { data: rows, error: null } }), 7), { ok: true, decisions: [] });
  });

  test('[FAILURE] [SG2-92:AC6] a failed decision or name read fails the whole list', async () => {
    assert.deepEqual(await listSafetyDecisions(fakeClient({ event_safety_decisions: failed }), 7), { ok: false });
    assert.deepEqual(await listSafetyDecisions(fakeClient({ event_safety_decisions: { data: [approve], error: null }, users: failed }), 7), { ok: false });
  });
});

describe('recordSafetyDecision (SG2-92)', () => {
  const input = { eventId: 7, actorId: 'safety-1', decision: 'request_changes' as const, reason: 'Move the stage', arrangements: ['venue' as const] };

  test('[NORMAL] [SG2-92:AC1] [SG2-92:AC6] one RPC carries the decision, its reason and arrangements, and the result comes back typed', async () => {
    const calls: unknown[] = [];
    const ok = { outcome: 'ok', decision_id: 9, decision: 'request_changes', previous_status: 'awaiting_safety_check', status: 'planning', decided_at: '2030-06-01T00:00:00Z' };
    assert.deepEqual(await recordSafetyDecision(rpcClient(ok, null, calls), input), ok);
    assert.deepEqual(calls, [['record_safety_decision',
      { p_event_id: 7, p_actor_id: 'safety-1', p_decision: 'request_changes', p_reason: 'Move the stage', p_arrangements: ['venue'] }]]);
  });

  test('[CONFLICT] [SG2-92:AC1] refusals from the database pass through, with the status for a closed check', async () => {
    for (const outcome of ['forbidden', 'missing', 'invalid'] as const) {
      assert.deepEqual(await recordSafetyDecision(rpcClient({ outcome }), input), { outcome });
    }
    assert.deepEqual(await recordSafetyDecision(rpcClient({ outcome: 'closed', status: 'preparation' }), input), { outcome: 'closed', status: 'preparation' });
  });

  test('[FAILURE] [SG2-92:AC1] an error or an unexpected answer is reported unavailable', async () => {
    for (const [data, error] of [[null, { message: 'down' }], [null, null], ['ok', null], [{ outcome: 'closed' }, null],
      [{ outcome: 'ok', decision_id: '9' }, null], [{ outcome: 'ok', decision_id: 9, decision: 'maybe' }, null],
      [{ outcome: 'ok', decision_id: 9, decision: 'approve', previous_status: 'a', status: 'b' }, null], [{ outcome: 'later' }, null]]) {
      assert.deepEqual(await recordSafetyDecision(rpcClient(data, error), input), { outcome: 'unavailable' }, JSON.stringify(data));
    }
  });
});

describe('reworkSafetyRejectedEvent (SG2-92)', () => {
  test('[NORMAL] [SG2-92:AC4] the coordinator\'s rework goes through one RPC and returns Planning', async () => {
    const calls: unknown[] = [];
    assert.deepEqual(await reworkSafetyRejectedEvent(rpcClient({ outcome: 'ok', status: 'planning' }, null, calls), 7, 'coord-1'),
      { outcome: 'ok', status: 'planning' });
    assert.deepEqual(calls, [['rework_safety_rejected_event', { p_event_id: 7, p_actor_id: 'coord-1' }]]);
  });

  test('[CONFLICT] [SG2-92:AC4] a missing event or one that is not Safety Rejected passes through', async () => {
    assert.deepEqual(await reworkSafetyRejectedEvent(rpcClient({ outcome: 'missing' }), 7, 'c'), { outcome: 'missing' });
    assert.deepEqual(await reworkSafetyRejectedEvent(rpcClient({ outcome: 'closed', status: 'planning' }), 7, 'c'), { outcome: 'closed', status: 'planning' });
  });

  test('[FAILURE] [SG2-92:AC4] an error or an unexpected answer is reported unavailable', async () => {
    for (const [data, error] of [[null, { message: 'down' }], [7, null], [{ outcome: 'closed' }, null], [{ outcome: 'ok', status: 'preparation' }, null]]) {
      assert.deepEqual(await reworkSafetyRejectedEvent(rpcClient(data, error), 7, 'c'), { outcome: 'unavailable' }, JSON.stringify(data));
    }
  });
});

describe('stand-in safety check queue (SG2-92; stands in for SG2-91)', () => {
  const events = [
    { event_id: 7, name: 'Harbour Gala', proposed_date: '2030-06-20T02:00:00Z', expected_attendance: 300, accessibility_needs: 'Step-free access', coordinator_id: 'coord-1', status: 'awaiting_safety_check' },
    { event_id: 8, name: null, proposed_date: null, expected_attendance: null, accessibility_needs: null, coordinator_id: null, status: 'awaiting_safety_check' }
  ];
  const tables = {
    events: { data: events, error: null },
    venue_bookings: { data: [
      { event_id: 7, venue_id: 1, starts_at: '2030-06-20T01:00:00Z', ends_at: '2030-06-20T06:00:00Z', status: 'confirmed' },
      { event_id: 7, venue_id: 2, starts_at: '2030-06-20T01:00:00Z', ends_at: '2030-06-20T06:00:00Z', status: 'held' },
      { event_id: 7, venue_id: 9, starts_at: '2030-06-21T01:00:00Z', ends_at: '2030-06-21T06:00:00Z', status: 'confirmed' }
    ], error: null },
    equipment_requests: { data: [
      { event_id: 7, equipment_id: 4, quantity: 2, status: 'approved', placement_position: 'Stage left' },
      { event_id: 7, equipment_id: 5, quantity: 1, status: 'Cancelled', placement_position: null },
      { event_id: 7, equipment_id: 6, quantity: 3, status: 'pending', placement_position: null }
    ], error: null },
    venues: { data: [{ venue_id: 1, name: 'Harbour Hall', capacity: 400 }], error: null },
    equipment: { data: [{ equipment_id: 4, name: 'Wireless microphone' }], error: null },
    users: { data: [{ user_id: 'coord-1', name: 'Casey Coordinator' }], error: null }
  };

  test('[NORMAL] [SG2-92:AC1] lists the events awaiting a check with their confirmed venues and live equipment', async () => {
    const queries: string[] = [];
    const result = await standInSafetyCheckQueue.list(fakeClient(tables, queries));
    assert.deepEqual(result, {
      ok: true,
      events: [
        {
          event_id: 7, name: 'Harbour Gala', proposed_date: '2030-06-20T02:00:00Z', expected_attendance: 300,
          accessibility_needs: 'Step-free access', coordinator_name: 'Casey Coordinator',
          venues: [
            { name: 'Harbour Hall', capacity: 400, starts_at: '2030-06-20T01:00:00Z', ends_at: '2030-06-20T06:00:00Z' },
            { name: 'Unknown venue', capacity: null, starts_at: '2030-06-21T01:00:00Z', ends_at: '2030-06-21T06:00:00Z' }
          ],
          equipment: [
            { name: 'Wireless microphone', quantity: 2, placement_position: 'Stage left' },
            { name: 'Unknown equipment', quantity: 3, placement_position: null }
          ]
        },
        { event_id: 8, name: null, proposed_date: null, expected_attendance: null, accessibility_needs: null, coordinator_name: null, venues: [], equipment: [] }
      ]
    });
    assert.equal(queries[0], 'events event_id, name, proposed_date, expected_attendance, accessibility_needs, coordinator_id | status=awaiting_safety_check order proposed_date order event_id');
  });

  test('[BOUNDARY] [SG2-92:AC1] an empty queue reads nothing else', async () => {
    const queries: string[] = [];
    assert.deepEqual(await standInSafetyCheckQueue.list(fakeClient({}, queries)), { ok: true, events: [] });
    assert.equal(queries.length, 1);
  });

  test('[BOUNDARY] [SG2-92:AC1] successful reads with no rows, and a coordinator without a name, still give a full queue entry', async () => {
    assert.deepEqual(await standInSafetyCheckQueue.list(fakeClient({ events: { data: null, error: null } })), { ok: true, events: [] });
    const result = await standInSafetyCheckQueue.list(fakeClient({
      events: { data: [events[0]], error: null },
      venue_bookings: { data: null, error: null },
      equipment_requests: { data: null, error: null },
      users: { data: [], error: null }
    }));
    assert.deepEqual(result, { ok: true, events: [{
      event_id: 7, name: 'Harbour Gala', proposed_date: '2030-06-20T02:00:00Z', expected_attendance: 300,
      accessibility_needs: 'Step-free access', coordinator_name: null, venues: [], equipment: []
    }] });
  });

  test('[FAILURE] [SG2-92:AC1] any failed read makes the whole queue unavailable', async () => {
    for (const table of ['events', 'venue_bookings', 'equipment_requests', 'venues', 'equipment', 'users']) {
      assert.deepEqual(await standInSafetyCheckQueue.list(fakeClient({ ...tables, [table]: failed })), { ok: false }, table);
    }
  });
});
