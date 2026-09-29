import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createVenueBlocksRouter } from './venues/blocks';
import { validateVenueBlock } from './venues/blockFields';
import type { CreateBlockResult, VenueBlockStore } from './db/venueBlocks';
import type { VenueBlockRecord, VenueBlockValues } from './venues/blockFields';

const ACCOUNT_ROLES = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'
] as const;

const NOW = Date.parse('2026-09-26T00:00:00.000Z');
const period = { starts_at: '2026-10-01T09:00:00.000Z', ends_at: '2026-10-01T17:00:00.000Z', reason: 'Carpet replacement' };
const confirmed = { booking_id: 7, event_id: 3, starts_at: '2026-10-02T10:00:00.000Z', ends_at: '2026-10-02T12:00:00.000Z' };

function fixture(role: Role = 'venue_staff', override?: VenueBlockStore) {
  let blocks: (VenueBlockRecord & { venue_id: number })[] = [];
  let nextId = 1;
  const calls: string[] = [];
  const listed: string[] = [];
  const store: VenueBlockStore = override ?? {
    list: async (venueId, now) => {
      calls.push('list');
      listed.push(now);
      return blocks.filter(block => block.venue_id === venueId).map(({ venue_id: _, ...block }) => block);
    },
    create: async (venueId: number, values: VenueBlockValues): Promise<CreateBlockResult> => {
      calls.push('create');
      if (venueId !== 1) return { outcome: 'missing' };
      if (values.starts_at < confirmed.ends_at && values.ends_at > confirmed.starts_at) return { outcome: 'conflict', booking: confirmed };
      const block = { unavailability_id: nextId++, ...values };
      blocks.push({ ...block, venue_id: venueId });
      return { outcome: 'created', block };
    },
    remove: async (venueId, blockId) => {
      calls.push('remove');
      const before = blocks.length;
      blocks = blocks.filter(block => !(block.venue_id === venueId && block.unavailability_id === blockId));
      return blocks.length < before;
    }
  };
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) });
  const app = express();
  app.use(express.json());
  app.use('/api/venues', createVenueBlocksRouter(access, token => {
    assert.equal(token, 'valid-token');
    return store;
  }, () => NOW));
  return { app, calls, listed };
}

const auth = { Authorization: 'Bearer valid-token' };

for (const role of ACCOUNT_ROLES) test(`SG2-45: only venue staff can list, create or remove blocks (${role})`, async () => {
  const { app, calls } = fixture(role);
  const allowed = role === 'venue_staff';
  assert.equal((await request(app).get('/api/venues/1/blocks').set(auth)).status, allowed ? 200 : 403);
  assert.equal((await request(app).post('/api/venues/1/blocks').set(auth).send(period)).status, allowed ? 201 : 403);
  assert.equal((await request(app).delete('/api/venues/1/blocks/1').set(auth)).status, allowed ? 204 : 403);
  assert.deepEqual(calls, allowed ? ['list', 'create', 'remove'] : []);
});

test('the production app protects every block route without credentials', async () => {
  const app = createApp();
  assert.equal((await request(app).get('/api/venues/1/blocks')).status, 401);
  assert.equal((await request(app).post('/api/venues/1/blocks').send(period)).status, 401);
  assert.equal((await request(app).delete('/api/venues/1/blocks/1')).status, 401);
});

test('AC1: blocking a free period records it with its reason and lists it as upcoming', async () => {
  const { app, listed } = fixture();
  const created = await request(app).post('/api/venues/1/blocks').set(auth).send(period);
  assert.equal(created.status, 201);
  assert.equal(created.headers['cache-control'], 'no-store');
  assert.deepEqual(created.body, { block: { unavailability_id: 1, ...period } });
  const list = await request(app).get('/api/venues/1/blocks').set(auth);
  assert.deepEqual(list.body, { blocks: [{ unavailability_id: 1, ...period }] });
  assert.deepEqual(listed, [new Date(NOW).toISOString()]);
});

test('AC2: a period holding a confirmed booking is refused and the booking is identified', async () => {
  const { app } = fixture();
  const response = await request(app).post('/api/venues/1/blocks').set(auth)
    .send({ ...period, starts_at: '2026-10-02T11:00:00Z', ends_at: '2026-10-02T13:00:00Z' });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, { error: 'This period already holds a confirmed booking.', booking: confirmed });
  assert.deepEqual((await request(app).get('/api/venues/1/blocks').set(auth)).body, { blocks: [] });
});

