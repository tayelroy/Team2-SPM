import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createVenueOperationsRouter } from './venues/operations';
import { DEFAULT_OPERATIONS, validateVenueOperations, type VenueOperationRecord } from './venues/operationFields';
import type { VenueOperationStore } from './db/venueOperations';

const ACCOUNT_ROLES = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'
] as const;

const saved: VenueOperationRecord = {
  setup_minutes: 30, turnaround_minutes: 45,
  emergency_access: 'Two exits to the car park', known_restrictions: 'No open flames',
  updated_at: '2026-10-05T02:00:00.000Z'
};
const body = { setup_minutes: 30, turnaround_minutes: 45, emergency_access: 'Two exits to the car park', known_restrictions: 'No open flames' };

function fixture(role: Role = 'venue_staff', override?: VenueOperationStore) {
  const rows = new Map<number, VenueOperationRecord>([[1, saved]]);
  const writes: unknown[] = [];
  const store: VenueOperationStore = override ?? {
    get: async venueId => (venueId === 1 || venueId === 2 ? rows.get(venueId) ?? { ...DEFAULT_OPERATIONS } : null),
    save: async (venueId, values) => {
      writes.push({ venueId, values });
      if (venueId !== 1) return null;
      const record = { ...values, updated_at: '2026-10-05T03:00:00.000Z' };
      rows.set(venueId, record);
      return record;
    }
  };
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) });
  const app = express();
  app.use(express.json());
  app.use('/api/venues', createVenueOperationsRouter(access, token => {
    assert.equal(token, 'valid-token');
    return store;
  }));
  return { app, writes };
}

const put = (app: express.Express, payload: unknown, venue = 1) =>
  request(app).put(`/api/venues/${venue}/operations`).set('Authorization', 'Bearer valid-token').send(payload as object);
const get = (app: express.Express, venue: number | string = 1) =>
  request(app).get(`/api/venues/${venue}/operations`).set('Authorization', 'Bearer valid-token');

test('[NORMAL] [SG2-77:AC1] [SG2-77:AC2] [SG2-77:AC5] Venue Staff save setup, turnaround and safety details and read them back', async () => {
  const { app, writes } = fixture();
  const response = await put(app, { ...body, turnaround_minutes: 60 });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.operations, { ...body, turnaround_minutes: 60, updated_at: '2026-10-05T03:00:00.000Z' });
  assert.deepEqual(writes, [{ venueId: 1, values: { ...body, turnaround_minutes: 60 } }]);
  const read = await get(app);
  assert.equal(read.status, 200);
  assert.equal(read.body.operations.turnaround_minutes, 60);
});

test('[BOUNDARY] [SG2-77:AC3] a venue with nothing saved reads as 0 minutes and no safety details', async () => {
  const { app } = fixture();
  const response = await get(app, 2);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.operations, {
    setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: null, updated_at: null
  });
});

for (const role of ACCOUNT_ROLES) {
  const reads = ['venue_staff', 'event_coordinator', 'technical_support_staff'].includes(role);
  test(`${role === 'venue_staff' ? '[NORMAL]' : '[FAILURE]'} [SG2-77:AC6] only Venue Staff change venue operations (${role})`, async () => {
    const { app, writes } = fixture(role);
    const write = await put(app, body);
    assert.equal(write.status, role === 'venue_staff' ? 200 : 403);
    assert.equal(writes.length, role === 'venue_staff' ? 1 : 0);
    assert.equal((await get(app)).status, reads ? 200 : 403);
  });
}

test('[FAILURE] [SG2-25:AC3] [SG2-77:AC6] the production app protects both operations routes without credentials', async () => {
  for (const method of ['get', 'put'] as const) {
    const response = await request(createApp())[method]('/api/venues/1/operations').send(body);
    assert.equal(response.status, 401);
  }
});

test('[BOUNDARY] [SG2-77:AC1] [SG2-77:AC4] 0 and 1440 minutes are accepted; -1 and 1441 are refused without a write', async () => {
  const { app, writes } = fixture();
  for (const minutes of [0, 1440]) {
    assert.equal((await put(app, { ...body, setup_minutes: minutes, turnaround_minutes: minutes })).status, 200);
  }
  for (const minutes of [-1, 1441]) {
    const setup = await put(app, { ...body, setup_minutes: minutes });
    assert.equal(setup.status, 400);
    assert.match(setup.body.error, /whole minutes from 0 to 1440/);
    assert.equal((await put(app, { ...body, turnaround_minutes: minutes })).status, 400);
  }
  assert.equal(writes.length, 2);
});

test('[FAILURE] [SG2-77:AC4] non-whole and non-numeric minutes are refused', () => {
  for (const value of [1.5, '30', null, undefined, Number.NaN, Infinity, true]) {
    assert.equal(validateVenueOperations({ ...body, setup_minutes: value }), null, `setup ${String(value)}`);
    assert.equal(validateVenueOperations({ ...body, turnaround_minutes: value }), null, `turnaround ${String(value)}`);
  }
  for (const input of [null, undefined, 'x', 1, [], [body]]) assert.equal(validateVenueOperations(input), null);
});

test('[BOUNDARY] [SG2-77:AC5] safety notes are trimmed, blank notes mean "not recorded", and 2000 characters is the limit', () => {
  assert.deepEqual(validateVenueOperations({ setup_minutes: 0, turnaround_minutes: 0, emergency_access: '  Side exit  ', known_restrictions: '   ' }), {
    setup_minutes: 0, turnaround_minutes: 0, emergency_access: 'Side exit', known_restrictions: null
  });
  assert.deepEqual(validateVenueOperations({ setup_minutes: 5, turnaround_minutes: 5 }), {
    setup_minutes: 5, turnaround_minutes: 5, emergency_access: null, known_restrictions: null
  });
  const atLimit = '🚪'.repeat(2000);
  assert.equal(validateVenueOperations({ ...body, emergency_access: atLimit })?.emergency_access, atLimit);
  assert.equal(validateVenueOperations({ ...body, emergency_access: '🚪'.repeat(2001) }), null);
  assert.equal(validateVenueOperations({ ...body, known_restrictions: 42 }), null);
});

test('[FAILURE] [SG2-77:AC1] an unknown venue returns 404 for read and save', async () => {
  const { app } = fixture();
  assert.equal((await get(app, 99)).status, 404);
  const saveMissing = await put(app, body, 99);
  assert.equal(saveMissing.status, 404);
  assert.deepEqual(saveMissing.body, { error: 'Venue not found.' });
});

test('[BOUNDARY] [SG2-77:AC1] malformed venue IDs are refused before the store is used', async () => {
  let used = false;
  const { app } = fixture('venue_staff', {
    get: async () => { used = true; return DEFAULT_OPERATIONS; },
    save: async () => { used = true; return null; }
  });
  for (const id of ['0', '-1', 'abc', '2147483648', '01']) {
    assert.equal((await get(app, id)).status, 400);
  }
  assert.equal(used, false);
});

test('[FAILURE] [SG2-77:AC6] storage failures keep their status and never leak details', async () => {
  for (const [thrown, status] of [[new AccessError(403), 403], [new Error('db password in message'), 503]] as const) {
    const { app } = fixture('venue_staff', {
      get: async () => { throw thrown; },
      save: async () => { throw thrown; }
    });
    for (const response of [await get(app), await put(app, body)]) {
      assert.equal(response.status, status);
      assert.doesNotMatch(JSON.stringify(response.body), /password/);
    }
  }
});
