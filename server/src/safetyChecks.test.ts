import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, ROLES, type Role } from './auth';
import { createApp } from './app';
import { createSafetyChecksRouter } from './safetyChecks';
import type { SafetyCheckEvent, SafetyChecksStore } from './db/safetyChecks';

const events: SafetyCheckEvent[] = [{
  event_id: 7, safety_check_revision: 3, name: 'Open Day', organisation: 'SMU', proposed_date: '2031-11-01T09:00:00Z',
  awaiting_since: '2031-10-01T02:00:00Z', expected_attendance: 120, accessibility_needs: 'Wheelchair seating',
  expected_crowd_movement: 'Enter east, leave west',
  venues: [{ request_id: 11, venue_id: 4, venue_name: 'Hall', location: 'Level 1', capacity: 300, layout: 'theatre',
    starts_at: '2031-11-01T09:00:00Z', ends_at: '2031-11-01T17:00:00Z', accessibility_features: 'Ramp',
    emergency_access: 'Two exits', known_restrictions: 'No open flames' }],
  equipment: [{ request_id: 21, equipment_name: 'Speakers', quantity: 2, placement_venue_name: 'Hall',
    placement_position: 'Stage left', arrangement_notes: 'Cable ramps' }]
}];
const auth = { Authorization: 'Bearer officer-token' };

function fixture(role: Role = 'safety_officer', list: () => Promise<SafetyCheckEvent[]> = async () => events) {
  let reads = 0;
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'officer-1', role }) });
  const store = (token: string): SafetyChecksStore => {
    assert.equal(token, 'officer-token');
    return { list: async () => { reads++; return list(); } };
  };
  const router = createSafetyChecksRouter(access, store);
  return { app: express().use('/api/safety-checks', router), router, access, reads: () => reads };
}

test('[NORMAL] [SG2-91:AC2] [SG2-91:AC3] a Safety Officer opens the list of events awaiting a check with every review detail', async () => {
  const { app, reads } = fixture();
  const response = await request(app).get('/api/safety-checks').set(auth);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, { events });
  assert.equal(reads(), 1);
});

test('[NORMAL] [SG2-91:AC2] production mounts the list and leaves public health accessible', async () => {
  const { router, access } = fixture();
  const args = Array.from({ length: 36 }, () => undefined) as unknown as Parameters<typeof createApp>;
  args[1] = access; args[35] = router;
  const app = createApp(...args);
  assert.equal((await request(app).get('/api/health')).status, 200);
  const response = await request(app).get('/api/safety-checks').set(auth);
  assert.equal(response.status, 200); assert.deepEqual(response.body, { events });
});

test('[BOUNDARY] [SG2-91:AC2] with nothing awaiting a check the list is empty rather than an error', async () => {
  const { app } = fixture('safety_officer', async () => []);
  const response = await request(app).get('/api/safety-checks').set(auth);
  assert.deepEqual([response.status, response.body], [200, { events: [] }]);
});

for (const role of ROLES.filter(role => role !== 'safety_officer')) {
  test(`[FAILURE] [SG2-91:AC4] ${role} cannot open the safety check list, even with a forged role header`, async () => {
    const { app, reads } = fixture(role);
    const response = await request(app).get('/api/safety-checks').set(auth).set('X-Role', 'safety_officer');
    assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
    assert.equal(reads(), 0);
  });
}

test('[FAILURE] [SG2-91:AC4] unsigned or expired credentials cannot open the list', async () => {
  const { app, reads } = fixture();
  assert.equal((await request(app).get('/api/safety-checks')).status, 401);
  const access = createAuthorization({ resolvePrincipal: async () => { throw new AccessError(401); } });
  const expired = express().use('/api/safety-checks', createSafetyChecksRouter(access, () => assert.fail('Expired credentials must not reach storage')));
  assert.equal((await request(expired).get('/api/safety-checks').set(auth)).status, 401);
  assert.equal(reads(), 0);
});

test('[CONFLICT] [SG2-91:AC4] a Safety Officer whose stored role changed after sign-in is refused by the database check', async () => {
  const { app } = fixture('safety_officer', async () => { throw new AccessError(403); });
  const response = await request(app).get('/api/safety-checks').set(auth);
  assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
});

test('[FAILURE] [SG2-91:AC2] an unavailable database or unexpected failure answers 503 without detail', async () => {
  for (const failure of [new AccessError(503), new Error('connection string leaked')]) {
    const { app } = fixture('safety_officer', async () => { throw failure; });
    const response = await request(app).get('/api/safety-checks').set(auth);
    assert.deepEqual([response.status, response.body],
      [503, { error: 'The safety check list is temporarily unavailable. Please try again.' }]);
  }
});
