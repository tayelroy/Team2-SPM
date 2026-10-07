import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createEquipmentRouter } from './equipment';
import { validateEquipment, type EquipmentRecord, type EquipmentValues } from './equipment/fields';
import type { EquipmentStore } from './db/equipment';

const values: EquipmentValues = { type: 'Projector', description: '4K projector', quantity_held: 10,
  location: 'Store A', operational_status: 'operational' };
const roles = ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff',
  'attendee', 'event_coordinator_lead', 'safety_officer'] as const;
function fixture(role: Role = 'technical_support_staff', override?: EquipmentStore) {
  const rows: EquipmentRecord[] = [];
  let writes = 0;
  const record = (input: EquipmentValues, equipment_id: number, version: number): EquipmentRecord => ({
    ...input, equipment_id, version, available_quantity: input.operational_status === 'operational' ? input.quantity_held : 0
  });
  const store: EquipmentStore = override ?? {
    list: async () => rows,
    create: async input => { writes++; const row = record(input, rows.length + 1, 1); rows.push(row); return row; },
    update: async (id, version, input) => {
      writes++;
      const index = rows.findIndex(row => row.equipment_id === id && row.version === version);
      if (index < 0) return null;
      rows[index] = record(input, id, version + 1);
      return rows[index];
    }
  };
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'support-1', role }) });
  const app = express().use(express.json()).use('/api/equipment', createEquipmentRouter(access, token => {
    assert.equal(token, 'valid-token'); return store;
  }));
  return { app, rows, writes: () => writes };
}

for (const role of roles) test(`${role === 'technical_support_staff' ? '[NORMAL]' : '[FAILURE]'} [SG2-52:AC3] only Technical Support Staff edit equipment (${role})`, async () => {
  const { app, writes } = fixture(role);
  for (const method of ['post', 'patch'] as const) {
    const response = await request(app)[method](`/api/equipment${method === 'patch' ? '/1' : ''}`)
      .set('Authorization', 'Bearer valid-token').set('X-Role', 'technical_support_staff')
      .send({ ...values, version: 1, role: 'technical_support_staff', available_quantity: 99 });
    assert.equal(response.status, role === 'technical_support_staff' ? method === 'post' ? 201 : 200 : 403);
  }
  assert.equal(writes(), role === 'technical_support_staff' ? 2 : 0);
  assert.equal((await request(app).get('/api/equipment').set('Authorization', 'Bearer valid-token')).status,
    role === 'technical_support_staff' ? 200 : 403);
});

test('[FAILURE] [SG2-52:AC3] the production app protects every equipment route before reading or writing', async () => {
  for (const method of ['get', 'post', 'patch'] as const) {
    assert.equal((await request(createApp())[method](`/api/equipment${method === 'patch' ? '/1' : ''}`).send(values)).status, 401);
  }
});

test('[NORMAL] [SG2-52:AC1] create, edit and list return all maintained fields with trimmed text and no caller-controlled metadata', async () => {
  const { app } = fixture();
  const created = await request(app).post('/api/equipment').set('Authorization', 'Bearer valid-token')
    .send({ ...values, type: ' Projector \n', description: ' 4K projector ', location: ' Store A ', equipment_id: 99, version: 500, unknown: 'ignored' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { equipment: { ...values, equipment_id: 1, version: 1, available_quantity: 10 } });
  const edited = await request(app).patch('/api/equipment/1').set('Authorization', 'Bearer valid-token')
    .send({ ...values, type: 'Speaker', description: 'Portable speaker', location: 'Store B', quantity_held: 12, version: 1 });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.equipment, { ...values, type: 'Speaker', description: 'Portable speaker', location: 'Store B',
    quantity_held: 12, equipment_id: 1, available_quantity: 12, version: 2 });
  const listed = await request(app).get('/api/equipment').set('Authorization', 'Bearer valid-token');
  assert.equal(listed.status, 200);
  assert.equal(listed.headers['cache-control'], 'no-store');
  assert.deepEqual(listed.body, { equipment: [edited.body.equipment] });
});

test('[NORMAL] [SG2-52:AC2] damaged and maintenance equipment has zero availability and returning to service restores held stock', async () => {
  const { app } = fixture();
  await request(app).post('/api/equipment').set('Authorization', 'Bearer valid-token').send(values);
  for (const [index, operational_status] of ['damaged', 'maintenance', 'operational'].entries()) {
    const response = await request(app).patch('/api/equipment/1').set('Authorization', 'Bearer valid-token')
      .send({ ...values, operational_status, version: index + 1 });
    assert.equal(response.status, 200);
    assert.equal(response.body.equipment.available_quantity, operational_status === 'operational' ? 10 : 0);
    assert.equal(response.body.equipment.quantity_held, 10);
  }
});

