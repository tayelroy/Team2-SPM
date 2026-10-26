import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createMyRegistrationsRouter } from './myRegistrations';
import type { MyRegistration, MyRegistrationsStore, WithdrawResult } from './db/myRegistrations';

const auth = { Authorization: 'Bearer attendee-token' };
const path = '/api/my-registrations/7/withdrawal';
const mine: MyRegistration = {
  registration_id: 7, event_id: 41, standing: 'registered', can_withdraw: true,
  registered_at: '2030-06-02T01:00:00+00:00', withdrawn_at: null, contact_phone: '91234567', needs: 'Wheelchair access',
  event: {
    name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar', description: 'Talks and a panel.',
    proposed_date: '2030-07-20T11:00:00+00:00', registration_closes_at: '2030-07-19T02:00:00+00:00',
    venues: [{ name: 'Regression Hall', location: 'Level 1' }]
  }
};
const withdrawn: WithdrawResult = { outcome: 'ok', withdrawal: { registration_id: 7, event_id: 41, withdrawn_at: '2030-06-03T01:00:00+00:00' } };

function fixture(role: Role = 'attendee', result: WithdrawResult | (() => Promise<WithdrawResult>) = withdrawn,
  list: () => Promise<MyRegistration[]> = async () => [mine]) {
  const asked: number[] = [];
  let listed = 0;
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'attendee-1', role }) });
  const store = (token: string): MyRegistrationsStore => {
    assert.equal(token, 'attendee-token');
    return {
      list: async () => { listed += 1; return list(); },
      withdraw: async registrationId => {
        asked.push(registrationId);
        return typeof result === 'function' ? result() : result;
      }
    };
  };
  const router = createMyRegistrationsRouter(access, store);
  return { app: express().use(express.json()).use('/api/my-registrations', router), router, access, asked, listed: () => listed };
}

test('[NORMAL] [SG2-62:AC1] an attendee sees their registrations with the event details and where each stands', async () => {
  const { app } = fixture();
  const response = await request(app).get('/api/my-registrations').set(auth);
  assert.deepEqual([response.status, response.body], [200, { registrations: [mine] }]);
});

test('[BOUNDARY] [SG2-62:AC1] an attendee with no registrations gets an empty list', async () => {
  const { app } = fixture('attendee', withdrawn, async () => []);
  const response = await request(app).get('/api/my-registrations').set(auth);
  assert.deepEqual([response.status, response.body], [200, { registrations: [] }]);
});

test('[NORMAL] [SG2-62:AC2] [SG2-62:AC3] an attendee withdraws their registration and is given the withdrawal', async () => {
  const { app, asked } = fixture();
  const response = await request(app).post(path).set(auth);
  assert.deepEqual([response.status, response.body], [200, { withdrawal: { registration_id: 7, event_id: 41, withdrawn_at: '2030-06-03T01:00:00+00:00' } }]);
  assert.deepEqual(asked, [7]);
});

test('[FAILURE] [SG2-62:AC4] at or after the start the withdrawal is refused and the attendee is told the event has started', async () => {
  const { app } = fixture('attendee', { outcome: 'started', proposed_date: '2030-07-20T11:00:00+00:00' });
  const response = await request(app).post(path).set(auth);
  assert.deepEqual([response.status, response.body], [409, {
    error: 'This event started 20 Jul 2030 19:00 SGT, so you can no longer withdraw.', reason: 'started', proposed_date: '2030-07-20T11:00:00+00:00'
  }]);
});

test('[BOUNDARY] [SG2-62:AC4] a completed event with no start time recorded is still refused as started', async () => {
  const { app } = fixture('attendee', { outcome: 'started', proposed_date: null });
  const response = await request(app).post(path).set(auth);
  assert.deepEqual([response.status, response.body], [409, {
    error: 'This event has started, so you can no longer withdraw.', reason: 'started', proposed_date: null
  }]);
});

test('[CONFLICT] [SG2-62:AC2] a registration already withdrawn cannot be withdrawn again', async () => {
  const { app } = fixture('attendee', { outcome: 'withdrawn' });
  const response = await request(app).post(path).set(auth);
  assert.deepEqual([response.status, response.body], [409, { error: 'You have already withdrawn from this event.', reason: 'withdrawn' }]);
});

