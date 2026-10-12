import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createVenueBookingWithdrawalStore } from './venueBookingWithdrawals';

test('[NORMAL] [SG2-82:AC5] a withdrawal is one database call made with the coordinator\'s own token', async () => {
  const calls: unknown[] = []; let token = '';
  const withdrawn = { outcome: 'withdrawn', request_id: 41, withdrawn_at: '2030-01-03T00:00:00.000Z' };
  const client = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: withdrawn, error: null, status: 200 }; } } as unknown as SupabaseClient;
  const store = createVenueBookingWithdrawalStore('coordinator-token', value => { token = value; return client; });
  assert.deepEqual(await store.withdraw(41), withdrawn);
  assert.equal(token, 'coordinator-token');
  assert.deepEqual(calls, [['withdraw_venue_booking_request', { p_request_id: 41 }]]);
});

test('[FAILURE] [SG2-82:AC5] database refusals become sign-in, permission or availability errors without the database text', async () => {
  for (const [status, error, data, expected] of [[401, { code: 'secret' }, null, 401], [403, {}, null, 403],
    [400, { code: '42501' }, null, 403], [500, { code: 'secret' }, null, 503], [200, null, null, 503]] as const) {
    const client = { rpc: async () => ({ status, error, data }) } as unknown as SupabaseClient;
    await assert.rejects(createVenueBookingWithdrawalStore('token', () => client).withdraw(41),
      (failure: unknown) => failure instanceof AccessError && failure.status === expected);
  }
  assert.throws(() => createVenueBookingWithdrawalStore('token', () => null), (failure: unknown) => failure instanceof AccessError && failure.status === 503);
});
