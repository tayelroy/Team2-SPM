import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  applyAcceptedEventChange,
  fetchChangeImpactEvent,
  fetchChangeImpactFacts,
  settleArrangementRecheck,
  type ApplyAcceptedEventChangeInput
} from './changeImpact';

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
              filters.push(row => row[column] === undefined || row[column] === value);
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

const START = '2030-06-20T02:00:00.000Z';
const END = '2030-06-20T06:00:00.000Z';
const period = { starts_at: START, ends_at: END };

describe('fetchChangeImpactEvent (SG2-66)', () => {
  test('[NORMAL] [SG2-66:AC1] reads the planning fields plus name, purpose and description of one event', async () => {
    const queries: string[] = [];
    const row = { event_id: 7, status: 'confirmed', name: 'Gala', outstanding_arrangements: ['venue_recheck'] };
    const result = await fetchChangeImpactEvent(fakeClient({ events: { data: [row], error: null } }, queries), 7);
    assert.deepEqual(result, { ok: true, event: row });
    assert.match(queries[0], /^events event_id, status, coordinator_id, organiser_id, name, purpose, description, .*outstanding_arrangements \| event_id=7$/);
  });

  test('[BOUNDARY] [SG2-66:AC4] a non-array outstanding list reads as empty', async () => {
    const result = await fetchChangeImpactEvent(fakeClient({ events: { data: [{ event_id: 7, outstanding_arrangements: null }], error: null } }), 7);
    assert.deepEqual(result, { ok: true, event: { event_id: 7, outstanding_arrangements: [] } });
  });

  test('[FAILURE] [SG2-66:AC1] a missing event and a database error are told apart', async () => {
    assert.deepEqual(await fetchChangeImpactEvent(fakeClient({ events: { data: [], error: null } }), 7), { ok: false, reason: 'not_found' });
    assert.deepEqual(await fetchChangeImpactEvent(fakeClient({ events: { data: null, error: { message: 'down' } } }), 7),
      { ok: false, reason: 'unavailable' });
  });
});

