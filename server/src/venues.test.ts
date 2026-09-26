import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createVenuesRouter } from './venues';
import { validateVenue, type VenueRecord } from './venues/fields';
import type { VenueStore } from './db/venues';

// Documented account roles form the oracle, independent of the production list.
const ACCOUNT_ROLES = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'
] as const;

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
  return { app, writes: () => writes };
}

for (const role of ACCOUNT_ROLES) test(`SG2-42: only venue staff can write (${role})`, async () => {
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
});

test('non-record inputs are rejected by the validator', () => {
  for (const input of [null, undefined, [], 'bad', 1, true]) assert.equal(validateVenue(input), null);
});

test('POST and PUT reject missing, blank, mistyped and out-of-range fields without writing', async () => {
  const { app, writes } = fixture();
  // The required fields come from the story, independently of the implementation's field list.
  const textFields = ['name', 'location', 'facilities', 'accessibility_features', 'operating_information'];
  const invalid = [[], {}, ...textFields.flatMap(field =>
    [undefined, '', ' \n ', null, 3].map(value => ({ ...values, [field]: value }))),
    { ...values, name: '🏛'.repeat(256) },
    ...[undefined, '', 0, -1, 1.5, 2147483648, '100', null, true].map(capacity => ({ ...values, capacity }))];
  for (const input of invalid) {
    for (const method of ['post', 'put'] as const) {
      const response = await request(app)[method](`/api/venues${method === 'put' ? '/1' : ''}`)
        .set('Authorization', 'Bearer valid-token').send(input);
      assert.equal(response.status, 400, `${method}: ${JSON.stringify(input)}`);
      assert.equal(writes(), 0);
    }
  }
});

test('POST and PUT accept exact capacity/name limits and trim every text field', async () => {
  const { app, writes } = fixture();
  for (const [method, capacity, name] of [
    ['post', 1, 'A'], ['put', 2147483647, '🏛'.repeat(255)]
  ] as const) {
    const expected = { ...values, name, capacity, venue_id: 1 };
    const input = Object.fromEntries(Object.entries(expected).map(([key, value]) =>
      [key, typeof value === 'string' ? ` ${value}\n` : value]));
    const response = await request(app)[method](`/api/venues${method === 'put' ? '/1' : ''}`)
      .set('Authorization', 'Bearer valid-token').send({ ...input, venue_id: 99, role: 'admin', unknown: 'discard' });
    assert.equal(response.status, method === 'post' ? 201 : 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body.venue, expected);
  }
  assert.equal(writes(), 2);
});

test('invalid IDs never write; an in-range missing ID returns 404, not validation failure', async () => {
  const { app, writes } = fixture();
  for (const id of ['0', '-1', '01', '1.5', '1e2', 'abc', '2147483648']) {
    assert.equal((await request(app).put(`/api/venues/${id}`).set('Authorization', 'Bearer valid-token').send(values)).status, 400);
  }
  assert.equal(writes(), 0);
  assert.equal((await request(app).put('/api/venues/2147483647').set('Authorization', 'Bearer valid-token').send(values)).status, 404);
  assert.equal(writes(), 1);
});

test('missing update and insert without returned row do not report success', async () => {
  const { app } = fixture('venue_staff', { list: async () => [], save: async () => null });
  assert.equal((await request(app).put('/api/venues/8').set('Authorization', 'Bearer valid-token').send(values)).status, 404);
  assert.equal((await request(app).post('/api/venues').set('Authorization', 'Bearer valid-token').send(values)).status, 503);
});

for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET')]) {
  test(`database failures fail closed: ${error.message}`, async () => {
    const { app } = fixture('venue_staff', { list: async () => { throw error; }, save: async () => { throw error; } });
    for (const method of ['get', 'post', 'put'] as const) {
      const res = await request(app)[method](`/api/venues${method === 'put' ? '/1' : ''}`)
        .set('Authorization', 'Bearer valid-token').send(values);
      assert.equal(res.status, error instanceof AccessError ? error.status : 503);
      assert.deepEqual(res.body, { error: error instanceof AccessError ? error.message : 'Access service unavailable' });
    }
  });
}
