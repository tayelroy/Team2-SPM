import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createRegistrableEventsRouter } from './registrableEvents';
import type { RegistrableEvent, RegistrableEventsStore } from './db/registrableEvents';

const open: RegistrableEvent = {
  event_id: 41, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'Talks and a panel.', proposed_date: '2030-07-20T02:00:00+00:00',
  registration_opens_at: '2026-10-01T00:00:00+00:00', registration_closes_at: '2030-07-19T02:00:00+00:00',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: false, full: false, waiting: null
};
const upcoming: RegistrableEvent = {
  ...open, event_id: 42, name: 'Bayfront Talk', registration_opens_at: '2030-06-01T00:00:00+00:00', venues: []
};
const auth = { Authorization: 'Bearer attendee-token' };

function fixture(role: Role = 'attendee', overrides: Partial<RegistrableEventsStore> = {}) {
  const asked: number[] = [];
  let lists = 0;
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'attendee-1', role }) });
  const store = (token: string): RegistrableEventsStore => {
    assert.equal(token, 'attendee-token');
    return {
      list: overrides.list ?? (async () => { lists++; return [upcoming, open]; }),
      get: overrides.get ?? (async (eventId) => { asked.push(eventId); return eventId === 41 ? open : null; }),
      register: async () => assert.fail('SG2-59 reads never register'),
      joinWaitingList: async () => assert.fail('SG2-59 reads never join a waiting list'),
      leaveWaitingList: async () => assert.fail('SG2-59 reads never leave a waiting list')
    };
  };
  const router = createRegistrableEventsRouter(access, store);
  return { app: express().use('/api/registrable-events', router), router, access, asked, lists: () => lists };
}

test('[NORMAL] [SG2-59:AC1] an attendee lists the events open or opening for registration with name, date, time and venue', async () => {
  const { app, lists } = fixture();
  const response = await request(app).get('/api/registrable-events').set(auth);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, { events: [upcoming, open] });
  assert.equal(lists(), 1);
});

test('[NORMAL] [SG2-59:AC3] opening a listed event returns its attendee-facing details', async () => {
  const { app, asked } = fixture();
  const response = await request(app).get('/api/registrable-events/41').set(auth);
  assert.deepEqual([response.status, response.body], [200, { event: open }]);
  assert.deepEqual(asked, [41]);
});

test('[BOUNDARY] [SG2-59:AC2] an empty list is a 200 with no events, not an error', async () => {
  const { app } = fixture('attendee', { list: async () => [] });
  const response = await request(app).get('/api/registrable-events').set(auth);
  assert.deepEqual([response.status, response.body], [200, { events: [] }]);
});

test('[FAILURE] [SG2-59:AC2] an event that is not listed does not open, whether it exists or not', async () => {
  const { app, asked } = fixture();
  const response = await request(app).get('/api/registrable-events/43').set(auth);
  assert.deepEqual([response.status, response.body], [404, { error: 'This event is not open for registration.' }]);
  assert.deepEqual(asked, [43]);
});

test('[BOUNDARY] [SG2-59:AC3] the event id must be a positive 32-bit integer before the database is asked', async () => {
  const { app, asked } = fixture();
  for (const raw of ['0', '-1', '1.5', 'abc', '01', '2147483648']) {
    const response = await request(app).get(`/api/registrable-events/${raw}`).set(auth);
    assert.deepEqual([response.status, response.body], [400, { error: 'eventId must be a positive integer.' }], raw);
  }
  assert.equal((await request(app).get('/api/registrable-events/2147483647').set(auth)).status, 404);
  assert.deepEqual(asked, [2147483647]);
});

test('[NORMAL] [SG2-59:AC1] production mounts the attendee list and leaves public health accessible', async () => {
  const { router, access } = fixture();
  const args = Array.from({ length: 41 }, () => undefined) as unknown as Parameters<typeof createApp>;
  args[1] = access; args[40] = router;
  const app = createApp(...args);
  assert.equal((await request(app).get('/api/health')).status, 200);
  const response = await request(app).get('/api/registrable-events').set(auth);
  assert.deepEqual([response.status, response.body], [200, { events: [upcoming, open] }]);
});

// Independent literal list (docs/testing.md), not the production grant.
const REFUSED_ROLES: Role[] = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'event_coordinator_lead', 'safety_officer'
];

for (const role of REFUSED_ROLES) {
  test(`[FAILURE] [SG2-59:AC1] ${role} cannot browse attendee events, even with a forged role header`, async () => {
    const { app, asked, lists } = fixture(role);
    for (const path of ['/api/registrable-events', '/api/registrable-events/41']) {
      const response = await request(app).get(path).set(auth).set('X-Role', 'attendee');
      assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
    }
    assert.deepEqual([asked.length, lists()], [0, 0]);
  });
}

test('[FAILURE] [SG2-59:AC1] unsigned or expired credentials cannot browse', async () => {
  const { app, lists } = fixture();
  assert.equal((await request(app).get('/api/registrable-events')).status, 401);
  const access = createAuthorization({ resolvePrincipal: async () => { throw new AccessError(401); } });
  const expired = express().use('/api/registrable-events',
    createRegistrableEventsRouter(access, () => assert.fail('Expired credentials must not reach storage')));
  assert.equal((await request(expired).get('/api/registrable-events').set(auth)).status, 401);
  assert.equal(lists(), 0);
});

// The database's acting-role check itself is proven by registrable_events.sql
// (non-attendee-refused, acting-attendee-allowed); this covers the route's
// handling of that refusal.
test('[CONFLICT] [SG2-59:AC1] when the store refuses an account whose role changed after sign-in, the route answers 403', async () => {
  const refused = async () => { throw new AccessError(403); };
  const { app } = fixture('attendee', { list: refused, get: refused });
  for (const path of ['/api/registrable-events', '/api/registrable-events/41']) {
    const response = await request(app).get(path).set(auth);
    assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
  }
});

test('[FAILURE] [SG2-59:AC1] an unavailable database or unexpected failure answers 503 without detail', async () => {
  for (const failure of [new AccessError(503), new Error('connection string leaked')]) {
    const failing = async () => { throw failure; };
    const { app } = fixture('attendee', { list: failing, get: failing });
    for (const path of ['/api/registrable-events', '/api/registrable-events/41']) {
      const response = await request(app).get(path).set(auth);
      assert.deepEqual([response.status, response.body], [503, { error: 'Events are temporarily unavailable. Please try again.' }]);
    }
  }
});
