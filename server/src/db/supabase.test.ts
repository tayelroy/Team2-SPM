import { beforeEach, afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { dbConfig } from './config';
import { checkSupabaseHealth, getSupabaseClient } from './supabase';

const originalConfig = { ...dbConfig };

beforeEach(() => {
  dbConfig.supabaseUrl = 'https://test-project.supabase.co';
  dbConfig.supabaseAnonKey = 'sb_publishable_test-key';
  dbConfig.supabaseServiceRoleKey = undefined;
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected outbound request in test');
  });
});

afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
});

test('missing URL is unconfigured and sends no request', async () => {
  dbConfig.supabaseUrl = undefined;
  assert.deepEqual(await checkSupabaseHealth(), { configured: false, status: 'unconfigured' });
});

test('missing API key is unconfigured and sends no request', async () => {
  dbConfig.supabaseAnonKey = undefined;
  assert.deepEqual(await checkSupabaseHealth(), { configured: false, status: 'unconfigured' });
});

test('Supabase JS client queries through HTTPS and is reused', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    assert.equal(String(input), 'https://test-project.supabase.co/rest/v1/events?select=id');
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_publishable_test-key');
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  const client = getSupabaseClient();
  assert.ok(client);
  assert.equal(client, getSupabaseClient());
  const { data, error } = await client.from('events').select('id');
  assert.equal(error, null);
  assert.deepEqual(data, []);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('health performs a bounded HTTPS request without following redirects', async () => {
  const timeoutMock = mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  const fetchMock = mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    assert.equal(String(input), 'https://test-project.supabase.co/auth/v1/health');
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_publishable_test-key');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response('{"name":"GoTrue"}', { status: 200 });
  });
  assert.equal((await checkSupabaseHealth()).status, 'connected');
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(timeoutMock.mock.calls[0].arguments, [5000]);
});

test('Supabase non-success response is unhealthy without copying its body', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('PRIVATE_ERROR_SENTINEL', { status: 503 }));
  const health = await checkSupabaseHealth();
  assert.equal(health.status, 'error');
  assert.equal(health.error, 'Supabase API returned HTTP 503');
  assert.doesNotMatch(JSON.stringify(health), /SENTINEL/);
});

test('network failures are unhealthy', async () => {
  mock.method(globalThis, 'fetch', async () => { throw new Error('Network unavailable'); });
  assert.equal((await checkSupabaseHealth()).status, 'error');
});

test('aborted health request reports an error', async () => {
  const controller = new AbortController();
  mock.method(AbortSignal, 'timeout', () => controller.signal);
  mock.method(globalThis, 'fetch', async (...[_input, init]: Parameters<typeof fetch>) => {
    controller.abort(new Error('Health request timed out'));
    init?.signal?.throwIfAborted();
    throw new Error('Expected the request to abort');
  });
  const health = await checkSupabaseHealth();
  assert.equal(health.status, 'error');
  assert.equal(health.error, 'Health request timed out');
});

test('health rejects plaintext URLs before making a request', async () => {
  dbConfig.supabaseUrl = 'http://test-project.supabase.co';
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response());
  const health = await checkSupabaseHealth();
  assert.equal(health.status, 'error');
  assert.equal(fetchMock.mock.callCount(), 0);
});

for (const route of ['/health/db', '/api/health/db']) {
  test(`${route} hides real health-helper network errors and project URL`, async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('PRIVATE_ERROR_SENTINEL'); });
    const response = await request(app).get(route);
    assert.equal(response.status, 503);
    assert.equal(response.body.database.supabase.status, 'error');
    assert.doesNotMatch(response.text, /SENTINEL|test-project|sb_publishable|postgres/);
  });
}
