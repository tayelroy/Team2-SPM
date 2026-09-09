import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createApp } from './app';
import { AccessError, createAuthorization, Principal, ROLES } from './auth';
import { dbConfig } from './db/config';

const userId = '10000000-0000-4000-8000-000000000001';
const originalConfig = { ...dbConfig };

beforeEach(() => {
  dbConfig.supabaseUrl = 'https://auth-test.supabase.co';
  dbConfig.supabaseAnonKey = 'sb_publishable_test';
  dbConfig.supabaseServiceRoleKey = 'ADMIN_SECRET_SENTINEL';
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
});

afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
});

function guardedApp(access: ReturnType<typeof createAuthorization>) {
  let calls = 0;
  const app = createApp(undefined, undefined, access);
  const router = access.protectedRouter();
  router.post('/edit', access.requirePermission('fixture.edit'), (req, res) => {
    calls++;
    res.json({ userId: access.getPrincipal(req)!.userId });
  });
  router.post('/unknown', access.requirePermission('constructor'), (_req, res) => {
    calls++;
    res.sendStatus(204);
  });
  app.use('/fixture', router);
  return { app, calls: () => calls };
}

function fixture(principal: Principal = { userId, role: 'event_organiser' }) {
  return guardedApp(createAuthorization({
    resolvePrincipal: async () => principal,
    permissions: { 'fixture.edit': ['event_organiser'] }
  }));
}

test('registration stays public alongside authenticated identity routes', async () => {
  let resolutions = 0;
  const access = createAuthorization({ resolvePrincipal: async () => {
    resolutions++;
    return { userId, role: 'attendee' };
  } });
  const app = createApp(undefined, (_req, res) => { res.sendStatus(201); }, access);

  assert.equal((await request(app).post('/api/auth/register')).status, 201);
  assert.equal(resolutions, 0);
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  const identity = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token');
  assert.equal(identity.status, 200);
  assert.equal(identity.body.userId, userId);
  assert.equal(resolutions, 1);
});

for (const header of [undefined, 'Basic token', 'Bearer', 'Bearer one two', 'Bearer a,b']) {
  test(`SG2-25: refuses missing/malformed credentials (${header}) before side effects`, async () => {
    const { app, calls } = fixture();
    let req = request(app).post('/fixture/edit');
    if (header) req = req.set('Authorization', header);
    const res = await req;
    assert.equal(res.status, 401);
    assert.equal(res.headers['www-authenticate'], 'Bearer');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(calls(), 0);
  });
}

test('duplicate authorization headers are refused', async () => {
  const { app, calls } = fixture();
  const res = await request(app).post('/fixture/edit').set('Authorization', ['Bearer one', 'Bearer two'] as any);
  assert.equal(res.status, 401);
  assert.equal(calls(), 0);
});

for (const role of ROLES) {
  test(`SG2-25: direct HTTP action obeys the policy for ${role}`, async () => {
    const { app, calls } = fixture({ userId, role });
    const res = await request(app).post('/fixture/edit').set('Authorization', 'bearer verified-token')
      .set('X-Role', 'event_organiser').set('X-User-Id', 'forged')
      .query({ role: 'event_organiser' }).send({ userId: 'forged', role: 'event_organiser' });
    assert.equal(res.status, role === 'event_organiser' ? 200 : 403);
    assert.equal(calls(), role === 'event_organiser' ? 1 : 0);
    if (role === 'event_organiser') assert.equal(res.body.userId, userId);
  });
}

test('unmapped/prototype property action is denied even to a permitted role', async () => {
  const { app, calls } = fixture();
  assert.equal((await request(app).post('/fixture/unknown').set('Authorization', 'Bearer token')).status, 403);
  assert.equal(calls(), 0);
});

test('permission guard fails closed when a developer omits authentication', async () => {
  const access = createAuthorization();
  const app = express();
  app.post('/edit', access.requirePermission('fixture.edit'), (_req, res) => res.sendStatus(204));
  const res = await request(app).post('/edit').set('Authorization', 'Bearer token');
  assert.equal(res.status, 401);
});

