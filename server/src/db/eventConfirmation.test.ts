import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { dbConfig } from './config';
import { confirmEvent, fetchConfirmedArrangements, fetchEventConfirmationRecord } from './eventConfirmation';

const rpcClient = (data: unknown, error: unknown = null, status = 200) =>
  ({ rpc: async () => ({ data, error, status }) }) as unknown as SupabaseClient;

const CONFIRMED = {
  outcome: 'ok', event_id: 7, status: 'confirmed', confirmed_at: '2026-10-11T02:00:00.000Z', organiser_notified: true
};

describe('confirmEvent RPC adapter (SG2-58)', () => {
  test('[NORMAL] [SG2-58:AC1] the caller JWT reaches confirm_event with only the event id and the confirmation is returned', async () => {
    const calls: unknown[] = [];
    let token = '';
    const db = {
      rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: CONFIRMED, error: null, status: 200 }; }
    } as unknown as SupabaseClient;
    const result = await confirmEvent('coordinator-token', 7, value => { token = value; return db; });
    assert.deepEqual(result, CONFIRMED);
    assert.equal(token, 'coordinator-token');
    assert.deepEqual(calls, [['confirm_event', { p_event_id: 7 }]]);
  });

  test('[NORMAL] [SG2-58:AC2] an outstanding refusal keeps the listed keys in venue, equipment, registration order', async () => {
    for (const outstanding of [['venue'], ['equipment'], ['registration'], ['venue', 'equipment', 'registration']]) {
      assert.deepEqual(await confirmEvent('token', 7, () => rpcClient({ outcome: 'outstanding', outstanding })),
        { outcome: 'outstanding', outstanding });
    }
  });

  test('[CONFLICT] [SG2-58:AC1] a status other than Preparation and an unassigned or missing event are refused outcomes', async () => {
    assert.deepEqual(await confirmEvent('token', 7, () => rpcClient({ outcome: 'closed', status: 'confirmed' })),
      { outcome: 'closed', status: 'confirmed' });
    assert.deepEqual(await confirmEvent('token', 7, () => rpcClient({ outcome: 'missing' })), { outcome: 'missing' });
  });

  test('[BOUNDARY] [SG2-58:AC1] a successful confirmation that reports no organiser notice is still accepted as given', async () => {
    const quiet = { ...CONFIRMED, organiser_notified: false };
    assert.deepEqual(await confirmEvent('token', 2147483647, () => rpcClient({ ...quiet, event_id: 2147483647 })),
      { ...quiet, event_id: 2147483647 });
  });

  test('[FAILURE] [SG2-58:AC1] absent, unrecognised or malformed RPC responses fail closed as unavailable', async () => {
    for (const data of [
      null, undefined, 'ok', {}, [], { outcome: 'unknown' },
      { ...CONFIRMED, event_id: '7' }, { ...CONFIRMED, status: 'preparation' }, { ...CONFIRMED, confirmed_at: null },
      { ...CONFIRMED, organiser_notified: 'yes' },
      { outcome: 'closed' }, { outcome: 'outstanding' }, { outcome: 'outstanding', outstanding: [] },
      { outcome: 'outstanding', outstanding: ['venue', 'catering'] }
    ]) {
      await assert.rejects(confirmEvent('token', 7, () => rpcClient(data)),
        (error: unknown) => error instanceof AccessError && error.status === 503, JSON.stringify(data));
    }
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-58:AC1] role, session and provider failures map to safe 403, 401 and 503 errors', async () => {
    for (const [status, code, expected] of [
      [400, '42501', 403], [403, 'DENIED', 403], [400, '28000', 401], [401, 'PGRST301', 401], [401, 'AUTH', 401],
      [500, 'XX000', 503], [400, 'P0001', 503]
    ] as const) {
      await assert.rejects(
        confirmEvent('token', 7, () => rpcClient(null, { code, message: 'PRIVATE_DATABASE_DETAIL' }, status)),
        (error: unknown) => error instanceof AccessError && error.status === expected
          && !error.message.includes('PRIVATE_DATABASE_DETAIL'),
        `${status} ${code}`
      );
    }
  });

  test('[FAILURE] [SG2-58:AC1] missing user-scoped configuration never falls back to service credentials', async () => {
    await assert.rejects(confirmEvent('token', 7, () => null), { status: 503 });
    const original = { ...dbConfig };
    try {
      dbConfig.supabaseUrl = undefined;
      await assert.rejects(confirmEvent('token', 7), { status: 503 });
    } finally {
      Object.assign(dbConfig, original);
    }
  });
});

type Response = { data: unknown; error: unknown };
/** Records each table's selected columns and filters, answering per table. */
function adminClient(responses: Record<string, Response>, calls: string[] = []) {
  return {
    from(table: string) {
      const query = {
        select(columns: string) { calls.push(`${table}.select(${columns})`); return query; },
        eq(column: string, value: unknown) { calls.push(`${table}.eq(${column},${String(value)})`); return query; },
        in(column: string, values: unknown[]) { calls.push(`${table}.in(${column},${values.join('|')})`); return query; },
        order(column: string, options: { ascending: boolean }) {
          calls.push(`${table}.order(${column},${options.ascending})`); return query;
        },
        async maybeSingle() { calls.push(`${table}.maybeSingle`); return responses[table]; },
        then(resolve: (value: Response) => unknown) { return Promise.resolve(responses[table]).then(resolve); }
      };
      return query;
    }
  } as unknown as SupabaseClient;
}

const RECORD = {
  event_id: 7, status: 'confirmed', organiser_id: 'organiser-1', coordinator_id: 'coordinator-1',
  confirmed_at: '2026-10-11T02:00:00.000Z', registration_needed: true, registration_capacity: 120,
  registration_opens_at: '2030-06-01T00:00:00.000Z', registration_closes_at: '2030-06-19T16:00:00.000Z'
};

