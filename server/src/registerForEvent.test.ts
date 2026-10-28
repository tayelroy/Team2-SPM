import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createRegistrableEventsRouter } from './registrableEvents';
import { readRegistration } from './registrableEvents/registration';
import type { RegisterResult, RegistrableEventsStore, RegistrationInput } from './db/registrableEvents';

const auth = { Authorization: 'Bearer attendee-token' };
const path = '/api/registrable-events/41/registrations';
const held: RegisterResult = {
  outcome: 'ok',
  registration: { registration_id: 7, event_id: 41, registered_at: '2030-06-02T01:00:00+00:00', contact_phone: '+65 9123 4567', needs: 'Wheelchair access' }
};

function fixture(role: Role = 'attendee', result: RegisterResult | (() => Promise<RegisterResult>) = held) {
  const asked: [number, RegistrationInput][] = [];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'attendee-1', role }) });
  const store = (token: string): RegistrableEventsStore => {
    assert.equal(token, 'attendee-token');
    return {
      list: async () => assert.fail('Registering never lists'),
      get: async () => assert.fail('Registering never reads the detail'),
      register: async (eventId, input) => {
        asked.push([eventId, input]);
        return typeof result === 'function' ? result() : result;
      },
      joinWaitingList: async () => assert.fail('Registering never joins a waiting list'),
      leaveWaitingList: async () => assert.fail('Registering never leaves a waiting list')
    };
  };
  const router = createRegistrableEventsRouter(access, store);
  return { app: express().use(express.json()).use('/api/registrable-events', router), router, access, asked };
}

test('[NORMAL] [SG2-60:AC1] [SG2-60:AC4] an attendee registers with a phone and needs, and is given the place they hold', async () => {
  const { app, asked } = fixture();
  const response = await request(app).post(path).set(auth).send({ contact_phone: '  +65 9123 4567 ', needs: ' Wheelchair access ' });
  assert.deepEqual([response.status, response.body], [201, { registration: held.registration }]);
  assert.deepEqual(asked, [[41, { contact_phone: '+65 9123 4567', needs: 'Wheelchair access' }]]);
});

test('[CONFLICT] [SG2-60:AC2] a second registration for the same event is refused', async () => {
  const { app } = fixture('attendee', { outcome: 'duplicate' });
  const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body],
    [409, { error: 'You are already registered for this event.', reason: 'duplicate' }]);
});

test('[FAILURE] [SG2-60:AC3] before registration opens the attendee is told when it opens', async () => {
  const { app } = fixture('attendee', { outcome: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00' });
  const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body], [409, {
    error: 'Registration opens 01 Jun 2030 08:00 SGT.', reason: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00'
  }]);
});

test('[FAILURE] [SG2-60:AC3] after registration closes the attendee is told it has closed', async () => {
  const { app } = fixture('attendee', { outcome: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00' });
  const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body], [409, {
    error: 'Registration for this event has closed.', reason: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00'
  }]);
});

test('[FAILURE] [SG2-60:AC1] with no places remaining registration is refused as full', async () => {
  const { app } = fixture('attendee', { outcome: 'full' });
  const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body], [409, { error: 'This event is full.', reason: 'full' }]);
});

test('[FAILURE] [SG2-60:AC3] an event an attendee may not find cannot be registered for', async () => {
  const { app } = fixture('attendee', { outcome: 'missing' });
  const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body], [404, { error: 'This event is not open for registration.' }]);
});

test('[FAILURE] [SG2-60:AC4] missing or invalid registration details are refused before the database is asked', async () => {
  const { app, asked } = fixture();
  const cases: [unknown, string[]][] = [
    [{}, ['contact_phone is required.']],
    [{ contact_phone: null }, ['contact_phone is required.']],
    [{ contact_phone: '   ' }, ['contact_phone is required.']],
    [{ contact_phone: 91234567 }, ['contact_phone must be text.']],
    [{ contact_phone: '9123456' }, ['contact_phone must be a Singapore number with 8 digits, optionally prefixed with +65.']],
    [{ contact_phone: '912345678' }, ['contact_phone must be a Singapore number with 8 digits, optionally prefixed with +65.']],
    [{ contact_phone: '+66 91234567' }, ['contact_phone must be a Singapore number with 8 digits, optionally prefixed with +65.']],
    [{ contact_phone: '9123 456a' }, ['contact_phone must be a Singapore number with 8 digits, optionally prefixed with +65.']],
    [{ contact_phone: `9${' '.repeat(33)}1234567` }, ['contact_phone must be a Singapore number with 8 digits, optionally prefixed with +65.']],
    [{ contact_phone: '91234567', needs: 5 }, ['needs must be text.']],
    [{ contact_phone: '91234567', needs: 'n'.repeat(501) }, ['needs must be 500 characters or fewer.']],
    [{ contact_phone: '91234567', name: 'Someone else' }, ['name is not a registration field.']],
    [[], ['Send the registration details as an object.']]
  ];
  for (const [body, errors] of cases) {
    const response = await request(app).post(path).set(auth).set('Content-Type', 'application/json').send(JSON.stringify(body));
    assert.deepEqual([response.status, response.body], [400, { error: 'Check your registration details.', errors }], JSON.stringify(body));
  }
  // No body at all is parsed as {}: the phone is still required.
  const empty = await request(app).post(path).set(auth);
  assert.deepEqual([empty.status, empty.body], [400, { error: 'Check your registration details.', errors: ['contact_phone is required.'] }]);
  assert.deepEqual(asked, []);
  // express.json() refuses a bare value before the route; the reader refuses it too.
  for (const body of [null, '91234567', undefined]) {
    assert.deepEqual(readRegistration(body), { valid: false, errors: ['Send the registration details as an object.'] });
  }
});