for (const principal of [{ userId, role: 'admin' }, { userId: '', role: 'attendee' }, { userId }]) {
  test(`invalid server principal fails closed: ${JSON.stringify(principal)}`, async () => {
    const { app, calls } = fixture(principal as Principal);
    assert.equal((await request(app).post('/fixture/edit').set('Authorization', 'Bearer token')).status, 403);
    assert.equal(calls(), 0);
  });
}

for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET_SENTINEL'), 'SECRET_SENTINEL']) {
  test(`resolver failure returns generic JSON: ${String(error)}`, async () => {
    const access = createAuthorization({ resolvePrincipal: async () => { throw error; } });
    const res = await request(createApp(undefined, undefined, access)).get('/api/auth/me').set('Authorization', 'Bearer token');
    assert.equal(res.status, error instanceof AccessError ? error.status : 503);
    assert.doesNotMatch(res.text, /SENTINEL|stack/);
  });
}

test('pages receive exactly the same permissions as backend guards', async () => {
  const { app } = fixture();
  const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { userId, role: 'event_organiser', permissions: ['fixture.edit'] });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('server policy is snapshotted, not mutable through its input arrays', async () => {
  const roles: Principal['role'][] = ['attendee'];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId, role: 'attendee' }), permissions: { read: roles } });
  roles.pop();
  const res = await request(createApp(undefined, undefined, access)).get('/api/auth/me').set('Authorization', 'Bearer token');
  assert.deepEqual(res.body.permissions, ['read']);
});

function provider(options: { role?: unknown; authStatus?: number; roleStatus?: number; user?: object; missingRole?: boolean } = {}) {
  return mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://auth-test.supabase.co');
    assert.equal(new Headers(init?.headers).get('apikey'), 'sb_publishable_test');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    if (url.pathname === '/auth/v1/user') {
      const status = options.authStatus ?? 200;
      return Response.json(status === 200 ? options.user ?? {
        id: userId, aud: 'authenticated', user_metadata: { role: 'technical_support_staff' }
      } : { code: 'bad_jwt', msg: 'PROVIDER_SECRET_SENTINEL' }, { status });
    }
    assert.equal(url.pathname, '/rest/v1/account_roles');
    assert.equal(url.searchParams.get('select'), 'role');
    assert.equal(url.searchParams.get('user_id'), `eq.${userId}`);
    const status = options.roleStatus ?? 200;
    return Response.json(status === 200 ? options.missingRole ? [] : [{ role: options.role ?? 'attendee' }]
      : { code: 'error', message: 'DATABASE_SECRET_SENTINEL' }, { status });
  });
}

test('production adapter verifies Auth then reads the database role, ignoring metadata', async () => {
  const fetchMock = provider();
  const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { userId, role: 'attendee', permissions: [] });
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.doesNotMatch(res.text, /test-token|SENTINEL|metadata/);
});

for (const status of [400, 401, 403, 500]) {
  test(`Auth refuses invalid/expired credentials or fails closed on outage (${status})`, async () => {
    const fetchMock = provider({ authStatus: status });
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
    assert.equal(res.status, status === 500 ? 503 : 401);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.doesNotMatch(res.text, /SENTINEL/);
  });
}

