import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, ROLES, type Role } from './auth';
import { createApp } from './app';
import { createVenuesRouter } from './venues';
import { TEXT_FIELDS, validateVenue, type VenueRecord } from './venues/fields';
import type { VenueStore } from './db/venues';

const values = { name: 'Atrium', location: 'Level 1', capacity: 100, facilities: 'Stage', accessibility_features: 'Lift', operating_information: '09:00–18:00' };
function fixture(role: Role = 'venue_staff', override?: VenueStore) {
  const rows: VenueRecord[] = [];
  let writes = 0;
  const store: VenueStore = override ?? {
    list: async () => rows,
    save: async (input, id) => {
      writes++;
      if (id !== undefined && !rows.some(row => row.venue_id === id)) return null;
      const venue = { ...input, venue_id: id ?? rows.length + 1 };
      const index = rows.findIndex(row => row.venue_id === id);
      if (index < 0) rows.push(venue); else rows[index] = venue;
      return venue;
    }
  };
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) });
  const app = express();
  app.use(express.json());
  app.use('/api/venues', createVenuesRouter(access, token => {
    assert.equal(token, 'valid-token');
    return store;
  }));
  return { app, rows, writes: () => writes };
}

test('SG2-42: creates, updates and reloads the persisted catalogue; body identity and IDs are ignored', async () => {
  const { app } = fixture();
  const created = await request(app).post('/api/venues').set('Authorization', 'Bearer valid-token')
    .send({ ...values, name: ' Atrium ', venue_id: 99, role: 'admin' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.venue, { ...values, venue_id: 1 });
  assert.equal(created.headers['cache-control'], 'no-store');
  const updated = await request(app).put('/api/venues/1').set('Authorization', 'Bearer valid-token').send({ ...values, location: 'North wing', capacity: 200 });
  assert.equal(updated.status, 200);
  const list = await request(app).get('/api/venues').set('Authorization', 'Bearer valid-token');
  assert.deepEqual(list.body.venues, [{ ...values, location: 'North wing', capacity: 200, venue_id: 1 }]);
});

for (const role of ROLES) test(`SG2-42: only venue staff can write (${role})`, async () => {
  const { app, writes } = fixture(role);
  for (const method of ['post', 'put'] as const) {
    const res = await request(app)[method](`/api/venues${method === 'put' ? '/1' : ''}`)
      .set('Authorization', 'Bearer valid-token').set('X-Role', 'venue_staff').send({ ...values, role: 'venue_staff' });
    assert.equal(res.status, role === 'venue_staff' ? method === 'post' ? 201 : 200 : 403);
  }
  assert.equal(writes(), role === 'venue_staff' ? 2 : 0);
  assert.equal((await request(app).get('/api/venues').set('Authorization', 'Bearer valid-token')).status,
    ['venue_staff', 'event_coordinator'].includes(role) ? 200 : 403);
});

test('the production app protects all venue routes without credentials', async () => {
  for (const method of ['get', 'post', 'put'] as const) {
    const response = await request(createApp())[method](`/api/venues${method === 'put' ? '/1' : ''}`).send(values);
    assert.equal(response.status, 401);
  }
  // Default router also installs authentication before handlers.
  const app = express();
  app.use(createVenuesRouter());
  assert.equal((await request(app).get('/')).status, 401);
});

test('invalid fields, capacities and IDs cause no writes', async () => {
  const { app, writes } = fixture();
  for (const input of [null, [], 'bad', {}, ...TEXT_FIELDS.map(field => ({ ...values, [field]: ' ' })),
    { ...values, name: 'a'.repeat(256) }, { ...values, facilities: 3 }, ...[0, -1, 1.5, 2147483648, '100', null].map(capacity => ({ ...values, capacity }))]) {
    assert.equal(validateVenue(input), null);
  }
  assert.equal((await request(app).post('/api/venues').set('Authorization', 'Bearer valid-token').send({})).status, 400);
  assert.equal((await request(app).put('/api/venues/1').set('Authorization', 'Bearer valid-token').send({})).status, 400);
  for (const id of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
    assert.equal((await request(app).put(`/api/venues/${id}`).set('Authorization', 'Bearer valid-token').send(values)).status, 400);
  }
  assert.equal(writes(), 0);
  assert.equal(validateVenue({ ...values, capacity: 2147483647 })?.capacity, 2147483647);
  assert.equal(validateVenue({ ...values, name: 'a'.repeat(255) })?.name.length, 255);
});

test('missing update and insert without returned row do not report success', async () => {
  const { app } = fixture('venue_staff', { list: async () => [], save: async () => null });
  assert.equal((await request(app).put('/api/venues/8').set('Authorization', 'Bearer valid-token').send(values)).status, 404);
  assert.equal((await request(app).post('/api/venues').set('Authorization', 'Bearer valid-token').send(values)).status, 503);
});

for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET')]) {
  test(`database failures fail closed: ${error.message}`, async () => {
    const { app } = fixture('venue_staff', { list: async () => { throw error; }, save: async () => { throw error; } });
    const res = await request(app).get('/api/venues').set('Authorization', 'Bearer valid-token');
    assert.equal(res.status, error instanceof AccessError ? error.status : 503);
    assert.doesNotMatch(res.text, /SECRET/);
  });
}
