import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createVenueBookingDecisionStore } from './venueBookingDecisions';
import { listNotifications, NOTIFICATION_LIMIT } from './notifications';

test('[NORMAL] [SG2-49:AC1] [SG2-49:AC3] a decision is one database call made with the caller\'s own token', async () => {
  const calls: unknown[] = []; let token = '';
  const updated = { outcome: 'updated', request_id: 41, status: 'approved', venue_booking_id: 9, decided_at: '2030-01-02T00:00:00.000Z' };
  const client = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: updated, error: null, status: 200 }; } } as unknown as SupabaseClient;
  const store = createVenueBookingDecisionStore('staff-token', value => { token = value; return client; });
  assert.deepEqual(await store.decide(41, 'approve', null), updated);
  assert.equal(token, 'staff-token');
  assert.deepEqual(calls, [['decide_venue_booking_request', { p_request_id: 41, p_decision: 'approve', p_reason: null }]]);
});

test('[FAILURE] [SG2-49:AC1] database refusals become sign-in, permission or availability errors without the database text', async () => {
  for (const [status, error, data, expected] of [[401, { code: 'secret' }, null, 401], [403, {}, null, 403],
    [400, { code: '42501' }, null, 403], [500, { code: 'secret' }, null, 503], [200, null, null, 503]] as const) {
    const client = { rpc: async () => ({ status, error, data }) } as unknown as SupabaseClient;
    await assert.rejects(createVenueBookingDecisionStore('token', () => client).decide(41, 'reject', 'No'),
      (failure: unknown) => failure instanceof AccessError && failure.status === expected);
  }
  assert.throws(() => createVenueBookingDecisionStore('token', () => null), (failure: unknown) => failure instanceof AccessError && failure.status === 503);
});

test('[NORMAL] [SG2-49:AC1] [SG2-49:AC2] notifications are read with the caller\'s token, only their own, newest first and capped', async () => {
  const calls: [string, unknown[]][] = []; let token = '';
  const notice = { notification_id: 3, event_id: 7, request_id: 41, kind: 'venue_request_rejected', message: 'Atrium Hall was rejected for Forum: Rewiring', created_at: '2030-01-02T00:00:00.000Z' };
  const builder: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [notice], error: null }).then(resolve) };
  for (const method of ['select', 'eq', 'order', 'range']) builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder; };
  const client = { from: (table: string) => { calls.push(['from', [table]]); return builder; } } as unknown as SupabaseClient;
  assert.deepEqual(await listNotifications('coordinator-token', 'user-coordinator', value => { token = value; return client; }), [notice]);
  assert.equal(token, 'coordinator-token');
  assert.deepEqual(calls.filter(([method]) => method !== 'select'), [['from', ['notifications']], ['eq', ['recipient_id', 'user-coordinator']],
    ['order', ['created_at', { ascending: false }]], ['order', ['notification_id', { ascending: false }]], ['range', [0, NOTIFICATION_LIMIT - 1]]]);
});

test('[FAILURE] [SG2-49:AC1] notifications that cannot be read are reported as temporarily unavailable', async () => {
  for (const result of [{ data: null, error: { message: 'offline' } }, { data: null, error: null }]) {
    const builder: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'eq', 'order', 'range']) builder[method] = () => builder;
    const client = { from: () => builder } as unknown as SupabaseClient;
    await assert.rejects(listNotifications('token', 'user', () => client), (failure: unknown) => failure instanceof AccessError && failure.status === 503);
  }
  await assert.rejects(listNotifications('token', 'user', () => null), (failure: unknown) => failure instanceof AccessError && failure.status === 503);
});
