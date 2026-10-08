import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEquipmentRequirementsStore, type RequirementsResult } from './equipmentRequirements';
import { AccessError } from '../auth';
import { dbConfig } from './config';

const view = { outcome: 'ok' as const, event: { event_id: 7, name: 'Forum', status: 'approved' },
  requests: [], equipment: [{ equipment_id: 4, type: 'Projector' }], venues: [], can_request: true, can_arrange: false };
function client(result: unknown) {
  return { rpc: async () => result } as unknown as SupabaseClient;
}
test('[NORMAL] [SG2-53:AC1] [SG2-53:AC2] [SG2-53:AC4] all operations use one RPC with the caller token and explicit nullable arguments', async () => {
  const calls: unknown[] = [];
  let token: string | undefined;
  const db = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: view, error: null, status: 200 }; } } as unknown as SupabaseClient;
  const store = createEquipmentRequirementsStore('coordinator-token', value => { token = value; return db; });
  const values = { equipment_id: 4, quantity: 2, notes: 'HDMI' };
  assert.deepEqual(await store.run('read', 7), view);
  assert.deepEqual(await store.run('create', 7, undefined, undefined, values), view);
  assert.deepEqual(await store.run('amend', 7, 11, 3, values), view);
  const arrangement = { arrangement_notes: 'One ready', shortfall: 1, placement_venue_id: 9, placement_position: 'Stage left' };
  assert.deepEqual(await store.run('arrange', 7, 11, 4, arrangement), view);
  assert.equal(token, 'coordinator-token');
  assert.deepEqual(calls, [
    ['manage_equipment_requirements', { p_action: 'read', p_event_id: 7, p_request_id: null, p_version: null, p_values: null }],
    ['manage_equipment_requirements', { p_action: 'create', p_event_id: 7, p_request_id: null, p_version: null, p_values: values }],
    ['manage_equipment_requirements', { p_action: 'amend', p_event_id: 7, p_request_id: 11, p_version: 3, p_values: values }],
    ['manage_equipment_requirements', { p_action: 'arrange', p_event_id: 7, p_request_id: 11, p_version: 4, p_values: arrangement }]
  ]);
});
test('[CONFLICT] [SG2-53:AC2] [SG2-53:AC3] database refusals are preserved without inventing successful writes', async () => {
  for (const outcome of ['missing', 'closed', 'conflict', 'duplicate', 'invalid'] as const) {
    const result: RequirementsResult = { outcome };
    assert.deepEqual(await createEquipmentRequirementsStore('token', () => client({ data: result, error: null, status: 200 })).run('amend', 7, 11, 1), result);
  }
});
test('[BOUNDARY] [FAILURE] [SG2-53:AC1] an absent or unrecognised RPC result fails closed', async () => {
  for (const data of [null, undefined, false, 0, '', {}, [], { outcome: 'unknown' }]) {
    await assert.rejects(createEquipmentRequirementsStore('token', () => client({ data, error: null, status: 200 })).run('read', 7),
      (error: unknown) => error instanceof AccessError && error.status === 503);
  }
});
test('[FAILURE] [SG2-53:AC4] [SG2-53:AC6] authentication, policy and storage errors expose only safe statuses', async () => {
  for (const [status, code, expected] of [[401, 'AUTH', 401], [403, 'AUTH', 403], [400, '42501', 403], [500, 'DB_PRIVATE', 503]] as const) {
    await assert.rejects(createEquipmentRequirementsStore('token', () => client({ data: null, error: { code, message: 'PRIVATE_DATABASE_DETAIL' }, status })).run('read', 7),
      (error: unknown) => error instanceof AccessError && error.status === expected && !error.message.includes('PRIVATE_DATABASE_DETAIL'));
  }
});
test('[FAILURE] [SG2-53:AC1] unavailable user-scoped configuration never falls back to an administrative client', () => {
  assert.throws(() => createEquipmentRequirementsStore('token', () => null), (error: unknown) => error instanceof AccessError && error.status === 503);
  const original = { ...dbConfig };
  try {
    dbConfig.supabaseUrl = undefined;
    assert.throws(() => createEquipmentRequirementsStore('token'), (error: unknown) => error instanceof AccessError && error.status === 503);
  } finally { Object.assign(dbConfig, original); }
});
