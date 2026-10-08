import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createEquipmentRequirementsRouter, validateArrangement, validateRequirement } from './equipment/requirements';
import { dbConfig } from './db/config';
import type { EquipmentRequirementsStore, RequirementsResult, RequirementsView } from './db/equipmentRequirements';

const values = { equipment_id: 4, quantity: 2, notes: 'HDMI cable' };
const arranged = { arrangement_notes: 'One projector ready', shortfall: 1, placement_venue_id: 9, placement_position: 'Stage left' };
const view: RequirementsView = { event: { event_id: 7, name: 'Forum', status: 'planning' },
  requests: [{ request_id: 11, event_id: 7, equipment_id: 4, equipment_type: 'Projector', quantity: 2,
    notes: 'HDMI cable', status: 'pending', arrangement_notes: 'One projector ready', shortfall: 1,
    placement_venue_id: 9, placement_venue_name: 'Main hall', placement_position: 'Stage left', version: 3 }],
  equipment: [{ equipment_id: 4, type: 'Projector' }], venues: [{ venue_id: 9, name: 'Main hall' }], can_request: true, can_arrange: false };
const auth = { Authorization: 'Bearer valid-token' };
const endpoints = [ ['get', '/api/equipment-requests?event_id=7'], ['post', '/api/equipment-requests'],
  ['patch', '/api/equipment-requests/11'], ['patch', '/api/equipment-requests/11/arrangement'] ] as const;
function fixture(role: Role = 'event_coordinator', outcome: RequirementsResult = { outcome: 'ok', ...view }, fail?: Error) {
  const calls: unknown[][] = [];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'caller-1', role }), permissions: {
    'equipment_requirements.read': ['event_coordinator', 'technical_support_staff', 'safety_officer'],
    'equipment_requirements.request': ['event_coordinator'], 'equipment_requirements.arrange': ['technical_support_staff']
  } });
  const store: EquipmentRequirementsStore = { run: async (...args) => { calls.push(args); if (fail) throw fail; return outcome; } };
  const app = express().use(express.json()).use('/api/equipment-requests', createEquipmentRequirementsRouter(access, token => {
    assert.equal(token, 'valid-token'); return store;
  }));
  return { app, calls };
}

test('[NORMAL] [SG2-53:AC1] [SG2-53:AC2] coordinator reads, requests and amends with exact values and no caller-controlled record metadata', async () => {
  const { app, calls } = fixture();
  const input = { event_id: 7, ...values, notes: ' HDMI cable \n', version: 3, status: 'reserved', shortfall: 0, equipment_type: 'Invented' };
  const read = await request(app).get('/api/equipment-requests?event_id=7').set(auth);
  assert.equal(read.status, 200); assert.deepEqual(read.body, view); assert.equal(read.headers['cache-control'], 'no-store');
  const created = await request(app).post('/api/equipment-requests').set(auth).send(input);
  assert.equal(created.status, 201); assert.deepEqual(created.body, view);
  const amended = await request(app).patch('/api/equipment-requests/11').set(auth).send(input);
  assert.equal(amended.status, 200); assert.deepEqual(amended.body, view);
  assert.deepEqual(calls, [['read', 7, undefined, undefined, undefined], ['create', 7, undefined, undefined, values], ['amend', 7, 11, 3, values]]);
});

test('[NORMAL] [SG2-53:AC4] [SG2-53:AC5] [SG2-53:AC6] support arrangement records shortfall and per-item placement returned to readers', async () => {
  const { app, calls } = fixture('technical_support_staff');
  const saved = await request(app).patch('/api/equipment-requests/11/arrangement').set(auth)
    .send({ event_id: 7, version: 2, ...arranged, arrangement_notes: ' One projector ready ', placement_position: ' Stage left ' });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body, view);
  assert.deepEqual(calls, [['arrange', 7, 11, 2, arranged]]);
  const safety = await request(fixture('safety_officer').app).get('/api/equipment-requests?event_id=7').set(auth);
  assert.equal(safety.status, 200); assert.deepEqual(safety.body.requests[0], view.requests[0]);
});

