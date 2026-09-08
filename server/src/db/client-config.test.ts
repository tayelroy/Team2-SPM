import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { dbConfig } from './config';

const originalConfig = { ...dbConfig };

beforeEach(() => {
  dbConfig.supabaseUrl = 'https://configuration-test.supabase.co';
  dbConfig.supabaseAnonKey = 'sb_publishable_anon-test';
  dbConfig.supabaseServiceRoleKey = 'sb_secret_admin-test';
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network request');
  });
  mock.method(console, 'error', () => {});
});

afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
  delete require.cache[require.resolve('./supabase')];
});

// Each configuration scenario needs an uninitialized singleton, as on startup.
function freshClients(): typeof import('./supabase') {
  delete require.cache[require.resolve('./supabase')];
  return require('./supabase');
}

test('neither client initializes without a project URL', () => {
  dbConfig.supabaseUrl = undefined;
  const clients = freshClients();
  assert.equal(clients.getSupabaseClient(), null);
  assert.equal(clients.getSupabaseAdminClient(), null);
});

test('neither client initializes without API credentials', () => {
  dbConfig.supabaseAnonKey = undefined;
  dbConfig.supabaseServiceRoleKey = undefined;
  const clients = freshClients();
  assert.equal(clients.getSupabaseClient(), null);
  assert.equal(clients.getSupabaseAdminClient(), null);
});

for (const url of ['http://configuration-test.supabase.co', 'invalid-url']) {
  test(`invalid configuration cannot initialize either client: ${url}`, async () => {
    dbConfig.supabaseUrl = url;
    const clients = freshClients();
    assert.equal(clients.getSupabaseClient(), null);
    assert.equal(clients.getSupabaseAdminClient(), null);
    const health = await clients.checkSupabaseHealth();
    assert.deepEqual(health, { configured: true, status: 'error', error: 'Client initialization failed' });
  });
}

test('admin access requires the service-role key', () => {
  dbConfig.supabaseServiceRoleKey = undefined;
  const clients = freshClients();
  assert.ok(clients.getSupabaseClient());
  assert.equal(clients.getSupabaseAdminClient(), null);
});

test('standard and admin clients use their own API keys and are reused separately', async () => {
  const keys: (string | null)[] = [];
  mock.method(globalThis, 'fetch', async (...[_input, init]: Parameters<typeof fetch>) => {
    keys.push(new Headers(init?.headers).get('apikey'));
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });
  const clients = freshClients();
  const standard = clients.getSupabaseClient();
  const admin = clients.getSupabaseAdminClient();
  assert.ok(standard);
  assert.ok(admin);
  assert.notEqual(standard, admin);
  assert.equal(standard, clients.getSupabaseClient());
  assert.equal(admin, clients.getSupabaseAdminClient());
  assert.equal((await standard.from('events').select('id')).error, null);
  assert.equal((await admin.from('events').select('id')).error, null);
  assert.deepEqual(keys, ['sb_publishable_anon-test', 'sb_secret_admin-test']);
});

test('server-only configuration supports the existing service-role fallback', async () => {
  dbConfig.supabaseAnonKey = undefined;
  mock.method(globalThis, 'fetch', async (...[_input, init]: Parameters<typeof fetch>) => {
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_secret_admin-test');
    return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
  });
  const clients = freshClients();
  const client = clients.getSupabaseClient();
  assert.ok(client);
  assert.equal((await client.from('events').select('id')).error, null);
  assert.equal((await clients.checkSupabaseHealth()).status, 'connected');
});

test('health handles a non-Error rejection without crashing', async () => {
  mock.method(globalThis, 'fetch', async () => { throw 'network failure'; });
  const health = await freshClients().checkSupabaseHealth();
  assert.equal(health.status, 'error');
  assert.equal(health.error, 'network failure');
});
