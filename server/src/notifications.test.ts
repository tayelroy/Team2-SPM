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
  organiser: { userId: 'user-organiser', role: 'event_organiser' },
  lead: { userId: 'user-lead', role: 'event_coordinator_lead' },
  safety: { userId: 'user-safety', role: 'safety_officer' },
  attendee: { userId: 'user-attendee', role: 'attendee' }
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
  assert.equal((await request(app(async () => [notice])).get('/api/notifications').set('Authorization', 'Bearer attendee')).status, 403);
  for (const [error, status] of [[new AccessError(403), 403], [new Error('offline'), 503]] as const) {
    const response = await request(app(async () => { throw error; })).get('/api/notifications').set('Authorization', 'Bearer coordinator');
    assert.deepEqual([response.status, response.body], [status, { error: new AccessError(status).message }]);
  }
  // The default store cannot read without a configured database.
  assert.equal((await request(app()).get('/api/notifications').set('Authorization', 'Bearer coordinator')).status, 503);
});

test('[NORMAL] [SG2-51:AC4] an Event Organiser reads their own notices, such as a released venue', async () => {
  const released = { ...notice, kind: 'venue_booking_released' as const, message: 'Atrium Hall was released for Leadership Forum: Moved online' };
  let asked: unknown[] = [];
  const response = await request(app(async (...args) => { asked = args; return [released]; }))
    .get('/api/notifications').set('Authorization', 'Bearer organiser');
  assert.deepEqual([response.status, response.body], [200, { notifications: [released] }]);
  assert.deepEqual(asked, ['organiser', 'user-organiser']);
});

test('[NORMAL] [SG2-68:AC1] [SG2-68:AC2] the Event Coordinator Lead reads their own submitted-event notices', async () => {
  const submitted = { ...notice, request_id: null, kind: 'event_submitted' as const,
    message: 'Leadership Forum was submitted and is waiting for a coordinator.' };
  let asked: unknown[] = [];
  const response = await request(app(async (...args) => { asked = args; return [submitted]; }))
    .get('/api/notifications').set('Authorization', 'Bearer lead');
  assert.deepEqual([response.status, response.body], [200, { notifications: [submitted] }]);
  assert.deepEqual(asked, ['lead', 'user-lead']);
});

test('[FAILURE] [SG2-68:AC3] a Safety Officer, who has no event notices, is refused before any store read', async () => {
  let reads = 0;
  const response = await request(app(async () => { reads += 1; return [notice]; }))
    .get('/api/notifications').set('Authorization', 'Bearer safety');
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});


test('[NORMAL] [SG2-81:AC1] [SG2-81:AC6] a coordinator and organiser read their own venue disruption warning without changing its facts', async () => {
  const unavailable: NotificationRecord = { ...notice, request_id: null, kind: 'venue_unavailable',
    message: 'QA room is unavailable on 14 Nov: maintenance. Find a replacement venue; the event requirements are unchanged.' };
  for (const role of ['coordinator', 'organiser'] as const) {
    const calls: string[][] = [];
    const response = await request(app(async (token, userId) => { calls.push([token, userId]); return [unavailable, notice]; }))
      .get('/api/notifications').set('Authorization', `Bearer ${role}`);
    assert.deepEqual([response.status, response.body], [200, { notifications: [unavailable, notice] }]);
    assert.deepEqual(calls, [[role, USERS[role].userId]]);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});