for (const role of ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee', 'event_coordinator_lead', 'safety_officer'] as const) {
  test(`[FAILURE] [NORMAL] [SG2-53:AC1] [SG2-53:AC4] [SG2-53:AC6] role permissions guard every equipment requirement route (${role})`, async () => {
    const { app, calls } = fixture(role);
    let permitted = 0;
    for (const [method, url] of endpoints) {
      const allowed = method === 'get' ? ['event_coordinator', 'technical_support_staff', 'safety_officer'].includes(role)
        : url.endsWith('/arrangement') ? role === 'technical_support_staff' : role === 'event_coordinator';
      const response = await request(app)[method](url).set(auth).set('X-Role', 'event_coordinator')
        .send({ event_id: 7, version: 3, ...values, ...arranged, role: 'event_coordinator' });
      assert.equal(response.status, allowed ? method === 'post' ? 201 : 200 : 403);
      if (allowed) permitted++;
    }
    assert.equal(calls.length, permitted);
  });
}

test('[FAILURE] [SG2-53:AC1] unsigned requests are rejected before the store on every route', async () => {
  const { app, calls } = fixture();
  for (const [method, url] of endpoints) assert.equal((await request(app)[method](url).send({ event_id: 7, ...values, version: 3 })).status, 401);
  assert.deepEqual(calls, []);
});

test('[BOUNDARY] [FAILURE] [SG2-53:AC1] [SG2-53:AC3] malformed event, request and version identifiers never reach the store', async () => {
  const { app, calls } = fixture();
  for (const suffix of ['', '?event_id=0', '?event_id=-1', '?event_id=01', '?event_id=1e2', '?event_id=2147483648', '?event_id=a', '?event_id=7&event_id=8', '?event_id[x]=7']) {
    assert.equal((await request(app).get(`/api/equipment-requests${suffix}`).set(auth)).status, 400);
  }
  for (const event_id of [undefined, null, true, '7', 0, -1, 1.5, 2147483648]) {
    assert.equal((await request(app).post('/api/equipment-requests').set(auth).send({ ...values, event_id })).status, 400);
  }
  for (const id of ['0', '-1', '01', '1e2', 'bad', '9007199254740992']) {
    assert.equal((await request(app).patch(`/api/equipment-requests/${id}`).set(auth).send({ event_id: 7, version: 3, ...values })).status, 400);
  }
  for (const version of [undefined, null, true, '1', 0, -1, 0.5, 9007199254740992]) {
    assert.equal((await request(app).patch('/api/equipment-requests/11').set(auth).send({ event_id: 7, version, ...values })).status, 400);
  }
  assert.equal((await request(app).post('/api/equipment-requests').set(auth)).status, 400);
  assert.equal((await request(app).post('/api/equipment-requests').set(auth).send([])).status, 400);
  assert.deepEqual(calls, []);
});

test('[BOUNDARY] [SG2-53:AC1] [SG2-53:AC3] exact identifier and quantity limits and 2000 Unicode notes are accepted', async () => {
  const { app, calls } = fixture();
  const input = { event_id: 2147483647, equipment_id: 2147483647, quantity: 2147483647, notes: '🎤'.repeat(2000), version: Number.MAX_SAFE_INTEGER };
  assert.equal((await request(app).patch(`/api/equipment-requests/${Number.MAX_SAFE_INTEGER}`).set(auth).send(input)).status, 200);
  assert.deepEqual(calls, [['amend', 2147483647, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
    { equipment_id: 2147483647, quantity: 2147483647, notes: input.notes }]]);
  assert.deepEqual(validateRequirement({ equipment_id: 1, quantity: 1 }), { equipment_id: 1, quantity: 1, notes: null });
  for (const notes of [null, '', ' \n ']) assert.deepEqual(validateRequirement({ equipment_id: 1, quantity: 1, notes }), { equipment_id: 1, quantity: 1, notes: null });
});

test('[FAILURE] [BOUNDARY] [SG2-53:AC1] [SG2-53:AC3] nonpositive quantities and invalid equipment or notes are rejected without storage', async () => {
  for (const input of [null, undefined, [], 'bad', 1, true]) assert.equal(validateRequirement(input), null);
  const { app, calls } = fixture();
  const bad = [...['equipment_id', 'quantity'].flatMap(field => [undefined, null, '1', true, 0, -1, 0.5, 2147483648].map(value => ({ ...values, [field]: value }))),
    ...[3, false, [], {}, '🎤'.repeat(2001)].map(notes => ({ ...values, notes }))];
  for (const input of bad) assert.equal((await request(app).post('/api/equipment-requests').set(auth).send({ event_id: 7, ...input })).status, 400);
  assert.deepEqual(calls, []);
});

