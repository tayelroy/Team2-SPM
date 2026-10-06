import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAuthorization, AccessError, type Role } from './auth';
import { dbConfig } from './db';
import type { NotificationRecord } from './db/notifications';
import { createNotificationsRouter } from './notifications';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const USERS: Record<string, { userId: string; role: Role }> = {
  coordinator: { userId: 'user-coordinator', role: 'event_coordinator' },
  support: { userId: 'user-support', role: 'technical_support_staff' },
  organiser: { userId: 'user-organiser', role: 'event_organiser' }
};

const notice: NotificationRecord = { notification_id: 3, event_id: 7, request_id: 41, kind: 'venue_request_approved',
  message: 'Atrium Hall was approved for Leadership Forum.', created_at: '2030-01-02T00:00:00.000Z' };

function app(list?: Parameters<typeof createNotificationsRouter>[1]) {
  const access = createAuthorization({
    resolvePrincipal: async token => { const user = USERS[token]; if (!user) throw new AccessError(401); return user; }
  });
  const composed = express();
  composed.use('/api/notifications', createNotificationsRouter(access, list));
  return composed;
}

test('[NORMAL] [SG2-49:AC1] a signed-in person reads their own notifications, uncached', async () => {
  const calls: [string, string][] = [];
  const response = await request(app(async (token, userId) => { calls.push([token, userId]); return [notice]; }))
    .get('/api/notifications').set('Authorization', 'Bearer coordinator');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { notifications: [notice] });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(calls, [['coordinator', 'user-coordinator']]);
});

test('[BOUNDARY] [SG2-49:AC2] someone with no notifications gets an empty list', async () => {
  const response = await request(app(async () => [])).get('/api/notifications').set('Authorization', 'Bearer support');
  assert.deepEqual([response.status, response.body], [200, { notifications: [] }]);
});

test('[FAILURE] [SG2-49:AC1] notifications need a sign-in and a role with a notifications drawer; an unavailable store is reported without details', async () => {
  assert.equal((await request(app(async () => [notice])).get('/api/notifications')).status, 401);
  assert.equal((await request(app(async () => [notice])).get('/api/notifications').set('Authorization', 'Bearer organiser')).status, 403);
  for (const [error, status] of [[new AccessError(403), 403], [new Error('offline'), 503]] as const) {
    const response = await request(app(async () => { throw error; })).get('/api/notifications').set('Authorization', 'Bearer coordinator');
    assert.deepEqual([response.status, response.body], [status, { error: new AccessError(status).message }]);
  }
  // The default store cannot read without a configured database.
  assert.equal((await request(app()).get('/api/notifications').set('Authorization', 'Bearer coordinator')).status, 503);
});
