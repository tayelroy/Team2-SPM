import { beforeEach, afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { dbConfig } from '../db/config';
import { validateProfileInput } from './profile';

const originalConfig = { ...dbConfig };

beforeEach(() => {
  dbConfig.supabaseUrl = 'https://test-project.supabase.co';
  dbConfig.supabaseAnonKey = 'sb_publishable_test-key';
  dbConfig.supabaseServiceRoleKey = undefined;
});

afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
});

function mockProfilesResponse(rows: unknown[]) {
  return mock.method(globalThis, 'fetch', async (...[input]: Parameters<typeof fetch>) => {
    assert.match(String(input), /\/rest\/v1\/profiles(\?|$)/);
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });
}

const sampleRow = {
  id: 'u1',
  name: 'Marcus Chua',
  email: 'marcus@example.com',
  phone: '+65 9123 4567',
  communication_preferences: ['email'],
  department: 'Engineering'
};

test('GET /api/profile requires the temporary auth header', async () => {
  const response = await request(app).get('/api/profile');
  assert.equal(response.status, 401);
});

// Must run before any test that exercises a real Supabase call: getSupabaseClient()
// caches its client in a module-level variable on first use and won't re-check
// dbConfig afterwards, so this needs to be the first test to reach that far.
test('GET /api/profile returns 503 without touching the network when unconfigured', async () => {
  dbConfig.supabaseUrl = undefined;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected outbound request');
  });
  const response = await request(app).get('/api/profile').set('x-user-id', 'u1');
  assert.equal(response.status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('PUT /api/profile returns 503 without touching the network when unconfigured', async () => {
  dbConfig.supabaseUrl = undefined;
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected outbound request');
  });
  const response = await request(app)
    .put('/api/profile')
    .set('x-user-id', 'u1')
    .send({ name: 'Marcus', email: 'marcus@example.com', phone: '+65 9123 4567' });
  assert.equal(response.status, 503);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('GET /api/profile returns 503 when the database reports a query error', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ message: 'relation "profiles" does not exist', code: '42P01' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  ));
  const response = await request(app).get('/api/profile').set('x-user-id', 'u1');
  assert.equal(response.status, 503);
});

test('PUT /api/profile returns 503 when the database reports a query error', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(
    JSON.stringify({ message: 'relation "profiles" does not exist', code: '42P01' }),
    { status: 500, headers: { 'Content-Type': 'application/json' } }
  ));
  const response = await request(app)
    .put('/api/profile')
    .set('x-user-id', 'u1')
    .send({ name: 'Marcus', email: 'marcus@example.com', phone: '+65 9123 4567' });
  assert.equal(response.status, 503);
});

test('GET /api/profile returns the caller\'s profile, without department for external users', async () => {
  mockProfilesResponse([sampleRow]);
  const response = await request(app).get('/api/profile').set('x-user-id', 'u1');
  assert.equal(response.status, 200);
  assert.equal(response.body.name, 'Marcus Chua');
  assert.equal(response.body.email, 'marcus@example.com');
  assert.equal('department' in response.body, false);
});

test('GET /api/profile includes department for internal users', async () => {
  mockProfilesResponse([sampleRow]);
  const response = await request(app)
    .get('/api/profile')
    .set('x-user-id', 'u1')
    .set('x-user-internal', 'true');
  assert.equal(response.status, 200);
  assert.equal(response.body.department, 'Engineering');
});

test('GET /api/profile returns 404 when no profile row exists yet', async () => {
  mockProfilesResponse([]);
  const response = await request(app).get('/api/profile').set('x-user-id', 'missing');
  assert.equal(response.status, 404);
});

test('PUT /api/profile rejects invalid contact details with an explanation', async () => {
  const response = await request(app)
    .put('/api/profile')
    .set('x-user-id', 'u1')
    .send({ name: '', email: 'not-an-email', phone: '123' });
  assert.equal(response.status, 400);
  assert.ok(response.body.details.length >= 3);
  assert.ok(response.body.details.some((d: string) => /email/i.test(d)));
});

test('PUT /api/profile updates name, contact details and communication preferences', async () => {
  mockProfilesResponse([
    { ...sampleRow, name: 'Marcus C.', communication_preferences: ['email', 'sms'] }
  ]);
  const response = await request(app)
    .put('/api/profile')
    .set('x-user-id', 'u1')
    .send({
      name: 'Marcus C.',
      email: 'marcus@example.com',
      phone: '+65 9123 4567',
      communication_preferences: ['email', 'sms']
    });
  assert.equal(response.status, 200);
  assert.equal(response.body.name, 'Marcus C.');
  assert.deepEqual(response.body.communication_preferences, ['email', 'sms']);
});

test('PUT /api/profile returns 404 when updating a profile that does not exist', async () => {
  mockProfilesResponse([]);
  const response = await request(app)
    .put('/api/profile')
    .set('x-user-id', 'missing')
    .send({ name: 'Ghost', email: 'ghost@example.com', phone: '+65 9123 4567' });
  assert.equal(response.status, 404);
});

test('validateProfileInput rejects an unknown communication preference', () => {
  const result = validateProfileInput({
    name: 'A',
    email: 'a@b.com',
    phone: '+65 9123 4567',
    communication_preferences: ['carrier-pigeon']
  });
  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.some((e) => /communication preferences/i.test(e)));
  }
});

test('validateProfileInput accepts a well-formed payload with no preferences given', () => {
  const result = validateProfileInput({ name: 'A', email: 'a@b.com', phone: '+65 9123 4567' });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.value.communication_preferences, []);
  }
});
