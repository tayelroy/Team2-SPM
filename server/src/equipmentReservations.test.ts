import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { dbConfig } from './db/config';
import { createEquipmentReservationsRouter } from './equipment/reservations';
import type { EquipmentReservationsStore, ReservationsResult } from './db/equipmentReservations';

const ready: ReservationsResult = { outcome: 'ok', can_reserve: true, coordinator_notified: true,
  reservations: [{ reservation_id: 21, event_id: 7, request_id: 11, equipment_id: 4,
    equipment_type: 'Microphone', quantity_reserved: 6, starts_at: '2030-01-01T09:00:00Z',
    ends_at: '2030-01-01T11:00:00Z', reserved_at: '2026-10-11T02:00:00Z' }] };
const body = { event_id: 7, version: 3, starts_at: '2030-01-01T09:00:00Z', ends_at: '2030-01-01T11:00:00Z' };
const period = { starts_at: '2030-01-01T09:00:00.000Z', ends_at: '2030-01-01T11:00:00.000Z' };
const auth = { Authorization: 'Bearer staff-token' };
const readUrl = '/api/equipment-reservations';
const reserveUrl = '/api/equipment-requests/11/reservation';
function fixture(result: ReservationsResult = ready, role: Role = 'technical_support_staff', failure?: Error) {
  const calls: unknown[][] = [];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'support-1', role }) });
  const store: EquipmentReservationsStore = { run: async (...args) => { calls.push(args); if (failure) throw failure; return result; } };
  const router = createEquipmentReservationsRouter(access, token => { assert.equal(token, 'staff-token'); return store; });
  return { app: express().use(express.json({ strict: false })).use('/api', router), router, access, calls };
}

