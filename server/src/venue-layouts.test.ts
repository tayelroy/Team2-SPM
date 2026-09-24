import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createVenueLayoutsRouter } from './venues/layouts';
import { validateVenueLayouts } from './venues/layoutFields';
import type { VenueLayoutStore } from './db/venueLayouts';
import type { VenueLayoutRecord } from './venues/layoutFields';

const ACCOUNT_ROLES = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'
] as const;

const classroom = { layout: 'classroom', other_description: null } as const;
const other = { layout: 'other', other_description: 'U-shape with side tables' } as const;

function fixture(role: Role = 'venue_staff', override?: VenueLayoutStore) {
  const rowsByVenue = new Map<number, VenueLayoutRecord[]>([[1, [classroom]]]);
  let writes = 0;
  const store: VenueLayoutStore = override ?? {
    list: async venueId => rowsByVenue.get(venueId) ?? [],
    replace: async (venueId, layouts) => {
      writes++;
      if (venueId !== 1) return null;
      const saved = layouts.map(item => ({ layout: item.layout, other_description: item.other_description ?? null }));
      rowsByVenue.set(venueId, saved);
      return saved;
    }
  };
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) });
  const app = express();
  app.use(express.json());
  app.use('/api/venues', createVenueLayoutsRouter(access, token => {
    assert.equal(token, 'valid-token');
    return store;
  }));
  return { app, writes: () => writes };
}

for (const role of ACCOUNT_ROLES) test(`SG2-43: only venue staff can write layouts (${role})`, async () => {
  const { app, writes } = fixture(role);
  const write = await request(app).put('/api/venues/1/layouts').set('Authorization', 'Bearer valid-token').send({ layouts: [classroom] });
  assert.equal(write.status, role === 'venue_staff' ? 200 : 403);
  assert.equal(writes(), role === 'venue_staff' ? 1 : 0);
  const read = await request(app).get('/api/venues/1/layouts').set('Authorization', 'Bearer valid-token');
  assert.equal(read.status, ['venue_staff', 'event_coordinator'].includes(role) ? 200 : 403);
});

test('the production app protects both layout routes without credentials', async () => {
  for (const method of ['get', 'put'] as const) {
    const response = await request(createApp())[method]('/api/venues/1/layouts').send({ layouts: [classroom] });
    assert.equal(response.status, 401);
  }
});

test('list returns the venue\'s current layouts and PUT replaces them wholesale', async () => {
  const { app } = fixture();
  const initial = await request(app).get('/api/venues/1/layouts').set('Authorization', 'Bearer valid-token');
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.layouts, [classroom]);

  const updated = await request(app).put('/api/venues/1/layouts').set('Authorization', 'Bearer valid-token')
    .send({ layouts: [classroom, other] });
  assert.equal(updated.status, 200);
  assert.equal(updated.headers['cache-control'], 'no-store');
  assert.deepEqual(updated.body.layouts, [
    { layout: 'classroom', other_description: null },
    { layout: 'other', other_description: 'U-shape with side tables' }
  ]);

  const cleared = await request(app).put('/api/venues/1/layouts').set('Authorization', 'Bearer valid-token').send({ layouts: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body.layouts, []);
});

test('non-array and malformed inputs are rejected by the validator', () => {
  for (const input of [null, undefined, {}, 'bad', 1, true]) assert.equal(validateVenueLayouts(input), null);
  assert.equal(validateVenueLayouts([{ layout: 'unknown' }]), null);
  assert.equal(validateVenueLayouts([classroom, classroom]), null, 'duplicate layouts rejected');
  assert.equal(validateVenueLayouts([{ layout: 'other' }]), null, 'other requires a description');
  assert.equal(validateVenueLayouts([{ layout: 'other', other_description: '  ' }]), null, 'blank description rejected');
  assert.equal(validateVenueLayouts([{ layout: 'other', other_description: '🏛'.repeat(256) }]), null, 'description too long');
  assert.equal(validateVenueLayouts([{ layout: 'classroom', other_description: 'not allowed' }]), null, 'non-other cannot carry a description');
  assert.deepEqual(validateVenueLayouts([{ layout: 'other', other_description: ' padded ' }]), [{ layout: 'other', other_description: 'padded' }]);
  assert.deepEqual(validateVenueLayouts([]), []);
});

test('PUT rejects invalid layout bodies without writing', async () => {
  const { app, writes } = fixture();
  for (const body of [{}, { layouts: 'nope' }, { layouts: [{ layout: 'unknown' }] }, { layouts: [{ layout: 'other' }] }]) {
    const response = await request(app).put('/api/venues/1/layouts').set('Authorization', 'Bearer valid-token').send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  assert.equal(writes(), 0);
});

test('invalid venue IDs are rejected before reaching the store; an in-range missing venue returns 404', async () => {
  const { app, writes } = fixture();
  for (const id of ['0', '-1', '01', '1.5', 'abc', '2147483648']) {
    assert.equal((await request(app).get(`/api/venues/${id}/layouts`).set('Authorization', 'Bearer valid-token')).status, 400);
    assert.equal((await request(app).put(`/api/venues/${id}/layouts`).set('Authorization', 'Bearer valid-token').send({ layouts: [] })).status, 400);
  }
  assert.equal(writes(), 0);
  assert.equal((await request(app).put('/api/venues/999/layouts').set('Authorization', 'Bearer valid-token').send({ layouts: [] })).status, 404);
  assert.equal(writes(), 1);
});

for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET')]) {
  test(`database failures fail closed: ${error.message}`, async () => {
    const { app } = fixture('venue_staff', { list: async () => { throw error; }, replace: async () => { throw error; } });
    for (const method of ['get', 'put'] as const) {
      const res = await request(app)[method]('/api/venues/1/layouts').set('Authorization', 'Bearer valid-token').send({ layouts: [] });
      assert.equal(res.status, error instanceof AccessError ? error.status : 503);
      assert.deepEqual(res.body, { error: error instanceof AccessError ? error.message : 'Access service unavailable' });
    }
  });
}
