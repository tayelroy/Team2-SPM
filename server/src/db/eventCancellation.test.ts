import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { cancelEvent, requestEventCancellation } from './eventCancellation';

const rpcClient = (data: unknown, error: unknown = null, status = 200) =>
  ({ rpc: async () => ({ data, error, status }) }) as unknown as SupabaseClient;

const REQUESTED = { outcome: 'ok', event_id: 7, cancellation_requested_at: '2026-10-21T07:00:00Z', coordinator_notified: true };
const CANCELLED = {
  outcome: 'ok', event_id: 7, status: 'cancelled', cancelled_at: '2026-10-21T08:00:00Z', bookings_released: 2, attendees_notified: 0
};

describe('cancellation RPC adapters (SG2-67)', () => {
  test('[NORMAL] [SG2-67:AC1] the caller JWT reaches each RPC with exactly its arguments, and the answer is returned', async () => {
    const calls: unknown[] = [];
    const tokens: string[] = [];
    const db = (data: unknown) => ({
      rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data, error: null, status: 200 }; }
    }) as unknown as SupabaseClient;
    assert.deepEqual(await requestEventCancellation('organiser-token', 7, 'Speaker withdrew',
      token => { tokens.push(token); return db(REQUESTED); }), REQUESTED);
    assert.deepEqual(await cancelEvent('coordinator-token', 7, token => { tokens.push(token); return db(CANCELLED); }), CANCELLED);
    assert.deepEqual(tokens, ['organiser-token', 'coordinator-token']);
    assert.deepEqual(calls, [
      ['request_event_cancellation', { p_event_id: 7, p_reason: 'Speaker withdrew' }],
      ['cancel_event', { p_event_id: 7 }]
    ]);
  });

  test('[CONFLICT] [SG2-67:AC1] [SG2-67:AC5] refusal outcomes come back unchanged', async () => {
    for (const data of [{ outcome: 'invalid' }, { outcome: 'missing' }, { outcome: 'closed', status: 'cancelled' },
      { outcome: 'requested', cancellation_requested_at: '2026-10-21T07:00:00Z' }]) {
      assert.deepEqual(await requestEventCancellation('t', 7, 'r', () => rpcClient(data)), data);
    }
    for (const data of [{ outcome: 'invalid' }, { outcome: 'missing' }, { outcome: 'not_requested' },
      { outcome: 'closed', status: 'completed' }]) {
      assert.deepEqual(await cancelEvent('t', 7, () => rpcClient(data)), data);
    }
  });

  test('[BOUNDARY] [SG2-67:AC2] [SG2-67:AC3] zero released venues and zero notified attendees are valid counts; negative or fractional ones are not', async () => {
    const none = { ...CANCELLED, bookings_released: 0, attendees_notified: 0 };
    assert.deepEqual(await cancelEvent('t', 7, () => rpcClient(none)), none);
    for (const bad of [{ bookings_released: -1 }, { attendees_notified: 1.5 }]) {
      await assert.rejects(cancelEvent('t', 7, () => rpcClient({ ...CANCELLED, ...bad })),
        (error: unknown) => error instanceof AccessError && error.status === 503);
    }
  });

  test('[FAILURE] [SG2-67:AC1] absent, unrecognised or malformed answers fail closed as unavailable', async () => {
    for (const data of [null, 'ok', {}, { outcome: 'other' }, { ...REQUESTED, event_id: '7' },
      { ...REQUESTED, cancellation_requested_at: null }, { ...REQUESTED, coordinator_notified: 'yes' },
      { outcome: 'closed' }, { outcome: 'requested' }]) {
      await assert.rejects(requestEventCancellation('t', 7, 'r', () => rpcClient(data)),
        (error: unknown) => error instanceof AccessError && error.status === 503, JSON.stringify(data));
    }
    for (const data of [null, 7, { outcome: 'other' }, { ...CANCELLED, event_id: null }, { ...CANCELLED, status: 'planning' },
      { ...CANCELLED, cancelled_at: 1 }, { outcome: 'closed' }]) {
      await assert.rejects(cancelEvent('t', 7, () => rpcClient(data)),
        (error: unknown) => error instanceof AccessError && error.status === 503, JSON.stringify(data));
    }
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-67:AC1] role, session and provider failures map to safe 403, 401 and 503 errors', async () => {
    for (const [error, status, expected] of [
      [{ code: '42501' }, 400, 403], [{ code: 'x' }, 403, 403],
      [{ code: '28000' }, 400, 401], [{ code: 'PGRST301' }, 400, 401], [{ code: 'x' }, 401, 401],
      [{ code: 'XX000' }, 500, 503]
    ] as const) {
      await assert.rejects(cancelEvent('t', 7, () => rpcClient(null, error, status)),
        (thrown: unknown) => thrown instanceof AccessError && thrown.status === expected);
    }
    await assert.rejects(requestEventCancellation('t', 7, 'r', () => null),
      (thrown: unknown) => thrown instanceof AccessError && thrown.status === 503);
  });
});
