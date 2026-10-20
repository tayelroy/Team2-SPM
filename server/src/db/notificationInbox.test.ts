import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth';
import { createNotificationInboxStore } from './notificationInbox';

test('[NORMAL] [SG2-69:AC1] [SG2-69:AC2] [SG2-69:AC3] [SG2-69:AC4] [SG2-69:AC6] inbox adapters carry the caller token and exact RPC arguments without a service key', async () => {
  const calls: unknown[] = []; let token = '';
  const client = { rpc: async (name: string, args?: unknown) => {
    calls.push([name, args]); return { data: { rpc: name }, error: null, status: 200 };
  } } as unknown as SupabaseClient;
  const store = createNotificationInboxStore('signed-in-person', value => { token = value; return client; });
  const cursor = { created_at: '2030-01-01T01:02:03.123456Z', source: 'hold' as const, notification_id: 34 };
  assert.deepEqual(await store.inbox(), { rpc: 'notification_inbox' });
  await store.inbox(cursor);
  assert.deepEqual(await store.read('hold', 34), { rpc: 'read_notification' });
  assert.deepEqual(await store.readAll(), { rpc: 'read_all_notifications' });
  assert.deepEqual(await store.event('event', 35), { rpc: 'notification_event' });
  assert.deepEqual(await store.preferences(), { rpc: 'notification_reminder_preferences' });
  assert.deepEqual(await store.setPreferences(30), { rpc: 'set_notification_reminder_preferences' });
  assert.equal(token, 'signed-in-person');
  assert.deepEqual(calls, [
    ['notification_inbox', { p_limit: 50, p_before_created_at: null, p_before_source: null, p_before_id: null }],
    ['notification_inbox', { p_limit: 50, p_before_created_at: cursor.created_at, p_before_source: 'hold', p_before_id: 34 }],
    ['read_notification', { p_source: 'hold', p_notification_id: 34 }], ['read_all_notifications', undefined],
    ['notification_event', { p_source: 'event', p_notification_id: 35 }], ['notification_reminder_preferences', undefined],
    ['set_notification_reminder_preferences', { p_frequency_days: 30 }]
  ]);
});

test('[FAILURE] [SG2-69:AC1] [SG2-69:AC3] upstream failures expose generic status and only a missing owned identity may return null', async () => {
  for (const [status, error, data, expected] of [[401, { code: 'secret' }, null, 401], [403, {}, null, 403],
    [400, { code: '42501' }, null, 403], [500, { code: 'secret' }, null, 503], [200, null, null, 503]] as const) {
    const client = { rpc: async () => ({ status, error, data }) } as unknown as SupabaseClient;
    await assert.rejects(createNotificationInboxStore('token', () => client).inbox(),
      failure => failure instanceof AccessError && failure.status === expected);
  }
  const missing = { rpc: async () => ({ status: 200, error: null, data: null }) } as unknown as SupabaseClient;
  assert.equal(await createNotificationInboxStore('token', () => missing).read('event', 1), null);
  assert.equal(await createNotificationInboxStore('token', () => missing).event('hold', 1), null);
  assert.throws(() => createNotificationInboxStore('token', () => null), failure => failure instanceof AccessError && failure.status === 503);
  assert.throws(() => createNotificationInboxStore('token'), failure => failure instanceof AccessError && failure.status === 503);
});