test('AC3: removing a block frees the period; removing it again is 404', async () => {
  const { app } = fixture();
  await request(app).post('/api/venues/1/blocks').set(auth).send(period);
  assert.equal((await request(app).delete('/api/venues/1/blocks/1').set(auth)).status, 204);
  assert.deepEqual((await request(app).get('/api/venues/1/blocks').set(auth)).body, { blocks: [] });
  const again = await request(app).delete('/api/venues/1/blocks/1').set(auth);
  assert.equal(again.status, 404);
  assert.deepEqual(again.body, { error: 'Block not found.' });
});

test('a block for a missing venue returns 404', async () => {
  const { app } = fixture();
  const response = await request(app).post('/api/venues/999/blocks').set(auth).send(period);
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: 'Venue not found.' });
});

test('invalid venue and block IDs are rejected before reaching the store', async () => {
  const { app, calls } = fixture();
  for (const id of ['0', '-1', '01', '1.5', 'abc', '2147483648']) {
    const list = await request(app).get(`/api/venues/${id}/blocks`).set(auth);
    assert.equal(list.status, 400);
    assert.deepEqual(list.body, { error: 'Invalid venue ID.' });
    assert.equal((await request(app).post(`/api/venues/${id}/blocks`).set(auth).send(period)).status, 400);
    assert.equal((await request(app).delete(`/api/venues/${id}/blocks/1`).set(auth)).status, 400);
  }
  for (const id of ['0', '01', 'abc', '9007199254740992']) {
    const response = await request(app).delete(`/api/venues/1/blocks/${id}`).set(auth);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Invalid block ID.' });
  }
  assert.deepEqual(calls, []);
});

test('POST rejects invalid block bodies without writing', async () => {
  const { app, calls } = fixture();
  for (const body of [{}, { ...period, reason: ' ' }, { ...period, ends_at: period.starts_at }, { ...period, ends_at: '2026-09-25T00:00:00Z', starts_at: '2026-09-24T00:00:00Z' }]) {
    const response = await request(app).post('/api/venues/1/blocks').set(auth).send(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(response.body.error, /reason within 500 characters/);
  }
  assert.deepEqual(calls, []);
});

test('validateVenueBlock normalises a valid block and rejects malformed input', () => {
  for (const input of [null, undefined, 'bad', 1, [], true]) assert.equal(validateVenueBlock(input, NOW), null);
  for (const [key, value] of [['starts_at', ''], ['starts_at', 'not a date'], ['starts_at', 5], ['ends_at', undefined], ['reason', 5], ['reason', undefined], ['reason', '   ']] as const) {
    assert.equal(validateVenueBlock({ ...period, [key]: value }, NOW), null, `${key}=${String(value)}`);
  }
  assert.equal(validateVenueBlock({ ...period, starts_at: period.ends_at, ends_at: period.starts_at }, NOW), null, 'end before start');
  assert.equal(validateVenueBlock({ ...period, ends_at: period.starts_at }, NOW), null, 'empty period');
  assert.equal(validateVenueBlock({ ...period, starts_at: '2026-09-20T00:00:00Z', ends_at: '2026-09-26T00:00:00Z' }, NOW), null, 'already ended');
  assert.equal(validateVenueBlock({ ...period, reason: '🏛'.repeat(501) }, NOW), null, 'reason too long');
  assert.deepEqual(validateVenueBlock({ ...period, reason: '🏛'.repeat(500) }, NOW), { ...period, reason: '🏛'.repeat(500) });
  assert.deepEqual(
    validateVenueBlock({ starts_at: '2026-09-25T09:00:00+08:00', ends_at: '2026-10-01T17:00:00+08:00', reason: ' Deep clean ' }, NOW),
    { starts_at: '2026-09-25T01:00:00.000Z', ends_at: '2026-10-01T09:00:00.000Z', reason: 'Deep clean' },
    'a block already under way is allowed and times are normalised to UTC'
  );
  assert.ok(validateVenueBlock({ ...period, ends_at: '2099-01-01T00:00:00Z' }), 'default clock accepts a future period');
});

for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET')]) {
  test(`database failures fail closed: ${error.message}`, async () => {
    const failing = async () => { throw error; };
    const { app } = fixture('venue_staff', { list: failing, create: failing, remove: failing });
    const expected = error instanceof AccessError ? error.status : 503;
    const body = { error: error instanceof AccessError ? error.message : 'Access service unavailable' };
    for (const response of [
      await request(app).get('/api/venues/1/blocks').set(auth),
      await request(app).post('/api/venues/1/blocks').set(auth).send(period),
      await request(app).delete('/api/venues/1/blocks/1').set(auth)
    ]) {
      assert.equal(response.status, expected);
      assert.deepEqual(response.body, body);
    }
  });
}