test('[FAILURE] [SG2-62:AC2] a cancelled event has nothing to withdraw from', async () => {
  const { app } = fixture('attendee', { outcome: 'cancelled' });
  const response = await request(app).post(path).set(auth);
  assert.deepEqual([response.status, response.body], [409, { error: 'This event has been cancelled.', reason: 'cancelled' }]);
});

test('[FAILURE] [SG2-62:AC2] another attendee\'s registration, or none, is not found', async () => {
  const { app } = fixture('attendee', { outcome: 'missing' });
  const response = await request(app).post(path).set(auth);
  assert.deepEqual([response.status, response.body], [404, { error: 'This registration was not found.' }]);
});

test('[BOUNDARY] [SG2-62:AC2] the registration id must be a positive 32-bit integer before the database is asked', async () => {
  const { app, asked } = fixture();
  for (const raw of ['0', '-1', '1.5', 'abc', '01', '2147483648']) {
    const response = await request(app).post(`/api/my-registrations/${raw}/withdrawal`).set(auth);
    assert.deepEqual([response.status, response.body], [400, { error: 'registrationId must be a positive integer.' }], raw);
  }
  assert.equal((await request(app).post('/api/my-registrations/2147483647/withdrawal').set(auth)).status, 200);
  assert.deepEqual(asked, [2147483647]);
});

// Independent literal list (docs/testing.md), not the production grant.
const REFUSED_ROLES: Role[] = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'event_coordinator_lead', 'safety_officer'
];

for (const role of REFUSED_ROLES) {
  test(`[FAILURE] [SG2-62:AC1] [SG2-62:AC2] ${role} cannot list or withdraw registrations, even with a forged role header`, async () => {
    const { app, asked, listed } = fixture(role);
    for (const call of [() => request(app).get('/api/my-registrations'), () => request(app).post(path)]) {
      const response = await call().set(auth).set('X-Role', 'attendee');
      assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
    }
    assert.deepEqual([asked, listed()], [[], 0]);
  });
}

test('[FAILURE] [SG2-62:AC1] [SG2-62:AC2] unsigned credentials cannot list or withdraw', async () => {
  const { app, asked, listed } = fixture();
  assert.equal((await request(app).get('/api/my-registrations')).status, 401);
  assert.equal((await request(app).post(path)).status, 401);
  assert.deepEqual([asked, listed()], [[], 0]);
});

// The database's acting-role check is proven by registration_withdrawal.sql
// (other-roles-refused); this covers the route's handling of that refusal.
test('[CONFLICT] [SG2-62:AC2] when the database refuses an account whose role changed after sign-in, the route answers 403', async () => {
  const { app } = fixture('attendee', async () => { throw new AccessError(403); }, async () => { throw new AccessError(403); });
  for (const call of [() => request(app).get('/api/my-registrations'), () => request(app).post(path)]) {
    const response = await call().set(auth);
    assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
  }
});

test('[FAILURE] [SG2-62:AC1] [SG2-62:AC2] an unavailable database or unexpected failure answers 503 without detail', async () => {
  for (const failure of [new AccessError(503), new Error('connection string leaked')]) {
    const { app } = fixture('attendee', async () => { throw failure; }, async () => { throw failure; });
    for (const call of [() => request(app).get('/api/my-registrations'), () => request(app).post(path)]) {
      const response = await call().set(auth);
      assert.deepEqual([response.status, response.body], [503, { error: 'Your registrations are temporarily unavailable. Please try again.' }]);
    }
  }
});

test('[NORMAL] [SG2-62:AC1] [SG2-62:AC2] production mounts the list and the withdrawal', async () => {
  const { router, access, asked } = fixture();
  const args = Array.from({ length: 45 }, () => undefined) as unknown as Parameters<typeof createApp>;
  args[1] = access; args[44] = router;
  const app = createApp(...args);
  assert.deepEqual((await request(app).get('/api/my-registrations').set(auth)).body, { registrations: [mine] });
  assert.equal((await request(app).post(path).set(auth)).status, 200);
  assert.deepEqual(asked, [7]);
});
