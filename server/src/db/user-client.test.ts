import { beforeEach, afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createUserScopedClient } from './user-client';
import { dbConfig } from './config';

const originalConfig = { ...dbConfig };

beforeEach(() => {
  dbConfig.supabaseUrl = 'https://scoped-test.supabase.co';
  dbConfig.supabaseAnonKey = 'sb_publishable_scoped';
  dbConfig.supabaseServiceRoleKey = undefined;
});

afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
});

test('returns null when the project URL is missing', () => {
  dbConfig.supabaseUrl = undefined;
  assert.equal(createUserScopedClient('token'), null);
});

test('returns null when the anon key is missing', () => {
  dbConfig.supabaseAnonKey = undefined;
  assert.equal(createUserScopedClient('token'), null);
});

test('returns null for a plaintext project URL', () => {
  dbConfig.supabaseUrl = 'http://scoped-test.supabase.co';
  assert.equal(createUserScopedClient('token'), null);
});

test('returns null for a malformed project URL', () => {
  dbConfig.supabaseUrl = 'not-a-url';
  assert.equal(createUserScopedClient('token'), null);
});

test('acts as the caller with a bounded, redirect-refusing request', async () => {
  const timeoutMock = mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  const fetchMock = mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    assert.equal(String(input), 'https://scoped-test.supabase.co/rest/v1/venue_bookings?select=starts_at');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer caller-token');
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_publishable_scoped');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  const client = createUserScopedClient('caller-token');
  assert.ok(client);
  const { error } = await client.from('venue_bookings').select('starts_at');
  assert.equal(error, null);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(timeoutMock.mock.calls[0].arguments, [5000]);
});
