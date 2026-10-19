import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createVenuesRouter } from './venues';
import { createVenueHoldsRouter } from './venues/holds';
import { validateHoldExpiry } from './venues/holdFields';
import type { VenueDeleteResult, VenueStore } from './db/venues';
import type { HoldMutationResult, VenueHoldStore } from './db/venueHolds';

const ROLES = ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'] as const;
const auth = { Authorization: 'Bearer valid-token' };
const NOW = Date.parse('2030-01-01T00:00:00Z');
const deleted = { venue_id: 4, name: 'Atrium', deleted_at: '2030-01-01T00:00:00.000Z', deleted_by: 'staff-1' };
const blockers = [{ kind: 'hold' as const, id: 9, event_id: 2, event_name: 'Gala', starts_at: '2030-02-01T09:00:00.000Z', ends_at: '2030-02-01T11:00:00.000Z' }];
const hold = { hold_id: 7, event_id: 2, venue_id: 3, starts_at: '2030-01-03T09:00:00.000Z', ends_at: '2030-01-03T11:00:00.000Z',
  expires_at: '2030-01-05T00:00:00.000Z', status: 'tentative' as const, event_name: 'Event', venue_name: 'Hall',
  request_id: 8, booking_id: null, created_at: '2030-01-01T00:00:00.000Z' };

function venues(role: Role, remove: (id: number) => Promise<VenueDeleteResult>) {
  const calls: number[] = [];
  const store: VenueStore = { list: async () => [], save: async () => null, remove: async id => { calls.push(id); return remove(id); } };
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'staff-1', role }) });
  const app = express(); app.use(express.json());
  app.use('/api/venues', createVenuesRouter(access, token => { assert.equal(token, 'valid-token'); return store; }));
  return { app, calls };
}
function holds(role: Role, changeExpiry: VenueHoldStore['changeExpiry']) {
  const calls: [number, string][] = [];
  const store: VenueHoldStore = { list: async () => [], options: async () => ({ events: [], venues: [] }), notifications: async () => [],
    create: async () => ({ outcome: 'missing' }), change: async () => ({ outcome: 'missing' }),
    changeExpiry: async (id, expiresAt) => { calls.push([id, expiresAt]); return changeExpiry(id, expiresAt); } };
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'staff-1', role }) });
  const app = express(); app.use(express.json());
  app.use('/api/venue-holds', createVenueHoldsRouter(access, () => store, () => NOW));
  return { app, calls };
}

test('[NORMAL] [SG2-106:AC1] [SG2-106:AC5] Venue Staff delete an unused venue and the response records who and when', async () => {
  const { app, calls } = venues('venue_staff', async () => ({ outcome: 'deleted', venue: deleted }));
  const res = await request(app).delete('/api/venues/4').set(auth);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { venue: deleted });
  assert.deepEqual(calls, [4]);
});

test('[CONFLICT] [SG2-106:AC1] a venue with live work is refused and the blockers are listed', async () => {
  const { app } = venues('venue_staff', async () => ({ outcome: 'blocked', blockers }));
  const res = await request(app).delete('/api/venues/4').set(auth);
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'This venue still has current or future bookings, holds or pending requests.', blockers });
});

test('[BOUNDARY] [FAILURE] [SG2-106:AC1] bad, unknown or already deleted venue IDs never report a delete', async () => {
  const { app, calls } = venues('venue_staff', async () => ({ outcome: 'missing' }));
  for (const id of ['0', '-1', '01', '1.5', 'abc', '2147483648']) {
    assert.equal((await request(app).delete(`/api/venues/${id}`).set(auth)).status, 400);
  }
  assert.deepEqual(calls, []);
  const res = await request(app).delete('/api/venues/2147483647').set(auth);
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: 'Venue not found or already deleted.' });
  assert.deepEqual(calls, [2147483647]);
});

