import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAuthorization, AccessError, ROLES, type Role } from './auth';
import { currentActingRole } from './auth/actingRole';
import { dbConfig } from './db';
import type { NotificationInboxStore } from './db/notificationInbox';
import { createNotificationsRouter } from './notifications';

before(() => { for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined; });
const notice = { source: 'event' as const, notification_id: 3, event_id: 7, kind: 'outstanding_arrangements',
  message: 'Leadership Forum: Venue booking and equipment are outstanding.', created_at: '2030-01-02T00:00:00.123456Z', read_at: null };
const page = { notifications: [notice], unread_count: 73, next_cursor: { created_at: notice.created_at, source: notice.source, notification_id: 3 } };
function app(factory?: Parameters<typeof createNotificationsRouter>[2]) {
  const access = createAuthorization({ resolvePrincipal: async token => {
    if (!(ROLES as readonly string[]).includes(token)) throw new AccessError(401);
    return { userId: `person-${token}`, role: token as Role };
  } });
  return express().use(express.json({ strict: false })).use('/api/notifications', createNotificationsRouter(access, async () => [], factory));
}
function store(overrides: Partial<NotificationInboxStore> = {}): NotificationInboxStore {
  return { inbox: async () => page, read: async () => ({ notification: { ...notice, read_at: '2030-01-03T00:00:00Z' }, unread_count: 72 }),
    readAll: async () => ({ unread_count: 0 }), event: async () => ({ event_id: 7, name: 'Leadership Forum', status: 'preparation', proposed_date: null }),
    preferences: async () => ({ frequency_days: 1 }), setPreferences: async days => ({ frequency_days: days }), ...overrides };
}
const auth = (role = 'event_coordinator') => ({ Authorization: `Bearer ${role}` });

