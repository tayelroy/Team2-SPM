import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth';
import { dbConfig } from './config';
import { createEquipmentAvailabilityStore, type EquipmentAvailabilityResult } from './equipmentAvailability';
const ready: EquipmentAvailabilityResult = { outcome: 'ok', event_id: 7, request_id: 11, equipment_id: 4,
  equipment_type: 'Microphone', quantity_requested: 6, quantity_held: 10, quantity_committed: 7,
  quantity_remaining: 3, shortfall: 3, undated_commitments: 1, operational_status: 'operational',
  starts_at: '2030-01-01T09:00:00.000Z', ends_at: '2030-01-01T11:00:00.000Z', period_source: 'request', checked_at: '2026-10-09T02:00:00.000Z' };
const client = (data: unknown, error: unknown = null, status = 200) => ({ rpc: async () => ({ data, error, status }) }) as unknown as SupabaseClient;
test('[NORMAL] [SG2-54:AC1] [SG2-54:AC3] availability uses the caller JWT and one read-only RPC with exact period arguments', async () => {
  const calls: unknown[] = []; let token = '';
  const db = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: ready, error: null, status: 200 }; } } as unknown as SupabaseClient;
  const store = createEquipmentAvailabilityStore('support-token', value => { token = value; return db; });
  assert.deepEqual(await store.run(7, 11), ready);
  assert.deepEqual(await store.run(7, 11, { starts_at: ready.starts_at, ends_at: ready.ends_at }), ready);
  assert.equal(token, 'support-token');
  assert.deepEqual(calls, [
    ['check_equipment_availability', { p_event_id: 7, p_request_id: 11, p_starts_at: null, p_ends_at: null }],
    ['check_equipment_availability', { p_event_id: 7, p_request_id: 11, p_starts_at: ready.starts_at, p_ends_at: ready.ends_at }]
  ]);
});
test('[BOUNDARY] [SG2-54:AC1] commitments larger than int32 and missing dates retain the exact database result', async () => {
  for (const result of [{ ...ready, quantity_committed: 4294967294, quantity_remaining: 0, shortfall: 6 },
    { outcome: 'dates_required', proposed_start: null }, { outcome: 'dates_required', proposed_start: '2030-01-01T09:00:00Z' }]) {
    assert.deepEqual(await createEquipmentAvailabilityStore('token', () => client(result)).run(7, 11), result);
  }
});
test('[CONFLICT] [SG2-54:AC1] database missing and invalid outcomes are preserved without inventing stock', async () => {
  for (const outcome of ['missing', 'invalid']) assert.deepEqual(await createEquipmentAvailabilityStore('token', () => client({ outcome })).run(7, 11), { outcome });
});
test('[FAILURE] [SG2-54:AC1] unknown or absent RPC data fails closed', async () => {
  for (const data of [null, undefined, false, '', {}, [], { outcome: 'unknown' }]) {
    await assert.rejects(createEquipmentAvailabilityStore('token', () => client(data)).run(7, 11),
      (error: unknown) => error instanceof AccessError && error.status === 503);
  }
});
test('[FAILURE] [SG2-54:AC1] current-role refusals and provider failures become safe authentication permission or service errors', async () => {
  for (const [status, code, expected] of [[401, 'AUTH', 401], [403, 'DENIED', 403], [400, '42501', 403], [500, 'PRIVATE', 503]] as const) {
    await assert.rejects(createEquipmentAvailabilityStore('token', () => client(null, { code, message: 'PRIVATE_DATABASE_DETAIL' }, status)).run(7, 11),
      (error: unknown) => error instanceof AccessError && error.status === expected && !error.message.includes('PRIVATE_DATABASE_DETAIL'));
  }
});
test('[FAILURE] [SG2-54:AC1] unavailable user-scoped configuration does not fall back to service role', () => {
  assert.throws(() => createEquipmentAvailabilityStore('token', () => null), { status: 503 });
  const original = { ...dbConfig };
  try { dbConfig.supabaseUrl = undefined; assert.throws(() => createEquipmentAvailabilityStore('token'), { status: 503 }); }
  finally { Object.assign(dbConfig, original); }
});
