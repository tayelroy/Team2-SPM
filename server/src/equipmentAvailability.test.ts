import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { dbConfig } from './db/config';
import { createEquipmentAvailabilityRouter } from './equipment/availability';
import type { EquipmentAvailabilityResult, EquipmentAvailabilityStore } from './db/equipmentAvailability';
const ready: EquipmentAvailabilityResult = { outcome: 'ok', event_id: 7, request_id: 11, equipment_id: 4,
  equipment_type: 'Microphone', quantity_requested: 6, quantity_held: 10, quantity_committed: 7,
  quantity_remaining: 3, shortfall: 3, undated_commitments: 1, operational_status: 'operational',
  starts_at: '2030-01-01T09:00:00.000Z', ends_at: '2030-01-01T11:00:00.000Z', period_source: 'request', checked_at: '2026-10-09T02:00:00.000Z' };
const auth = { Authorization: 'Bearer staff-token' };
function fixture(result: EquipmentAvailabilityResult = ready, role: Role = 'technical_support_staff', failure?: Error) {
  const calls: unknown[][] = [];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'support-1', role }) });
  const store: EquipmentAvailabilityStore = { run: async (...args) => { calls.push(args); if (failure) throw failure; return result; } };
  const router = createEquipmentAvailabilityRouter(access, token => { assert.equal(token, 'staff-token'); return store; });
  return { app: express().use('/api/equipment-requests', router), router, access, calls };
}
const url = '/api/equipment-requests/11/availability';

