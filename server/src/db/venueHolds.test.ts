import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createVenueHoldStore } from './venueHolds';
import { AccessError } from '../auth';

test('[NORMAL] [SG2-84:AC1] [SG2-84:AC5] [SG2-84:AC6] [SG2-85:AC4] RPC store carries caller token and exact transactional arguments', async () => {
  const calls: unknown[] = []; let token = '';
  const client = { rpc: async (name: string, args?: unknown) => { calls.push([name, args]); return { data: name, error: null, status: 200 }; } } as unknown as SupabaseClient;
  const store = createVenueHoldStore('user-token', value => { token = value; return client; });
  assert.equal(await store.list(), 'list_venue_holds');
  assert.equal(await store.options(), 'venue_hold_options');
  assert.equal(await store.notifications(), 'list_venue_hold_notifications');
  assert.equal(await store.create({ event_id: 2, venue_id: 3, starts_at: 'start', ends_at: 'end', expires_at: 'expiry' }), 'create_venue_hold');
  assert.equal(await store.change(4, 'release'), 'change_venue_hold');
  assert.equal(await store.change(4, 'convert'), 'change_venue_hold');
  assert.equal(token, 'user-token');
  assert.deepEqual(calls, [['list_venue_holds', undefined], ['venue_hold_options', undefined], ['list_venue_hold_notifications', undefined],
    ['create_venue_hold', { p_event_id: 2, p_venue_id: 3, p_starts_at: 'start', p_ends_at: 'end', p_expires_at: 'expiry' }],
    ['change_venue_hold', { p_hold_id: 4, p_action: 'release' }], ['change_venue_hold', { p_hold_id: 4, p_action: 'convert' }]]);
});
test('[FAILURE] [SG2-84:AC1] RPC failures are translated without disclosing database error text', async () => {
  for (const [status, error, data, expected] of [[401, { code: 'secret' }, null, 401], [403, {}, null, 403],
    [400, { code: '42501' }, null, 403], [500, { code: 'secret' }, null, 503], [200, null, null, 503]] as const) {
    const client = { rpc: async () => ({ status, error, data }) } as unknown as SupabaseClient;
    await assert.rejects(createVenueHoldStore('token', () => client).list(), failure => failure instanceof AccessError && failure.status === expected);
  }
  assert.throws(() => createVenueHoldStore('token', () => null), failure => failure instanceof AccessError && failure.status === 503);
  assert.throws(() => createVenueHoldStore('token'), failure => failure instanceof AccessError && failure.status === 503);
});