describe('fetchChangeImpactFacts (SG2-66 AC1-AC3)', () => {
  const responses = (): Record<string, Response> => ({
    venue_bookings: { data: [
      { booking_id: 21, venue_id: 1, ...period },
      { booking_id: 22, venue_id: 2, ...period },
      { booking_id: 23, venue_id: 9, ...period }
    ], error: null },
    venue_booking_requests: { data: [
      { request_id: 31, venue_id: 1, ...period, status: 'approved', venue_booking_id: 21 },
      { request_id: 32, venue_id: 2, ...period, status: 'PENDING', venue_booking_id: null },
      { request_id: 33, venue_id: 2, ...period, status: 'rejected', venue_booking_id: null },
      { request_id: 34, venue_id: 2, ...period, status: 'approved', venue_booking_id: null }
    ], error: null },
    // The second request converted a hold, which records the booking on the hold.
    venue_holds: { data: [{ request_id: 34, booking_id: 22 }, { request_id: 35, booking_id: null }, { request_id: null, booking_id: 21 }], error: null },
    venues: { data: [{ venue_id: 1, name: 'The Kelp Room', capacity: 150 }, { venue_id: 2, name: 'Harbour Hall', capacity: null }], error: null },
    venue_capacity_exceptions: { data: [
      { request_id: 31, expected_attendance: 160, approver_role: 'venue_staff' },
      { request_id: 31, expected_attendance: 200, approver_role: 'venue_staff' },
      { request_id: 31, expected_attendance: 900, approver_role: 'event_organiser' },
      { request_id: 32, expected_attendance: 120, approver_role: 'venue_staff' }
    ], error: null },
    equipment_reservations: { data: [
      { reservation_id: 41, equipment_id: 1, quantity_reserved: 12, ...period, request_id: '51' },
      { reservation_id: 42, equipment_id: 7, quantity_reserved: 1, starts_at: null, ends_at: null, request_id: null }
    ], error: null },
    equipment_requests: { data: [
      { request_id: 51, equipment_id: 1, quantity: 12, ...period, status: 'approved' },
      { request_id: 52, equipment_id: 2, quantity: 2, starts_at: null, ends_at: null, status: 'Pending' },
      { request_id: 53, equipment_id: 2, quantity: 2, ...period, status: 'REJECTED' },
      { request_id: 54, equipment_id: 2, quantity: 2, ...period, status: 'cancelled' }
    ], error: null },
    equipment: { data: [{ equipment_id: 1, name: 'Wireless microphones' }, { equipment_id: 2, name: 'Projectors' }], error: null },
    registrations: { data: [{ status: 'registered' }, { status: null }, { status: 'Cancelled' }], error: null }
  });

  test('[NORMAL] [SG2-66:AC1] [SG2-66:AC2] [SG2-66:AC5] reads bookings, pending venue requests, equipment and registrations with Venue Staff exceptions only', async () => {
    const queries: string[] = [];
    const result = await fetchChangeImpactFacts(fakeClient(responses(), queries), 7);
    assert.deepEqual(result, {
      ok: true,
      facts: {
        venues: [
          { kind: 'venue_booking', id: 21, venue_name: 'The Kelp Room', capacity: 150, ...period, exception_attendance: 200 },
          { kind: 'venue_booking', id: 22, venue_name: 'Harbour Hall', capacity: null, ...period, exception_attendance: null },
          { kind: 'venue_booking', id: 23, venue_name: 'Venue no longer listed', capacity: null, ...period, exception_attendance: null },
          { kind: 'venue_request', id: 32, venue_name: 'Harbour Hall', capacity: null, ...period, exception_attendance: 120 }
        ],
        equipment: [
          { kind: 'equipment_reservation', id: 41, equipment_name: 'Wireless microphones', quantity: 12, ...period },
          { kind: 'equipment_reservation', id: 42, equipment_name: 'Equipment no longer listed', quantity: 1, starts_at: null, ends_at: null },
          { kind: 'equipment_request', id: 52, equipment_name: 'Projectors', quantity: 2, starts_at: null, ends_at: null }
        ],
        registrations: 2
      }
    });
    assert.deepEqual(queries, [
      'venue_bookings booking_id, venue_id, starts_at, ends_at | event_id=7 status=confirmed order booking_id',
      'venue_booking_requests request_id, venue_id, starts_at, ends_at, status, venue_booking_id | event_id=7 order request_id',
      'venue_holds request_id, booking_id | event_id=7',
      'equipment_reservations reservation_id, equipment_id, quantity_reserved, starts_at, ends_at, request_id | event_id=7 order reservation_id',
      'equipment_requests request_id, equipment_id, quantity, starts_at, ends_at, status | event_id=7 order request_id',
      'registrations status | event_id=7',
      'venues venue_id, name, capacity | venue_id in 1,2,9',
      'venue_capacity_exceptions request_id, expected_attendance | request_id in 31,34,32 approver_role=venue_staff',
      'equipment equipment_id, name | equipment_id in 1,7,2'
    ]);
  });

  test('[BOUNDARY] [SG2-66:AC1] an event with nothing arranged reads no venues, exceptions or equipment', async () => {
    const queries: string[] = [];
    const empty = Object.fromEntries(['venue_bookings', 'venue_booking_requests', 'venue_holds', 'equipment_reservations',
      'equipment_requests', 'registrations'].map(table => [table, { data: null, error: null }]));
    assert.deepEqual(await fetchChangeImpactFacts(fakeClient(empty, queries), 7),
      { ok: true, facts: { venues: [], equipment: [], registrations: 0 } });
    assert.equal(queries.length, 6);
  });

  test('[BOUNDARY] [SG2-66:AC1] lookups that return no rows leave names unknown and no exception', async () => {
    const result = await fetchChangeImpactFacts(fakeClient({
      ...responses(),
      venues: { data: null, error: null },
      venue_capacity_exceptions: { data: null, error: null },
      equipment: { data: null, error: null }
    }), 7);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.facts.venues.map(venue => [venue.venue_name, venue.exception_attendance]),
      [['Venue no longer listed', null], ['Venue no longer listed', null], ['Venue no longer listed', null], ['Venue no longer listed', null]]);
    assert.deepEqual(result.facts.equipment.map(item => item.equipment_name),
      ['Equipment no longer listed', 'Equipment no longer listed', 'Equipment no longer listed']);
  });

  test('[FAILURE] [SG2-66:AC1] any failed read makes the facts unavailable', async () => {
    for (const table of ['venue_bookings', 'venue_booking_requests', 'venue_holds', 'equipment_reservations',
      'equipment_requests', 'registrations', 'venues', 'venue_capacity_exceptions', 'equipment']) {
      const result = await fetchChangeImpactFacts(fakeClient({ ...responses(), [table]: { data: null, error: { message: 'down' } } }), 7);
      assert.deepEqual(result, { ok: false, reason: 'unavailable' }, table);
    }
  });
});