for (const role of ROLES.filter(role => role !== 'venue_staff')) test(`[FAILURE] [SG2-106:AC5] ${role} cannot delete a venue or change a hold expiry`, async () => {
  const venue = venues(role, async () => ({ outcome: 'deleted', venue: deleted }));
  assert.equal((await request(venue.app).delete('/api/venues/4').set(auth)).status, 403);
  assert.deepEqual(venue.calls, []);
  const holdApp = holds(role, async () => ({ outcome: 'updated', hold }));
  assert.equal((await request(holdApp.app).post('/api/venue-holds/7/expiry').set(auth).send({ expires_at: '2030-01-06T00:00:00Z' })).status, 403);
  assert.deepEqual(holdApp.calls, []);
});

for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET')]) {
  test(`[FAILURE] [SG2-106:AC1] [SG2-106:AC3] database failures fail closed: ${error.message}`, async () => {
    const venue = venues('venue_staff', async () => { throw error; });
    const status = error instanceof AccessError ? error.status : 503;
    const deletedRes = await request(venue.app).delete('/api/venues/4').set(auth);
    assert.equal(deletedRes.status, status);
    assert.doesNotMatch(JSON.stringify(deletedRes.body), /SECRET/);
    const hold = holds('venue_staff', async () => { throw error; });
    const changed = await request(hold.app).post('/api/venue-holds/7/expiry').set(auth).send({ expires_at: '2030-01-06T00:00:00Z' });
    assert.equal(changed.status, status);
    assert.doesNotMatch(JSON.stringify(changed.body), /SECRET/);
  });
}

test('[NORMAL] [SG2-106:AC3] [SG2-106:AC4] Venue Staff move an active hold expiry and get the updated hold back', async () => {
  const updated = { ...hold, expires_at: '2030-01-06T00:00:00.000Z' };
  const { app, calls } = holds('venue_staff', async () => ({ outcome: 'updated', hold: updated }));
  const res = await request(app).post('/api/venue-holds/7/expiry').set(auth).send({ expires_at: '2030-01-06T08:00:00+08:00' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body, { hold: updated });
  // The zone is normalised to UTC before the database sees it.
  assert.deepEqual(calls, [[7, '2030-01-06T00:00:00.000Z']]);
});

test('[BOUNDARY] [SG2-106:AC3] the new expiry must be a zoned future time, and nothing else may be sent', () => {
  assert.equal(validateHoldExpiry({ expires_at: '2030-01-01T00:00:00.001Z' }, NOW), '2030-01-01T00:00:00.001Z');
  for (const body of [null, [], 'x', {}, { expires_at: '2030-01-01T00:00:00.000Z' }, { expires_at: '2029-12-31T23:59:59Z' },
    { expires_at: '2030-01-06T00:00:00' }, { expires_at: '2030-02-30T00:00:00Z' }, { expires_at: 1893456000000 },
    { expires_at: '2030-01-06T00:00:00Z', status: 'tentative' }]) {
    assert.equal(validateHoldExpiry(body, NOW), null, JSON.stringify(body));
  }
});

test('[FAILURE] [SG2-106:AC3] invalid requests and inactive, missing or refused holds are reported without a change', async () => {
  const outcomes: HoldMutationResult[] = [{ outcome: 'inactive' }, { outcome: 'missing' }, { outcome: 'invalid' }];
  const { app, calls } = holds('venue_staff', async () => outcomes.shift()!);
  assert.equal((await request(app).post('/api/venue-holds/0/expiry').set(auth).send({ expires_at: '2030-01-06T00:00:00Z' })).status, 400);
  const past = await request(app).post('/api/venue-holds/7/expiry').set(auth).send({ expires_at: '2029-12-31T00:00:00Z' });
  assert.equal(past.status, 400);
  assert.deepEqual(past.body, { error: 'Enter a new future expiry with a time zone, different from the current one.' });
  assert.deepEqual(calls, []);
  const send = () => request(app).post('/api/venue-holds/7/expiry').set(auth).send({ expires_at: '2030-01-06T00:00:00Z' });
  const inactive = await send();
  assert.equal(inactive.status, 409);
  assert.deepEqual(inactive.body, { error: 'This hold is no longer active. Place a new request.' });
  assert.equal((await send()).status, 404);
  const same = await send();
  assert.equal(same.status, 400);
  assert.deepEqual(same.body, past.body);
  assert.equal(calls.length, 3);
});
