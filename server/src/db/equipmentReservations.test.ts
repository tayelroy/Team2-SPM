import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth';
import { dbConfig } from './config';
import { createEquipmentReservationsStore, type ReservationsResult } from './equipmentReservations';

const ready: ReservationsResult = { outcome: 'ok', can_reserve: true, coordinator_notified: true,
  reservations: [{ reservation_id: 21, event_id: 7, request_id: 11, equipment_id: 4,
    equipment_type: 'Microphone', quantity_reserved: 6, starts_at: '2030-01-01T09:00:00Z',
    ends_at: '2030-01-01T11:00:00Z', reserved_at: '2026-10-11T02:00:00Z' }] };
const period = { starts_at: '2030-01-01T09:00:00.000Z', ends_at: '2030-01-01T11:00:00.000Z' };
const client = (data: unknown, error: unknown = null, status = 200) => ({ rpc: async () => ({ data, error, status }) }) as unknown as SupabaseClient;

test('[NORMAL] [SG2-55:AC1] [SG2-55:AC4] the caller JWT reaches the reservation transaction with exact read and reserve arguments', async () => {
  const calls: unknown[] = []; let token = '';
  const db = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: ready, error: null, status: 200 }; } } as unknown as SupabaseClient;
  const store = createEquipmentReservationsStore('support-token', value => { token = value; return db; });
  assert.deepEqual(await store.run('read', 7), ready);
  assert.deepEqual(await store.run('reserve', 7, 11, 3, period), ready);
  assert.equal(token, 'support-token');
  assert.deepEqual(calls, [
    ['manage_equipment_reservations', { p_action: 'read', p_event_id: 7, p_request_id: null, p_version: null, p_starts_at: null, p_ends_at: null }],
    ['manage_equipment_reservations', { p_action: 'reserve', p_event_id: 7, p_request_id: 11, p_version: 3, p_starts_at: period.starts_at, p_ends_at: period.ends_at }]
  ]);
});
test('[BOUNDARY] [SG2-55:AC4] legacy undated receipts and empty read-only event records are preserved', async () => {
  for (const result of [{ outcome: 'ok', can_reserve: false, reservations: [] },
    { ...ready, reservations: [{ ...ready.reservations[0], request_id: null, starts_at: null, ends_at: null, reserved_at: null }] }]) {
    assert.deepEqual(await createEquipmentReservationsStore('token', () => client(result)).run('read', 7), result);
  }
});
test('[CONFLICT] [SG2-55:AC3] database stock conflicts and invalid or closed requests remain refused outcomes', async () => {
  for (const outcome of ['missing', 'invalid', 'closed', 'conflict', 'insufficient']) {
    assert.deepEqual(await createEquipmentReservationsStore('token', () => client({ outcome })).run('reserve', 7, 11, 3, period), { outcome });
  }
});
test('[FAILURE] [SG2-55:AC1] absent or unrecognised reservation responses fail closed', async () => {
  for (const data of [null, undefined, false, '', {}, [], { outcome: 'unknown' }]) {
    await assert.rejects(createEquipmentReservationsStore('token', () => client(data)).run('read', 7),
      (error: unknown) => error instanceof AccessError && error.status === 503);
  }
});
test('[FAILURE] [SG2-55:AC1] stored-role refusals and provider failures use safe authentication permission or service errors', async () => {
  for (const [status, code, expected] of [[401, 'AUTH', 401], [403, 'DENIED', 403], [400, '42501', 403], [500, 'PRIVATE', 503]] as const) {
    await assert.rejects(createEquipmentReservationsStore('token', () => client(null, { code, message: 'PRIVATE_DATABASE_DETAIL' }, status)).run('reserve', 7, 11, 3, period),
      (error: unknown) => error instanceof AccessError && error.status === expected && !error.message.includes('PRIVATE_DATABASE_DETAIL'));
  }
});
test('[FAILURE] [SG2-55:AC1] missing user-scoped configuration never falls back to service credentials', () => {
  assert.throws(() => createEquipmentReservationsStore('token', () => null), { status: 503 });
  const original = { ...dbConfig };
  try { dbConfig.supabaseUrl = undefined; assert.throws(() => createEquipmentReservationsStore('token'), { status: 503 }); }
  finally { Object.assign(dbConfig, original); }
});