const INPUT: ApplyAcceptedEventChangeInput = {
  eventId: 7, actorId: 'coordinator-1', expectedStatus: 'confirmed', changeReference: 'change request mock-7-attendance',
  changes: { expected_attendance: 180 }, outstanding: ['venue_recheck']
};
const APPLIED = {
  outcome: 'ok', previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
  arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck']
};

describe('applyAcceptedEventChange RPC adapter (SG2-66 AC4)', () => {
  test('[NORMAL] [SG2-66:AC4] [SG2-66:AC7] passes every argument to apply_accepted_event_change and returns its outcome', async () => {
    const calls: unknown[] = [];
    assert.deepEqual(await applyAcceptedEventChange(rpcClient(APPLIED, null, calls), INPUT), APPLIED);
    assert.deepEqual(calls, [['apply_accepted_event_change', {
      p_event_id: 7, p_actor_id: 'coordinator-1', p_expected_status: 'confirmed',
      p_change_reference: 'change request mock-7-attendance', p_changes: { expected_attendance: 180 },
      p_outstanding: ['venue_recheck']
    }]]);
  });

  test('[CONFLICT] [SG2-66:AC4] a stale outcome is returned as stale', async () => {
    assert.deepEqual(await applyAcceptedEventChange(rpcClient({ outcome: 'stale' }), INPUT), { outcome: 'stale' });
  });

  test('[FAILURE] [SG2-66:AC4] errors and malformed responses are unavailable', async () => {
    assert.deepEqual(await applyAcceptedEventChange(rpcClient(null, { message: 'down' }), INPUT), { outcome: 'unavailable' });
    for (const data of [null, 'ok', { outcome: 'other' }, { ...APPLIED, previous_status: 1 }, { ...APPLIED, status: null },
      { ...APPLIED, returned_to_planning: 'yes' }, { ...APPLIED, arrangements_recheck_needed: 1 },
      { ...APPLIED, outstanding_arrangements: 'venue_recheck' }, { ...APPLIED, outstanding_arrangements: ['venue'] },
      { ...APPLIED, outstanding_arrangements: [1] }]) {
      assert.deepEqual(await applyAcceptedEventChange(rpcClient(data), INPUT), { outcome: 'unavailable' }, JSON.stringify(data));
    }
  });
});

describe('settleArrangementRecheck RPC adapter (SG2-66 AC4)', () => {
  const SETTLED = { outcome: 'ok', arrangements_recheck_needed: false, outstanding_arrangements: [] };

  test('[NORMAL] [SG2-66:AC4] passes the event, actor and key to settle_arrangement_recheck', async () => {
    const calls: unknown[] = [];
    assert.deepEqual(await settleArrangementRecheck(rpcClient(SETTLED, null, calls), 7, 'coordinator-1', 'venue_recheck'), SETTLED);
    assert.deepEqual(calls, [['settle_arrangement_recheck', { p_event_id: 7, p_actor_id: 'coordinator-1', p_key: 'venue_recheck' }]]);
  });

  test('[CONFLICT] [SG2-66:AC4] not-outstanding and stale refusals are returned as given', async () => {
    for (const outcome of ['not_outstanding', 'stale']) {
      assert.deepEqual(await settleArrangementRecheck(rpcClient({ outcome }), 7, 'c', 'venue_recheck'), { outcome });
    }
  });

  test('[FAILURE] [SG2-66:AC4] errors and malformed responses are unavailable', async () => {
    assert.deepEqual(await settleArrangementRecheck(rpcClient(null, { message: 'down' }), 7, 'c', 'venue_recheck'), { outcome: 'unavailable' });
    for (const data of [undefined, 3, { outcome: 'other' }, { ...SETTLED, arrangements_recheck_needed: null },
      { ...SETTLED, outstanding_arrangements: ['registration'] }]) {
      assert.deepEqual(await settleArrangementRecheck(rpcClient(data), 7, 'c', 'venue_recheck'), { outcome: 'unavailable' }, String(data));
    }
  });
});