for (const user of [{}, { id: userId, is_anonymous: true }]) {
  test(`Auth response without a registered identity is denied: ${JSON.stringify(user)}`, async () => {
    const fetchMock = provider({ user });
    assert.equal((await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token')).status, 401);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

for (const options of [{ missingRole: true }, { role: 'admin' }, { role: 123 }]) {
  test(`database assignment must exist and be recognised: ${JSON.stringify(options)}`, async () => {
    provider(options);
    assert.equal((await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token')).status, 403);
  });
}

for (const status of [401, 403, 500]) {
  test(`database lookup fails closed (${status})`, async () => {
    provider({ roleStatus: status });
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
    assert.equal(res.status, status === 401 ? 401 : 503);
    assert.doesNotMatch(res.text, /SENTINEL/);
  });
}

test('removing a role grant blocks the next action with the same access token', async () => {
  const options = { role: 'event_organiser' };
  provider(options);
  const { app, calls } = guardedApp(createAuthorization({
    permissions: { 'fixture.edit': ['event_organiser'] }
  }));
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer test-token')).body.role, 'event_organiser');
  assert.equal((await request(app).post('/fixture/edit').set('Authorization', 'Bearer test-token')).status, 200);
  assert.equal(calls(), 1);
  options.role = 'attendee';
  const summary = await request(app).get('/api/auth/me').set('Authorization', 'Bearer test-token');
  assert.equal(summary.body.role, 'attendee');
  assert.deepEqual(summary.body.permissions, []);
  assert.equal((await request(app).post('/fixture/edit').set('Authorization', 'Bearer test-token')).status, 403);
  assert.equal(calls(), 1);
});

for (const role of ROLES) {
  test(`default policy grants no action to ${role}`, async () => {
    const { app, calls } = guardedApp(createAuthorization({
      resolvePrincipal: async () => ({ userId, role })
    }));
    assert.equal((await request(app).post('/fixture/edit').set('Authorization', 'Bearer token')).status, 403);
    assert.equal(calls(), 0);
  });
}

for (const endpoint of ['/auth/v1/user', '/rest/v1/account_roles']) {
  test(`${endpoint} timeout returns 503 without running the action`, async () => {
    const controller = new AbortController();
    let timedOutRequests = 0;
    mock.method(console, 'error', () => {});
    const timeout = mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
      assert.equal(milliseconds, 5000);
      return controller.signal;
    });
    const fetchMock = mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
      const path = new URL(String(input)).pathname;
      if (path === endpoint) {
        timedOutRequests++;
        controller.abort(new DOMException('Timed out', 'TimeoutError'));
        init?.signal?.throwIfAborted();
        assert.fail('Request did not carry the timeout signal');
      }
      assert.equal(path, '/auth/v1/user');
      return Response.json({ id: userId, aud: 'authenticated' });
    });
    const { app, calls } = guardedApp(createAuthorization({
      permissions: { 'fixture.edit': ['event_organiser'] }
    }));
    const res = await request(app).post('/fixture/edit').set('Authorization', 'Bearer test-token');
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'Access service unavailable' });
    assert.equal(calls(), 0);
    assert.ok(timedOutRequests >= 1);
    assert.equal(fetchMock.mock.callCount(), timedOutRequests + (endpoint === '/auth/v1/user' ? 0 : 1));
    assert.equal(timeout.mock.callCount(), fetchMock.mock.callCount());
  });
}

for (const config of [
  { supabaseUrl: undefined }, { supabaseAnonKey: undefined },
  { supabaseUrl: 'http://auth-test.supabase.co' }, { supabaseUrl: 'not-a-url' }
]) {
  test(`configuration fails closed without a privileged fallback: ${JSON.stringify(config)}`, async () => {
    Object.assign(dbConfig, config);
    const fetchMock = provider();
    assert.equal((await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token')).status, 503);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

test('network failure is a generic 503', async () => {
  mock.method(console, 'error', () => {});
  const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'Access service unavailable' });
});

test('concurrent requests use separate user tokens and database identities', async () => {
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const token = new Headers(init?.headers).get('authorization')!;
    const id = token === 'Bearer first' ? userId : '20000000-0000-4000-8000-000000000002';
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      await new Promise(resolve => setTimeout(resolve, token === 'Bearer first' ? 10 : 1));
      return Response.json({ id, aud: 'authenticated' });
    }
    assert.equal(url.searchParams.get('user_id'), `eq.${id}`);
    return Response.json([{ role: token === 'Bearer first' ? 'event_organiser' : 'attendee' }]);
  });
  const app = createApp();
  const [first, second] = await Promise.all(['first', 'second'].map(token =>
    request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)));
  assert.equal(first.body.userId, userId);
  assert.equal(first.body.role, 'event_organiser');
  assert.equal(second.body.userId, '20000000-0000-4000-8000-000000000002');
  assert.equal(second.body.role, 'attendee');
});