test('[BOUNDARY] [SG2-60:AC4] 500 characters of needs, a 40-character phone with separators, and blank or absent needs are accepted', async () => {
  const { app, asked } = fixture();
  for (const body of [
    { contact_phone: '(9123)-4567', needs: ` ${'n'.repeat(500)} ` },
    { contact_phone: `9${' '.repeat(32)}1234567`, needs: '   ' },
    { contact_phone: '+6591234567', needs: null },
    { contact_phone: '91234567' }
  ]) {
    assert.equal((await request(app).post(path).set(auth).send(body)).status, 201, JSON.stringify(body));
  }
  assert.deepEqual(asked.map(([, input]) => input), [
    { contact_phone: '(9123)-4567', needs: 'n'.repeat(500) },
    { contact_phone: `9${' '.repeat(32)}1234567`, needs: null },
    { contact_phone: '+6591234567', needs: null },
    { contact_phone: '91234567', needs: null }
  ]);
});

test('[FAILURE] [SG2-60:AC4] when the database refuses the details the attendee is asked to check them', async () => {
  const { app } = fixture('attendee', { outcome: 'invalid' });
  const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body], [400, { error: 'Check your registration details.' }]);
});

test('[BOUNDARY] [SG2-60:AC1] the event id must be a positive 32-bit integer before anything else is checked', async () => {
  const { app, asked } = fixture();
  for (const raw of ['0', '-1', '1.5', 'abc', '01', '2147483648']) {
    const response = await request(app).post(`/api/registrable-events/${raw}/registrations`).set(auth).send({});
    assert.deepEqual([response.status, response.body], [400, { error: 'eventId must be a positive integer.' }], raw);
  }
  assert.equal((await request(app).post('/api/registrable-events/2147483647/registrations').set(auth)
    .send({ contact_phone: '91234567' })).status, 201);
  assert.deepEqual(asked.map(([eventId]) => eventId), [2147483647]);
});

// Independent literal list (docs/testing.md), not the production grant.
const REFUSED_ROLES: Role[] = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'event_coordinator_lead', 'safety_officer'
];

for (const role of REFUSED_ROLES) {
  test(`[FAILURE] [SG2-60:AC1] ${role} cannot register for an event, even with a forged role header`, async () => {
    const { app, asked } = fixture(role);
    const response = await request(app).post(path).set(auth).set('X-Role', 'attendee').send({ contact_phone: '91234567' });
    assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
    assert.deepEqual(asked, []);
  });
}

test('[FAILURE] [SG2-60:AC1] unsigned credentials cannot register', async () => {
  const { app, asked } = fixture();
  assert.equal((await request(app).post(path).send({ contact_phone: '91234567' })).status, 401);
  assert.deepEqual(asked, []);
});

// The database's acting-role check is proven by event_registration.sql
// (non-attendee-refused); this covers the route's handling of that refusal.
test('[CONFLICT] [SG2-60:AC1] when the database refuses an account whose role changed after sign-in, the route answers 403', async () => {
  const { app } = fixture('attendee', async () => { throw new AccessError(403); });
  const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
});

test('[FAILURE] [SG2-60:AC1] an unavailable database or unexpected failure answers 503 without detail', async () => {
  for (const failure of [new AccessError(503), new Error('connection string leaked')]) {
    const { app } = fixture('attendee', async () => { throw failure; });
    const response = await request(app).post(path).set(auth).send({ contact_phone: '91234567' });
    assert.deepEqual([response.status, response.body], [503, { error: 'Events are temporarily unavailable. Please try again.' }]);
  }
});

test('[NORMAL] [SG2-60:AC1] production parses the registration body and mounts the route', async () => {
  const { router, access, asked } = fixture();
  const args = Array.from({ length: 41 }, () => undefined) as unknown as Parameters<typeof createApp>;
  args[1] = access; args[40] = router;
  const response = await request(createApp(...args)).post(path).set(auth).send({ contact_phone: '91234567' });
  assert.deepEqual([response.status, response.body], [201, { registration: held.registration }]);
  assert.deepEqual(asked, [[41, { contact_phone: '91234567', needs: null }]]);
});