describe('Confirmation view reads (SG2-58)', () => {
  test('[NORMAL] [SG2-58:AC1] reads one event row with only the confirmation and registration fields', async () => {
    const calls: string[] = [];
    assert.deepEqual(await fetchEventConfirmationRecord(adminClient({ events: { data: RECORD, error: null } }, calls), 7),
      { ok: true, event: RECORD });
    assert.deepEqual(calls, [
      'events.select(event_id, status, organiser_id, coordinator_id, confirmed_at, registration_needed, '
        + 'registration_capacity, registration_opens_at, registration_closes_at)',
      'events.eq(event_id,7)',
      'events.maybeSingle'
    ]);
  });

  test('[FAILURE] [SG2-58:AC1] a missing event is not_found and a read error is unavailable', async () => {
    assert.deepEqual(await fetchEventConfirmationRecord(adminClient({ events: { data: null, error: null } }), 7),
      { ok: false, reason: 'not_found' });
    assert.deepEqual(await fetchEventConfirmationRecord(adminClient({ events: { data: null, error: { message: 'boom' } } }), 7),
      { ok: false, reason: 'unavailable' });
  });

  test('[NORMAL] [SG2-58:AC1] names confirmed venue bookings and reserved equipment in booking and receipt order', async () => {
    const calls: string[] = [];
    const result = await fetchConfirmedArrangements(adminClient({
      venue_bookings: { data: [
        { venue_id: 1, starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' },
        { venue_id: 2, starts_at: '2030-06-20T03:00:00.000Z', ends_at: '2030-06-20T05:00:00.000Z' },
        { venue_id: 1, starts_at: '2030-06-21T02:00:00.000Z', ends_at: '2030-06-21T04:00:00.000Z' }
      ], error: null },
      equipment_reservations: { data: [{ equipment_id: 4, quantity_reserved: 12 }, { equipment_id: 5, quantity_reserved: 2 }], error: null },
      venues: { data: [{ venue_id: 1, name: 'Regression Hall' }, { venue_id: 2, name: 'Quiet Room' }], error: null },
      equipment: { data: [{ equipment_id: 4, name: 'Wireless microphones' }, { equipment_id: 5, name: 'Projector' }], error: null }
    }, calls), 7);
    assert.deepEqual(result, {
      ok: true,
      arrangements: {
        venues: [
          { venue_name: 'Regression Hall', starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' },
          { venue_name: 'Quiet Room', starts_at: '2030-06-20T03:00:00.000Z', ends_at: '2030-06-20T05:00:00.000Z' },
          { venue_name: 'Regression Hall', starts_at: '2030-06-21T02:00:00.000Z', ends_at: '2030-06-21T04:00:00.000Z' }
        ],
        equipment: [
          { equipment_type: 'Wireless microphones', quantity_reserved: 12 },
          { equipment_type: 'Projector', quantity_reserved: 2 }
        ]
      }
    });
    assert.deepEqual(calls, [
      'venue_bookings.select(venue_id, starts_at, ends_at)', 'venue_bookings.eq(event_id,7)',
      'venue_bookings.eq(status,confirmed)', 'venue_bookings.order(starts_at,true)',
      'equipment_reservations.select(equipment_id, quantity_reserved)', 'equipment_reservations.eq(event_id,7)',
      'equipment_reservations.order(reservation_id,true)',
      'venues.select(venue_id, name)', 'venues.in(venue_id,1|2)',
      'equipment.select(equipment_id, name)', 'equipment.in(equipment_id,4|5)'
    ]);
  });

  test('[BOUNDARY] [SG2-58:AC1] nothing booked or reserved skips the name lookups; an unnamed row still shows', async () => {
    const calls: string[] = [];
    assert.deepEqual(await fetchConfirmedArrangements(adminClient({
      venue_bookings: { data: null, error: null }, equipment_reservations: { data: null, error: null }
    }, calls), 7), { ok: true, arrangements: { venues: [], equipment: [] } });
    assert.equal(calls.some(call => call.startsWith('venues.') || call.startsWith('equipment.')), false);

    assert.deepEqual(await fetchConfirmedArrangements(adminClient({
      venue_bookings: { data: [{ venue_id: 9, starts_at: 's', ends_at: 'e' }], error: null },
      equipment_reservations: { data: [{ equipment_id: 8, quantity_reserved: 1 }], error: null },
      venues: { data: null, error: null }, equipment: { data: null, error: null }
    }), 7), {
      ok: true,
      arrangements: {
        venues: [{ venue_name: 'Venue no longer listed', starts_at: 's', ends_at: 'e' }],
        equipment: [{ equipment_type: 'Equipment no longer listed', quantity_reserved: 1 }]
      }
    });
  });

  test('[FAILURE] [SG2-58:AC1] any failed read makes the confirmed arrangements unavailable', async () => {
    const ok = { data: [], error: null };
    const failed = { data: null, error: { message: 'boom' } };
    const booking = { data: [{ venue_id: 1, starts_at: 's', ends_at: 'e' }], error: null };
    const receipt = { data: [{ equipment_id: 4, quantity_reserved: 1 }], error: null };
    for (const responses of [
      { venue_bookings: failed, equipment_reservations: ok },
      { venue_bookings: ok, equipment_reservations: failed },
      { venue_bookings: booking, equipment_reservations: ok, venues: failed },
      { venue_bookings: ok, equipment_reservations: receipt, equipment: failed }
    ] as Record<string, Response>[]) {
      assert.deepEqual(await fetchConfirmedArrangements(adminClient(responses), 7), { ok: false, reason: 'unavailable' });
    }
  });
});
