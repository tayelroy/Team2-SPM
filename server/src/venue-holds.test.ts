import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAuthorization, type Role, AccessError } from './auth';
import { createVenueHoldsRouter } from './venues/holds';
import { validateVenueHold, parseHoldId } from './venues/holdFields';
import type { VenueHoldStore, HoldMutationResult } from './db/venueHolds';

const NOW = Date.parse('2030-01-01T00:00:00Z');
const values = { event_id: 2, venue_id: 3, starts_at: '2030-01-03T09:00:00.000Z',
  ends_at: '2030-01-03T11:00:00.000Z', expires_at: '2030-01-02T00:00:00.000Z' };
const hold = { hold_id: 7, ...values, status: 'tentative' as const, event_name: 'Event', venue_name: 'Hall',
  request_id: 8, booking_id: null, created_at: '2030-01-01T00:00:00.000Z' };
const notification = { notification_id: 4, event_id: 2, hold_id: 7, kind: 'placed' as const,
  message: 'Tentative hold placed; expires 2030-01-02T00:00:00Z.', created_at: hold.created_at };
const auth = { Authorization: 'Bearer caller-token' };
function database(overrides: Partial<VenueHoldStore> = {}): VenueHoldStore {
  return { list: async () => [hold], options: async () => ({ events: [{ event_id: 2, name: 'Event' }], venues: [{ venue_id: 3, name: 'Hall' }] }),
    notifications: async () => [notification], create: async () => ({ outcome: 'created', hold }),
    change: async () => ({ outcome: 'updated', hold: { ...hold, status: 'released' } }), ...overrides };
}
function app(role: Role = 'venue_staff', store = (_token: string) => database()) {
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user', role }) });
  const server = express(); server.use(express.json()); server.use('/api/venue-holds', createVenueHoldsRouter(access, store, () => NOW));
  return server;
}
test('[NORMAL] [SG2-84:AC1] validation normalizes zoned instants and preserves only explicit fields', () => {
  assert.deepEqual(validateVenueHold(values, NOW), values);
  assert.deepEqual(validateVenueHold({ ...values, starts_at: '2030-01-03T17:00:00+08:00' }, NOW), values);
});
test('[BOUNDARY] [SG2-84:AC1] [SG2-84:AC2] ids and deadline boundaries are enforced', () => {
  assert.ok(validateVenueHold({ ...values, event_id: 2147483647, venue_id: 1, expires_at: '2030-01-01T00:00:00.001Z' }, NOW));
  for (const field of ['event_id', 'venue_id'] as const) for (const value of [0, -1, 1.2, 2147483648, '1', null])
    assert.equal(validateVenueHold({ ...values, [field]: value }, NOW), null);
  assert.equal(validateVenueHold({ ...values, expires_at: '2030-01-01T00:00:00.000Z' }, NOW), null);
  assert.equal(validateVenueHold({ ...values, expires_at: '2029-12-31T23:59:59.999Z' }, NOW), null);
  assert.equal(validateVenueHold({ ...values, ends_at: values.starts_at }, NOW), null);
  assert.equal(validateVenueHold({ ...values, ends_at: '2029-12-31T00:00:00Z' }, NOW), null);
  assert.equal(parseHoldId('9007199254740991'), Number.MAX_SAFE_INTEGER);
  for (const raw of ['0', '-1', '1.5', '01', '9007199254740992', 'x']) assert.equal(parseHoldId(raw), null);
});
test('[FAILURE] [SG2-84:AC2] expiry is mandatory and malformed or date-only input never reaches storage', () => {
  for (const body of [null, [], 4, {}, { ...values, status: 'confirmed' }]) assert.equal(validateVenueHold(body, NOW), null);
  for (const field of ['starts_at', 'ends_at', 'expires_at'] as const) for (const raw of [undefined, null, 4, '', 'nope', '2030-01-02', '2030-02-30T00:00:00Z', '2030-13-01T00:00:00Z'])
    assert.equal(validateVenueHold({ ...values, [field]: raw }, NOW), null);
});
test('[NORMAL] [SG2-84:AC1] [SG2-84:AC6] staff can list options and create a tentative hold using their own bearer', async () => {
  let token = ''; let sent: unknown;
  const server = app('venue_staff', value => { token = value; return database({ create: async body => { sent = body; return { outcome: 'created', hold }; } }); });
  assert.deepEqual((await request(server).get('/api/venue-holds').set(auth)).body, { holds: [hold] });
  assert.equal((await request(server).get('/api/venue-holds/options').set(auth)).body.events[0].event_id, 2);
  const response = await request(server).post('/api/venue-holds').set(auth).send(values);
  assert.equal(response.status, 201); assert.deepEqual(response.body, { hold }); assert.equal(token, 'caller-token'); assert.deepEqual(sent, values);
  assert.equal(response.headers['cache-control'], 'no-store');
});
test('[NORMAL] [SG2-84:AC5] release and normal approval conversion use distinct atomic mutations', async () => {
  const calls: unknown[] = [];
  const server = app('venue_staff', () => database({ change: async (id, action) => { calls.push([id, action]); return { outcome: 'updated', hold }; } }));
  for (const action of ['release', 'convert']) {
    const response = await request(server).post(`/api/venue-holds/7/${action}`).set(auth);
    assert.equal(response.status, 200); assert.deepEqual(response.body, { hold });
  }
  assert.deepEqual(calls, [[7, 'release'], [7, 'convert']]);
});
test('[NORMAL] [SG2-84:AC6] [SG2-85:AC4] recipients can read their hold notifications', async () => {
  assert.deepEqual((await request(app('event_coordinator')).get('/api/venue-holds/notifications').set(auth)).body, { notifications: [notification] });
});
for (const role of ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'] as Role[]) {
  test(`[FAILURE] [SG2-84:AC1] role access to holds is enforced (${role})`, async () => {
    const server = app(role);
    assert.equal((await request(server).get('/api/venue-holds').set(auth)).status, ['event_coordinator', 'venue_staff', 'technical_support_staff'].includes(role) ? 200 : 403);
    for (const url of ['/api/venue-holds', '/api/venue-holds/7/release', '/api/venue-holds/7/convert'])
      assert.equal((await request(server).post(url).set(auth).send(values)).status, role === 'venue_staff' ? (url === '/api/venue-holds' ? 201 : 200) : 403);
    assert.equal((await request(server).get('/api/venue-holds/options').set(auth)).status, role === 'venue_staff' ? 200 : 403);
  });
}
test('[FAILURE] [SG2-84:AC1] authentication and malformed payloads fail before touching the database', async () => {
  let touched = false; const server = app('venue_staff', () => { touched = true; return database(); });
  assert.equal((await request(server).get('/api/venue-holds')).status, 401);
  assert.equal((await request(server).post('/api/venue-holds').set(auth).send({ ...values, expires_at: null })).status, 400);
  for (const action of ['release', 'convert']) assert.equal((await request(server).post(`/api/venue-holds/nope/${action}`).set(auth)).status, 400);
  assert.equal(touched, false);
});
for (const [outcome, status] of [['missing', 404], ['invalid', 400], ['conflict', 409], ['inactive', 409], ['capacity', 409], ['suitability', 409]] as const) {
  test(`[CONFLICT] [SG2-84:AC3] [SG2-84:AC5] [SG2-85:AC3] ${outcome} has a stable public response`, async () => {
    const result = { outcome } as HoldMutationResult;
    const server = app('venue_staff', () => database({ create: async () => result, change: async () => result }));
    for (const url of ['/api/venue-holds', '/api/venue-holds/7/convert']) {
      const response = await request(server).post(url).set(auth).send(values);
      assert.equal(response.status, status); assert.equal(typeof response.body.error, 'string');
    }
  });
}
test('[FAILURE] [SG2-84:AC1] access errors retain status while database details are withheld', async () => {
  for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET')]) {
    const response = await request(app('venue_staff', () => { throw error; })).get('/api/venue-holds').set(auth);
    assert.equal(response.status, error instanceof AccessError ? error.status : 503); assert.equal(JSON.stringify(response.body).includes('SECRET'), false);
  }
});