test('[NORMAL] [SG2-69:AC1] [SG2-69:AC2] every authenticated role reads its own uncached inbox with the full unread count', async () => {
  const tokens: string[] = [];
  const api = app(token => { tokens.push(token); return store(); });
  for (const role of ROLES) {
    const response = await request(api).get('/api/notifications/inbox').set(auth(role));
    assert.deepEqual([response.status, response.body], [200, page]);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(tokens, ROLES);
  const denied = await request(api).get('/api/notifications/inbox');
  assert.equal(denied.status, 401); assert.equal(denied.headers['cache-control'], 'no-store');
});

test('[BOUNDARY] [SG2-69:AC2] complete pagination preserves source, safe bigint ID and microsecond timestamp ties', async () => {
  const cursors: unknown[] = [];
  const api = app(() => store({ inbox: async cursor => { cursors.push(cursor); return { notifications: [], unread_count: 0, next_cursor: null }; } }));
  await request(api).get('/api/notifications/inbox').set(auth());
  for (const source of ['event', 'hold']) {
    const response = await request(api).get('/api/notifications/inbox').query({ before_created_at: '2030-01-02T00:00:00.123456+08:00', before_source: source, before_id: Number.MAX_SAFE_INTEGER }).set(auth());
    assert.deepEqual([response.status, response.body], [200, { notifications: [], unread_count: 0, next_cursor: null }]);
  }
  assert.deepEqual(cursors, [undefined, ...['event', 'hold'].map(source => ({ created_at: '2030-01-02T00:00:00.123456+08:00', source, notification_id: Number.MAX_SAFE_INTEGER }))]);
});

test('[FAILURE] [SG2-69:AC2] malformed, partial or repeated cursors are rejected before touching the store', async () => {
  let calls = 0;
  const api = app(() => { calls++; return store(); });
  const valid = { before_created_at: '2030-01-02T00:00:00Z', before_source: 'event', before_id: '1' };
  const invalid = [{ before_source: 'event' }, { ...valid, unknown: 'x' }, { ...valid, before_source: 'other' },
    { ...valid, before_id: '0' }, { ...valid, before_id: '9007199254740992' }, { ...valid, before_id: '-1' },
    { ...valid, before_id: '1.2' }, { ...valid, before_id: ['1', '2'] }, { ...valid, before_created_at: ['2030-01-02T00:00:00Z', '2030-01-03T00:00:00Z'] },
    ...['0000-01-01T00:00:00Z', '2030-01-01T00:00:00+16:00', '2030-02-30T00:00:00Z', '2030-13-01T00:00:00Z', '2030-01-01', '2030-01-01T00:00:00', '2030-01-01T25:00:00Z', '2030-01-01T00:00:00+99:00', '2030-01-01T00:00:00.1234567Z']
      .map(before_created_at => ({ ...valid, before_created_at }))];
  for (const query of invalid) assert.equal((await request(api).get('/api/notifications/inbox').query(query).set(auth())).status, 400, JSON.stringify(query));
  assert.equal(calls, 0);
});

test('[NORMAL] [SG2-69:AC3] [SG2-69:AC4] opening an owned notice marks it read and the event target returns only the minimal summary', async () => {
  const calls: unknown[] = [];
  const api = app(token => store({ read: async (source, id) => { calls.push([token, source, id]); return { notification: notice, unread_count: 72 }; },
    event: async (source, id) => { calls.push([token, source, id]); return { event_id: 7, name: 'Leadership Forum', status: 'preparation', proposed_date: null }; } }));
  const read = await request(api).post('/api/notifications/hold/3/read').set(auth('safety_officer'));
  assert.deepEqual([read.status, read.body], [200, { notification: notice, unread_count: 72 }]);
  const event = await request(api).get('/api/notifications/event/3/event').set(auth());
  assert.deepEqual([event.status, event.body], [200, { event: { event_id: 7, name: 'Leadership Forum', status: 'preparation', proposed_date: null } }]);
  const all = await request(api).post('/api/notifications/read-all').set(auth('attendee'));
  assert.deepEqual([all.status, all.body], [200, { unread_count: 0 }]);
  assert.deepEqual(calls, [['safety_officer', 'hold', 3], ['event_coordinator', 'event', 3]]);
  for (const response of [read, event, all]) assert.equal(response.headers['cache-control'], 'no-store');
});

test('[CONFLICT] [SG2-69:AC3] a stale, unrelated or missing notice and unavailable current event relationship share a safe not-found response', async () => {
  const api = app(() => store({ read: async () => null, event: async () => null }));
  for (const [method, path] of [['post', '/event/3/read'], ['get', '/hold/3/event']] as const) {
    const response = await request(api)[method](`/api/notifications${path}`).set(auth());
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Notification or related event is no longer available.' });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('[FAILURE] [SG2-69:AC3] malformed source or notification ID never reaches the store', async () => {
  let calls = 0;
  const api = app(() => { calls++; return store(); });
  for (const [source, id] of [['unknown', '1'], ['event', '0'], ['hold', '1.5'], ['event', '9007199254740992'], ['event', '-1'], ['hold', '01']]) {
    for (const [method, action] of [['post', 'read'], ['get', 'event']] as const) {
      assert.equal((await request(api)[method](`/api/notifications/${source}/${id}/${action}`).set(auth())).status, 400);
    }
  }
  assert.equal(calls, 0);
});

test('[BOUNDARY] [SG2-69:AC6] a coordinator reads the daily default and saves exactly 1 through 30 whole days', async () => {
  const api = app(() => store());
  assert.deepEqual((await request(api).get('/api/notifications/reminder-preferences').set(auth())).body, { frequency_days: 1 });
  for (const days of [1, 15, 30]) {
    const response = await request(api).put('/api/notifications/reminder-preferences').set(auth()).send({ frequency_days: days });
    assert.deepEqual([response.status, response.body], [200, { frequency_days: days }]);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});

test('[FAILURE] [SG2-69:AC6] [SG2-69:AC7] unrelated roles cannot alter cadence and invalid preferences never reach storage', async () => {
  let calls = 0;
  const api = app(() => { calls++; return store(); });
  for (const role of ROLES.filter(role => role !== 'event_coordinator')) {
    assert.equal((await request(api).get('/api/notifications/reminder-preferences').set(auth(role))).status, 403);
    assert.equal((await request(api).put('/api/notifications/reminder-preferences').set(auth(role)).send({ frequency_days: 2 })).status, 403);
  }
  for (const body of [null, false, [], {}, { frequency_days: 0 }, { frequency_days: 31 }, { frequency_days: 1.5 },
    { frequency_days: '2' }, { frequency_days: null }, { frequency_days: 2, recipient_id: 'someone-else' }]) {
    assert.equal((await request(api).put('/api/notifications/reminder-preferences').set(auth()).set('Content-Type', 'application/json').send(JSON.stringify(body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await request(api).put('/api/notifications/reminder-preferences').set(auth())).status, 400);
  assert.equal(calls, 0);
});

test('[FAILURE] [SG2-69:AC1] [SG2-69:AC4] upstream exceptions and missing configuration return generic uncached errors', async () => {
  for (const [error, status] of [[new AccessError(403), 403], [new Error('private database credentials'), 503]] as const) {
    const api = app(() => store({ readAll: async () => { throw error; } }));
    const response = await request(api).post('/api/notifications/read-all').set(auth());
    assert.deepEqual([response.status, response.body], [status, { error: new AccessError(status).message }]);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.equal((await request(app()).get('/api/notifications/inbox').set(auth())).status, 503);
});

test('[CONFLICT] [SG2-69:AC6] [SG2-104:AC2] held coordinator permissions apply only while acting as coordinator and disappear on revocation', async () => {
  let held: readonly Role[] = ['event_coordinator', 'attendee'];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'multi-role-person', roles: held }) });
  const calls: unknown[] = [];
  const api = request(express().use(express.json()).use('/api/notifications', createNotificationsRouter(access, async () => [], token => {
    calls.push([token, currentActingRole()]);
    return store();
  })));
  const headers = { Authorization: 'Bearer verified-token' };
  assert.equal((await api.get('/api/notifications/inbox').set(headers)).status, 200);
  assert.deepEqual(calls, [['verified-token', 'attendee']]);
  assert.equal((await api.get('/api/notifications/reminder-preferences').set(headers)).status, 403);
  assert.equal((await api.put('/api/notifications/reminder-preferences').set(headers).set('X-Acting-Role', 'attendee').send({ frequency_days: 3 })).status, 403);
  assert.equal((await api.put('/api/notifications/reminder-preferences').set(headers).set('X-Acting-Role', 'venue_staff').send({ frequency_days: 3 })).status, 403);
  assert.equal(calls.length, 1, 'Other acting roles cannot reach the coordinator preference store.');
  const saved = await api.put('/api/notifications/reminder-preferences').set(headers).set('X-Acting-Role', 'event_coordinator').send({ frequency_days: 3 });
  assert.deepEqual([saved.status, saved.body], [200, { frequency_days: 3 }]);
  assert.deepEqual(calls[1], ['verified-token', 'event_coordinator']);
  held = ['attendee'];
  assert.equal((await api.get('/api/notifications/reminder-preferences').set(headers).set('X-Acting-Role', 'event_coordinator')).status, 403);
  assert.equal(calls.length, 2, 'Role revocation is checked again before accessing storage.');
});