test('[BOUNDARY] [SG2-53:AC5] [SG2-53:AC6] zero shortfall and absent placement remain distinguishable from recorded placement', async () => {
  for (const venue of [undefined, null, '', ' \n ']) for (const position of [undefined, null, '', ' \n ']) {
    assert.deepEqual(validateArrangement({ shortfall: 0, placement_venue_id: venue, placement_position: position }),
      { arrangement_notes: null, shortfall: 0, placement_venue_id: null, placement_position: null });
  }
  const input = { arrangement_notes: '🎤'.repeat(2000), shortfall: 2147483647, placement_venue_id: 2147483647, placement_position: '🎤'.repeat(2000) };
  assert.deepEqual(validateArrangement(input), input);
});

test('[FAILURE] [BOUNDARY] [SG2-53:AC5] [SG2-53:AC6] invalid shortfalls and incomplete or overlong placements never reach storage', async () => {
  for (const input of [null, undefined, [], 'bad', 1, true]) assert.equal(validateArrangement(input), null);
  const { app, calls } = fixture('technical_support_staff');
  const bad = [ ...[undefined, null, '0', true, -1, 0.5, 2147483648].map(shortfall => ({ ...arranged, shortfall })),
    ...[1, false, {}, '🎤'.repeat(2001)].map(arrangement_notes => ({ ...arranged, arrangement_notes })),
    ...[1, false, {}, '🎤'.repeat(2001)].map(placement_position => ({ ...arranged, placement_position })),
    ...[0, -1, '9', true, 1.5, 2147483648].map(placement_venue_id => ({ ...arranged, placement_venue_id })),
    { ...arranged, placement_venue_id: null }, { ...arranged, placement_position: null } ];
  for (const input of bad) assert.equal((await request(app).patch('/api/equipment-requests/11/arrangement').set(auth).send({ event_id: 7, version: 3, ...input })).status, 400);
  assert.deepEqual(calls, []);
});

for (const [outcome, status, message] of [
  ['missing', 404, 'Event or equipment request not found.'],
  ['closed', 409, 'This event or request is no longer being arranged. Refresh before continuing.'],
  ['conflict', 409, 'This request changed. Refresh before saving again.'],
  ['duplicate', 409, 'This equipment already has a pending request for the event.'],
  ['invalid', 400, 'Check the equipment, quantity, shortfall and placement values.'] ] as const) {
  test(`[CONFLICT] [FAILURE] [SG2-53:AC2] [SG2-53:AC3] [SG2-53:AC5] ${outcome} has an explicit refusal response`, async () => {
    const { app, calls } = fixture('event_coordinator', { outcome });
    const response = await request(app).patch('/api/equipment-requests/11').set(auth).send({ event_id: 7, version: 3, ...values });
    assert.equal(response.status, status); assert.deepEqual(response.body, { error: message }); assert.equal(calls.length, 1);
  });
}

test('[FAILURE] [SG2-53:AC1] backend failures preserve public statuses and conceal private details', async () => {
  for (const error of [new AccessError(401), new AccessError(403), new AccessError(503), new Error('PRIVATE_DATABASE_DETAIL')]) {
    const { app } = fixture('event_coordinator', { outcome: 'ok', ...view }, error);
    const response = await request(app).get('/api/equipment-requests?event_id=7').set(auth);
    assert.equal(response.status, error instanceof AccessError ? error.status : 503);
    assert.deepEqual(response.body, { error: error instanceof AccessError ? error.message : 'Access service unavailable' });
    assert.doesNotMatch(response.text, /PRIVATE_DATABASE_DETAIL/);
  }
});
test('[FAILURE] [SG2-53:AC1] the default user-scoped store reports missing configuration safely', async () => {
  const original = { ...dbConfig };
  try {
    dbConfig.supabaseUrl = undefined;
    const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'c', role: 'event_coordinator' }), permissions: { 'equipment_requirements.read': ['event_coordinator'] } });
    const app = express().use('/api/equipment-requests', createEquipmentRequirementsRouter(access));
    const response = await request(app).get('/api/equipment-requests?event_id=7').set(auth);
    assert.equal(response.status, 503); assert.deepEqual(response.body, { error: 'Access service unavailable' });
  } finally { Object.assign(dbConfig, original); }
});