test('[NORMAL] [SG2-54:AC1] [SG2-54:AC3] Technical Support receives held committed remaining and shortfall with its checked period and timestamp', async () => {
  const { app, calls } = fixture();
  const response = await request(app).get(url).query({ event_id: 7 }).set(auth);
  assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
  const { outcome, ...data } = ready;
  assert.deepEqual(response.body, { ...data, status: 'ready' });
  assert.deepEqual(calls, [[7, 11, undefined]]);
});
test('[NORMAL] [SG2-54:AC1] production application mounts availability before existing requirements routes', async () => {
  const { router, access, calls } = fixture();
  const args = Array.from({ length: 31 }, () => undefined) as Parameters<typeof createApp>;
  args[1] = access; args[30] = router;
  const app = createApp(...args);
  const response = await request(app).get(url).query({ event_id: 7 }).set(auth);
  assert.equal(response.status, 200); assert.equal(response.body.quantity_remaining, 3); assert.deepEqual(calls, [[7, 11, undefined]]);
  assert.equal((await request(app).get('/api/equipment-requests?event_id=7')).status, 401);
});
for (const role of ['event_organiser', 'event_coordinator', 'venue_staff', 'attendee', 'event_coordinator_lead', 'safety_officer'] as const) {
  test(`[FAILURE] [SG2-54:AC1] ${role} cannot read availability even with a forged support header`, async () => {
    const { app, calls } = fixture(ready, role);
    const response = await request(app).get(url).query({ event_id: 7 }).set(auth).set('X-Role', 'technical_support_staff');
    assert.equal(response.status, 403); assert.deepEqual(response.body, { error: 'Access denied' }); assert.deepEqual(calls, []);
  });
}
test('[FAILURE] [SG2-54:AC1] unsigned and expired requests cannot reach the availability store', async () => {
  const { app, calls } = fixture();
  assert.equal((await request(app).get(url).query({ event_id: 7 })).status, 401); assert.deepEqual(calls, []);
  const access = createAuthorization({ resolvePrincipal: async () => { throw new AccessError(401); } });
  const expired = express().use('/api/equipment-requests', createEquipmentAvailabilityRouter(access, () => { assert.fail('Expired credentials must not query storage'); }));
  assert.equal((await request(expired).get(url).query({ event_id: 7 }).set(auth)).status, 401);
});
test('[BOUNDARY] [SG2-54:AC1] maximum event and request identities and a one-millisecond selected interval are retained exactly', async () => {
  const { app, calls } = fixture();
  const response = await request(app).get('/api/equipment-requests/9007199254740991/availability')
    .query({ event_id: 2147483647, starts_at: '2030-01-01T17:00:00.000+08:00', ends_at: '2030-01-01T09:00:00.001Z' }).set(auth);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [[2147483647, Number.MAX_SAFE_INTEGER, { starts_at: '2030-01-01T09:00:00.000Z', ends_at: '2030-01-01T09:00:00.001Z' }]]);
});
test('[BOUNDARY] [FAILURE] [SG2-54:AC1] malformed identities never reach storage', async () => {
  const { app, calls } = fixture();
  for (const event_id of ['', '0', '-1', '01', '1e2', '1.5', '2147483648', '9007199254740992', 'no']) {
    assert.equal((await request(app).get(url).query({ event_id }).set(auth)).status, 400);
  }
  for (const suffix of ['', '?event_id=7&event_id=8', '?event_id[x]=7']) assert.equal((await request(app).get(url + suffix).set(auth)).status, 400);
  for (const id of ['0', '-1', '01', '1e2', '1.5', '9007199254740992', 'no']) assert.equal((await request(app).get(`/api/equipment-requests/${id}/availability?event_id=7`).set(auth)).status, 400);
  assert.deepEqual(calls, []);
});
test('[BOUNDARY] [FAILURE] [SG2-54:AC1] selected dates require two real zoned instants in increasing order', async () => {
  const { app, calls } = fixture();
  const start = '2030-01-01T09:00:00Z'; const end = '2030-01-01T11:00:00Z';
  for (const period of [{ starts_at: start }, { ends_at: end }, { starts_at: '', ends_at: '' },
    { starts_at: end, ends_at: start }, { starts_at: start, ends_at: start },
    ...['2030-01-01', '2030-01-01T09:00:00', '2030-02-30T09:00:00Z', '2030-13-01T09:00:00Z', '2030-01-01T24:00:00Z', '2030-01-01T09:00:00+08:99', 'garbage'].flatMap(value => [{ starts_at: value, ends_at: end }, { starts_at: start, ends_at: value }])]) {
    assert.equal((await request(app).get(url).query({ event_id: 7, ...period }).set(auth)).status, 400, JSON.stringify(period));
  }
  assert.equal((await request(app).get(url).query({ event_id: 7, starts_at: [start, start], ends_at: end }).set(auth)).status, 400);
  assert.deepEqual(calls, []);
});
test('[BOUNDARY] [SG2-54:AC1] an undated request asks for dates without fabricating availability or duration', async () => {
  for (const proposed_start of [null, '2030-01-01T09:00:00Z']) {
    const response = await request(fixture({ outcome: 'dates_required', proposed_start }).app).get(url).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, 200); assert.deepEqual(response.body, { status: 'dates_required', proposed_start });
  }
});
test('[CONFLICT] [SG2-54:AC1] missing and invalid database snapshots refuse the calculation', async () => {
  for (const [outcome, status, error] of [['missing', 404, 'Event or equipment request not found.'], ['invalid', 400, 'Choose a valid equipment request and time period.']] as const) {
    const response = await request(fixture({ outcome }).app).get(url).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, status); assert.deepEqual(response.body, { error });
  }
});
test('[NORMAL] [SG2-54:AC2] [SG2-54:AC3] damaged and maintenance results preserve held stock but show zero remaining and full shortfall', async () => {
  for (const operational_status of ['damaged', 'maintenance'] as const) {
    const result: Extract<EquipmentAvailabilityResult, { outcome: 'ok' }> = { ...ready, operational_status, quantity_remaining: 0, shortfall: 6 };
    const response: request.Response = await request(fixture(result).app).get(url).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, 200); const { outcome, ...data } = result;
    assert.deepEqual(response.body, { ...data, status: 'ready' });
  }
});
test('[FAILURE] [SG2-54:AC1] store errors preserve safe public statuses and conceal provider details', async () => {
  for (const error of [new AccessError(401), new AccessError(403), new AccessError(503), new Error('PRIVATE_STORAGE_DETAIL')]) {
    const response: request.Response = await request(fixture(ready, 'technical_support_staff', error).app).get(url).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, error instanceof AccessError ? error.status : 503);
    assert.deepEqual(response.body, { error: error instanceof AccessError ? error.message : 'Access service unavailable' });
    assert.doesNotMatch(response.text, /PRIVATE_STORAGE_DETAIL/);
  }
});
test('[FAILURE] [SG2-54:AC1] default user-scoped store refuses missing configuration safely', async () => {
  const original = { ...dbConfig };
  try {
    dbConfig.supabaseUrl = undefined;
    const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'support-1', role: 'technical_support_staff' }) });
    const app = express().use('/api/equipment-requests', createEquipmentAvailabilityRouter(access));
    const response = await request(app).get(url).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, 503); assert.deepEqual(response.body, { error: 'Access service unavailable' });
  } finally { Object.assign(dbConfig, original); }
});