test('[BOUNDARY] [FAILURE] [SG2-52:AC1] invalid shapes, missing text, overlong text, quantities and statuses never reach storage', async () => {
  for (const input of [null, undefined, [], 'bad', 1, true]) assert.equal(validateEquipment(input), null);
  const { app, writes } = fixture();
  const inputs = [{}, [], ...['type', 'description', 'location'].flatMap(field =>
    [undefined, '', ' \n ', null, 5, false].map(value => ({ ...values, [field]: value }))),
    { ...values, type: '🎤'.repeat(256) }, { ...values, description: '🎤'.repeat(2001) }, { ...values, location: '🎤'.repeat(2001) },
    ...[undefined, null, true, '10', -1, 0.5, 2147483648].map(quantity_held => ({ ...values, quantity_held })),
    ...[undefined, null, 1, true, 'unknown', 'Operational'].map(operational_status => ({ ...values, operational_status }))];
  for (const input of inputs) for (const method of ['post', 'patch'] as const) {
    const body = Array.isArray(input) ? input : { ...input, version: 1 };
    assert.equal((await request(app)[method](`/api/equipment${method === 'patch' ? '/1' : ''}`)
      .set('Authorization', 'Bearer valid-token').send(body)).status, 400, JSON.stringify(input));
  }
  assert.equal(writes(), 0);
});

test('[BOUNDARY] [SG2-52:AC1] zero held stock and exact Unicode text and integer limits are accepted', async () => {
  const { app } = fixture();
  for (const quantity_held of [0, 2147483647]) {
    const input = { ...values, type: '🎤'.repeat(255), description: '🎤'.repeat(2000), location: '🎤'.repeat(2000), quantity_held };
    const response = await request(app).post('/api/equipment').set('Authorization', 'Bearer valid-token').send(input);
    assert.equal(response.status, 201);
    assert.equal(response.body.equipment.available_quantity, quantity_held);
    assert.equal(response.body.equipment.type, input.type);
  }
});

test('[BOUNDARY] [SG2-52:AC1] invalid IDs and missing or invalid versions are rejected before writing', async () => {
  const { app, writes } = fixture();
  for (const id of ['0', '-1', '01', '1.5', '1e2', 'abc', '2147483648']) {
    assert.equal((await request(app).patch(`/api/equipment/${id}`).set('Authorization', 'Bearer valid-token').send({ ...values, version: 1 })).status, 400);
  }
  for (const version of [undefined, null, true, '1', 0, -1, 0.5, 9007199254740992]) {
    assert.equal((await request(app).patch('/api/equipment/1').set('Authorization', 'Bearer valid-token').send({ ...values, version })).status, 400);
  }
  assert.equal(writes(), 0);
  assert.equal((await request(app).patch('/api/equipment/2147483647').set('Authorization', 'Bearer valid-token')
    .send({ ...values, version: Number.MAX_SAFE_INTEGER })).status, 409);
});

test('[CONFLICT] [SG2-52:AC1] a stale editor receives 409 and cannot overwrite the first saved change', async () => {
  const { app, rows } = fixture();
  await request(app).post('/api/equipment').set('Authorization', 'Bearer valid-token').send(values);
  assert.equal((await request(app).patch('/api/equipment/1').set('Authorization', 'Bearer valid-token')
    .send({ ...values, quantity_held: 7, version: 1 })).status, 200);
  const stale = await request(app).patch('/api/equipment/1').set('Authorization', 'Bearer valid-token')
    .send({ ...values, quantity_held: 99, version: 1 });
  assert.equal(stale.status, 409);
  assert.match(stale.body.error, /Refresh/);
  assert.equal(rows[0].quantity_held, 7);
  assert.equal(rows[0].version, 2);
});

test('[FAILURE] [SG2-52:AC1] an insert without a returned record is reported as unavailable', async () => {
  const { app } = fixture('technical_support_staff', { list: async () => [], create: async () => null, update: async () => null });
  assert.equal((await request(app).post('/api/equipment').set('Authorization', 'Bearer valid-token').send(values)).status, 503);
});

for (const error of [new AccessError(401), new AccessError(403), new AccessError(503), new Error('PRIVATE_DATABASE_DETAIL')]) {
  test(`[FAILURE] [SG2-52:AC1] database failure fails closed and hides internal details (${error.constructor.name}: ${error.message})`, async () => {
    const fail = async () => { throw error; };
    const { app } = fixture('technical_support_staff', { list: fail, create: fail, update: fail });
    for (const method of ['get', 'post', 'patch'] as const) {
      const response = await request(app)[method](`/api/equipment${method === 'patch' ? '/1' : ''}`)
        .set('Authorization', 'Bearer valid-token').send({ ...values, version: 1 });
      assert.equal(response.status, error instanceof AccessError ? error.status : 503);
      assert.deepEqual(response.body, { error: error instanceof AccessError ? error.message : 'Access service unavailable' });
      assert.doesNotMatch(response.text, /PRIVATE_DATABASE_DETAIL/);
    }
  });
}