test('[NORMAL] [SG2-55:AC1] [SG2-55:AC4] Technical Support reserves the current request through one transaction and receives its persisted receipt', async () => {
  const { app, calls } = fixture();
  const response = await request(app).post(reserveUrl).set(auth).send(body);
  assert.equal(response.status, 201); assert.equal(response.headers['cache-control'], 'no-store');
  const { outcome, ...view } = ready;
  assert.deepEqual(response.body, view);
  assert.deepEqual(calls, [['reserve', 7, 11, 3, period]]);
});
test('[NORMAL] [SG2-55:AC4] Support coordinators and Safety Officers read event reservation receipts without performing a write', async () => {
  for (const role of ['technical_support_staff', 'event_coordinator', 'safety_officer'] as const) {
    const result: ReservationsResult = { outcome: 'ok', reservations: ready.reservations, can_reserve: role === 'technical_support_staff' };
    const { app, calls } = fixture(result, role);
    const response = await request(app).get(readUrl).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, 200); assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, { reservations: ready.reservations, can_reserve: role === 'technical_support_staff' });
    assert.deepEqual(calls, [['read', 7, undefined, undefined, undefined]]);
  }
});
test('[NORMAL] [SG2-55:AC1] [SG2-55:AC4] production mounts both endpoints and leaves public health accessible', async () => {
  const { router, access, calls } = fixture();
  const args = Array.from({ length: 32 }, () => undefined) as Parameters<typeof createApp>;
  args[1] = access; args[31] = router;
  const app = createApp(...args);
  assert.equal((await request(app).get('/api/health')).status, 200);
  const read = await request(app).get(readUrl).query({ event_id: 7 }).set(auth);
  const reserved = await request(app).post(reserveUrl).set(auth).send(body);
  assert.equal(read.status, 200); assert.deepEqual(read.body.reservations, ready.reservations);
  assert.equal(reserved.status, 201); assert.equal(reserved.body.coordinator_notified, true);
  assert.deepEqual(calls, [['read', 7, undefined, undefined, undefined], ['reserve', 7, 11, 3, period]]);
});
for (const role of ['event_organiser', 'event_coordinator', 'venue_staff', 'attendee', 'event_coordinator_lead', 'safety_officer'] as const) {
  test(`[FAILURE] [SG2-55:AC1] ${role} cannot reserve equipment using a forged support role header`, async () => {
    const { app, calls } = fixture(ready, role);
    const response = await request(app).post(reserveUrl).set(auth).set('X-Role', 'technical_support_staff').send(body);
    assert.equal(response.status, 403); assert.deepEqual(response.body, { error: 'Access denied' }); assert.deepEqual(calls, []);
  });
}
test('[FAILURE] [SG2-55:AC4] roles without event equipment read permission cannot list receipts', async () => {
  for (const role of ['event_organiser', 'venue_staff', 'attendee', 'event_coordinator_lead'] as const) {
    const { app, calls } = fixture(ready, role);
    const response = await request(app).get(readUrl).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, 403); assert.deepEqual(response.body, { error: 'Access denied' }); assert.deepEqual(calls, []);
  }
});
test('[FAILURE] [SG2-55:AC1] unsigned or expired credentials cannot read receipts or reserve equipment', async () => {
  const { app, calls } = fixture();
  assert.equal((await request(app).get(readUrl).query({ event_id: 7 })).status, 401);
  assert.equal((await request(app).post(reserveUrl).send(body)).status, 401); assert.deepEqual(calls, []);
  const access = createAuthorization({ resolvePrincipal: async () => { throw new AccessError(401); } });
  const expired = express().use(express.json()).use('/api', createEquipmentReservationsRouter(access, () => { assert.fail('Expired credentials must not reach storage'); }));
  assert.equal((await request(expired).get(readUrl).query({ event_id: 7 }).set(auth)).status, 401);
  assert.equal((await request(expired).post(reserveUrl).set(auth).send(body)).status, 401);
});
test('[BOUNDARY] [SG2-55:AC1] maximum identifiers and version with a one-millisecond offset interval reach storage exactly', async () => {
  const { app, calls } = fixture();
  const maximumBody = { event_id: 2147483647, version: Number.MAX_SAFE_INTEGER,
    starts_at: '2030-01-01T17:00:00.000+08:00', ends_at: '2030-01-01T09:00:00.001Z' };
  const response = await request(app).post('/api/equipment-requests/9007199254740991/reservation').set(auth).send(maximumBody);
  assert.equal(response.status, 201);
  assert.equal((await request(app).get(readUrl).query({ event_id: 2147483647 }).set(auth)).status, 200);
  assert.deepEqual(calls, [['reserve', 2147483647, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
    { starts_at: period.starts_at, ends_at: '2030-01-01T09:00:00.001Z' }], ['read', 2147483647, undefined, undefined, undefined]]);
});
test('[BOUNDARY] [FAILURE] [SG2-55:AC4] malformed duplicate or extra read query values never reach storage', async () => {
  const { app, calls } = fixture();
  for (const event_id of ['', '0', '-1', '01', '1e2', '1.5', '2147483648', '9007199254740992', 'no']) {
    assert.equal((await request(app).get(readUrl).query({ event_id }).set(auth)).status, 400);
  }
  for (const suffix of ['', '?event_id=7&event_id=8', '?event_id[x]=7', '?event_id=7&quantity=1']) {
    assert.equal((await request(app).get(readUrl + suffix).set(auth)).status, 400);
  }
  assert.deepEqual(calls, []);
});
test('[FAILURE] [SG2-55:AC1] reservation bodies reject non-objects and all unrecognised writable fields', async () => {
  const { app, calls } = fixture();
  for (const value of [null, [], 'body', 42, false]) {
    assert.equal((await request(app).post(reserveUrl).set(auth).set('Content-Type', 'application/json').send(JSON.stringify(value))).status, 400);
  }
  for (const extra of [{ quantity: 1 }, { quantity_reserved: 999 }, { equipment_id: 99 }, { status: 'approved' }, { coordinator_notified: true }]) {
    assert.equal((await request(app).post(reserveUrl).set(auth).send({ ...body, ...extra })).status, 400);
  }
  const unparsed = express().use('/api', createEquipmentReservationsRouter(fixture().access, () => { assert.fail('Missing body must not reach storage'); }));
  assert.equal((await request(unparsed).post(reserveUrl).set(auth)).status, 400);
  assert.deepEqual(calls, []);
});
test('[BOUNDARY] [FAILURE] [SG2-55:AC1] invalid event request or version values never reach storage', async () => {
  const { app, calls } = fixture();
  for (const event_id of [undefined, null, '', '7', 0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    assert.equal((await request(app).post(reserveUrl).set(auth).send({ ...body, event_id })).status, 400);
  }
  for (const version of [undefined, null, '', '3', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, {}, []]) {
    assert.equal((await request(app).post(reserveUrl).set(auth).send({ ...body, version })).status, 400);
  }
  for (const id of ['0', '-1', '01', '1e2', '1.5', '9007199254740992', 'no']) {
    assert.equal((await request(app).post(`/api/equipment-requests/${id}/reservation`).set(auth).send(body)).status, 400);
  }
  assert.deepEqual(calls, []);
});
test('[BOUNDARY] [FAILURE] [SG2-55:AC1] reservation periods require complete real zoned instants with an increasing end', async () => {
  const { app, calls } = fixture();
  for (const values of [{ starts_at: undefined }, { ends_at: undefined }, { starts_at: '', ends_at: '' },
    { starts_at: body.ends_at, ends_at: body.starts_at }, { starts_at: body.starts_at, ends_at: body.starts_at },
    ...[null, [], 42, '2030-01-01', '2030-01-01T09:00:00', '2030-02-30T09:00:00Z', '2030-13-01T09:00:00Z',
      '2030-01-01T24:00:00Z', '2030-01-01T09:00:00+08:99', 'garbage'].flatMap(value => [{ starts_at: value }, { ends_at: value }])]) {
    assert.equal((await request(app).post(reserveUrl).set(auth).send({ ...body, ...values })).status, 400, JSON.stringify(values));
  }
  assert.deepEqual(calls, []);
});
test('[CONFLICT] [SG2-55:AC3] refused transactions return the precise safe reason without a reservation receipt', async () => {
  for (const [outcome, status, error] of [
    ['missing', 404, 'Event or equipment request not found.'],
    ['invalid', 400, 'Choose a valid equipment request and reservation period.'],
    ['closed', 409, 'This event or request can no longer be reserved. Refresh before continuing.'],
    ['conflict', 409, 'This request changed or already has a reservation. Refresh before trying again.'],
    ['insufficient', 409, 'There is not enough operational equipment available for this period. Refresh availability before trying again.']
  ] as const) {
    const { app, calls } = fixture({ outcome });
    const response = await request(app).post(reserveUrl).set(auth).send(body);
    assert.equal(response.status, status); assert.deepEqual(response.body, { error, code: outcome });
    assert.deepEqual(calls, [['reserve', 7, 11, 3, period]]);
  }
});
test('[BOUNDARY] [SG2-55:AC4] empty or legacy undated event receipts retain database truth without invented notification or dates', async () => {
  for (const reservations of [[], [{ ...ready.reservations[0], request_id: null, starts_at: null, ends_at: null, reserved_at: null }]]) {
    const { app } = fixture({ outcome: 'ok', can_reserve: false, reservations });
    const response = await request(app).get(readUrl).query({ event_id: 7 }).set(auth);
    assert.equal(response.status, 200); assert.deepEqual(response.body, { can_reserve: false, reservations });
  }
});
test('[FAILURE] [SG2-55:AC1] provider errors preserve safe statuses without exposing private database details', async () => {
  for (const error of [new AccessError(401), new AccessError(403), new AccessError(503), new Error('PRIVATE_STORAGE_DETAIL')]) {
    const response: request.Response = await request(fixture(ready, 'technical_support_staff', error).app).post(reserveUrl).set(auth).send(body);
    assert.equal(response.status, error instanceof AccessError ? error.status : 503);
    assert.deepEqual(response.body, { error: error instanceof AccessError ? error.message : 'Access service unavailable' });
    assert.doesNotMatch(response.text, /PRIVATE_STORAGE_DETAIL/);
  }
});
test('[FAILURE] [SG2-55:AC1] the default reservation adapter reports missing database configuration safely', async () => {
  const original = { ...dbConfig };
  try {
    dbConfig.supabaseUrl = undefined;
    const { access } = fixture();
    const app = express().use(express.json()).use('/api', createEquipmentReservationsRouter(access));
    const response = await request(app).post(reserveUrl).set(auth).send(body);
    assert.equal(response.status, 503); assert.deepEqual(response.body, { error: 'Access service unavailable' });
  } finally { Object.assign(dbConfig, original); }
});
