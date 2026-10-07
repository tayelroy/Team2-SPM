import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AuthClient, AuthError } from '@supabase/supabase-js';
import { createApp } from './app';
import { AccessError, createAuthorization, Principal, ROLES as SUPPORTED_ROLES } from './auth';
import { INTERNAL_ROLES, isInternalRole, isRole, PERMISSIONS, permissionsFor } from './auth/policy';
import { dbConfig } from './db/config';

// Documented account roles form the oracle, independent of the production list.
const ACCOUNT_ROLES = [
  'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee',
  'event_coordinator_lead', 'safety_officer'
] as const;

test('[NORMAL] [SG2-24:AC1] [SG2-86:AC1] the public role catalogue contains the seven documented account roles', () => {
  assert.deepEqual(SUPPORTED_ROLES, ACCOUNT_ROLES);
});

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
  const app = createApp(undefined, access);
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

test('[NORMAL] [SG2-23:AC1] [SG2-25:AC3] login stays public alongside authenticated identity routes', async () => {
  let resolutions = 0;
  const access = createAuthorization({ resolvePrincipal: async () => {
    resolutions++;
    return { userId, role: 'attendee' };
  } });
  const app = createApp(undefined, access, undefined, (_req, res) => { res.sendStatus(201); });

  assert.equal((await request(app).post('/api/auth/login')).status, 201);
  assert.equal(resolutions, 0);
  assert.equal((await request(app).get('/api/auth/me')).status, 401);
  const identity = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token');
  assert.equal(identity.status, 200);
  assert.equal(identity.body.userId, userId);
  assert.equal(resolutions, 1);
});

for (const header of [undefined, 'Basic token', 'Bearer', 'Bearer one two', 'Bearer a,b']) {
  test(`[FAILURE] [SG2-25:AC3] SG2-25: refuses missing/malformed credentials (${header}) before side effects`, async () => {
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

test('[FAILURE] [SG2-25:AC3] duplicate authorization headers are refused', async () => {
  const { app, calls } = fixture();
  const res = await request(app).post('/fixture/edit').set('Authorization', ['Bearer one', 'Bearer two'] as any);
  assert.equal(res.status, 401);
  assert.equal(calls(), 0);
});

for (const role of ACCOUNT_ROLES) {
  test(`${role === 'event_organiser' ? '[NORMAL]' : '[FAILURE]'} [SG2-25:AC1] [SG2-25:AC2] SG2-25: direct HTTP action obeys the policy for ${role}`, async () => {
    const { app, calls } = fixture({ userId, role });
    const res = await request(app).post('/fixture/edit').set('Authorization', 'bearer verified-token')
      .set('X-Role', 'event_organiser').set('X-User-Id', 'forged')
      .query({ role: 'event_organiser' }).send({ userId: 'forged', role: 'event_organiser' });
    assert.equal(res.status, role === 'event_organiser' ? 200 : 403);
    assert.equal(calls(), role === 'event_organiser' ? 1 : 0);
    if (role === 'event_organiser') assert.equal(res.body.userId, userId);
  });
}

test('[FAILURE] [SG2-25:AC1] unmapped/prototype property action is denied even to a permitted role', async () => {
  const { app, calls } = fixture();
  assert.equal((await request(app).post('/fixture/unknown').set('Authorization', 'Bearer token')).status, 403);
  assert.equal(calls(), 0);
});

test('[FAILURE] [SG2-25:AC3] permission guard fails closed when a developer omits authentication', async () => {
  const access = createAuthorization();
  const app = express();
  app.post('/edit', access.requirePermission('fixture.edit'), (_req, res) => res.sendStatus(204));
  const res = await request(app).post('/edit').set('Authorization', 'Bearer token');
  assert.equal(res.status, 401);
});

for (const principal of [{ userId, role: 'admin' }, { userId: '', role: 'attendee' }, { userId }]) {
  test(`${principal.userId === '' ? '[BOUNDARY] [FAILURE]' : '[FAILURE]'} [SG2-24:AC1] [SG2-25:AC1] invalid server principal fails closed: ${JSON.stringify(principal)}`, async () => {
    const { app, calls } = fixture(principal as Principal);
    assert.equal((await request(app).post('/fixture/edit').set('Authorization', 'Bearer token')).status, 403);
    assert.equal(calls(), 0);
  });
}

for (const error of [new AccessError(401), new AccessError(403), new Error('SECRET_SENTINEL'), 'SECRET_SENTINEL']) {
  test(`[FAILURE] [SG2-25:AC2] resolver failure returns generic JSON: ${String(error)}`, async () => {
    const access = createAuthorization({ resolvePrincipal: async () => { throw error; } });
    const res = await request(createApp(undefined, access)).get('/api/auth/me').set('Authorization', 'Bearer token');
    assert.equal(res.status, error instanceof AccessError ? error.status : 503);
    assert.doesNotMatch(res.text, /SENTINEL|stack/);
  });
}

test('[NORMAL] [SG2-24:AC3] [SG2-25:AC2] pages receive exactly the same permissions as backend guards', async () => {
  const { app } = fixture();
  const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { userId, role: 'event_organiser', permissions: ['fixture.edit'] });
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('[CONFLICT] [SG2-25:AC2] server policy is snapshotted, not mutable through its input arrays', async () => {
  const roles: Principal['role'][] = ['attendee'];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId, role: 'attendee' }), permissions: { read: roles } });
  roles.pop();
  const res = await request(createApp(undefined, access)).get('/api/auth/me').set('Authorization', 'Bearer token');
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

test('[NORMAL] [SG2-24:AC1] [SG2-25:AC2] production adapter verifies Auth then reads the database role, ignoring metadata', async () => {
  const fetchMock = provider();
  const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
  assert.equal(res.status, 200);
  // SG2-27: every role, including attendee, holds the profile grants.
  assert.deepEqual(res.body, { userId, role: 'attendee', permissions: ['profile.read', 'profile.update'] });
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.doesNotMatch(res.text, /test-token|SENTINEL|metadata/);
});

test('[CONFLICT] [SG2-23:AC3] logout uses the SDK current-session scope; subsequent protected requests reject a revoked session', async () => {
  // Only the external Auth/role service is simulated. Exercise the production
  // logout route, SDK request, authorization adapter and venue write guard.
  const active = new Set(['current-token', 'other-device-token']);
  const revocations: string[] = [];
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://auth-test.supabase.co');
    const headers = new Headers(init?.headers);
    const token = headers.get('authorization')!.replace('Bearer ', '');
    if (url.pathname === '/auth/v1/logout') {
      assert.equal(init?.method, 'POST');
      assert.equal(url.searchParams.get('scope'), 'local');
      assert.equal(headers.get('apikey'), 'ADMIN_SECRET_SENTINEL');
      active.delete(token);
      revocations.push(token);
      return new Response(null, { status: 204 });
    }
    assert.equal(headers.get('apikey'), 'sb_publishable_test');
    if (url.pathname === '/auth/v1/user') {
      return active.has(token)
        ? Response.json({ id: userId, aud: 'authenticated' })
        : Response.json({ code: 'session_not_found', msg: 'Session revoked' }, { status: 401 });
    }
    assert.equal(url.pathname, '/rest/v1/account_roles');
    assert.ok(active.has(token));
    return Response.json([{ role: 'venue_staff' }]);
  });
  const app = createApp();
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer current-token')).status, 200);
  const logout = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer current-token')
    .send({ accessToken: 'other-device-token', refreshToken: 'another-session', userId: 'someone-else' });
  assert.equal(logout.status, 200);
  assert.equal(logout.headers['cache-control'], 'no-store');
  assert.deepEqual(logout.body, { message: 'Signed out.' });
  assert.deepEqual(revocations, ['current-token']);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer current-token')).status, 401);
  assert.equal((await request(app).post('/api/venues').set('Authorization', 'Bearer current-token').send({})).status, 401);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', 'Bearer other-device-token')).status, 200);
});

for (const status of [400, 401, 403, 500]) {
  test(`[FAILURE] [SG2-23:AC2] [SG2-25:AC3] Auth refuses invalid/expired credentials or fails closed on outage (${status})`, async () => {
    const fetchMock = provider({ authStatus: status });
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
    assert.equal(res.status, status === 500 ? 503 : 401);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.doesNotMatch(res.text, /SENTINEL/);
  });
}

for (const user of [{}, { id: userId, is_anonymous: true }]) {
  test(`[FAILURE] [SG2-25:AC3] Auth response without a registered identity is denied: ${JSON.stringify(user)}`, async () => {
    const fetchMock = provider({ user });
    assert.equal((await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token')).status, 401);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

for (const options of [{ missingRole: true }, { role: 'admin' }, { role: 123 }]) {
  test(`[FAILURE] [SG2-24:AC1] database assignment must exist and be recognised: ${JSON.stringify(options)}`, async () => {
    provider(options);
    assert.equal((await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token')).status, 403);
  });
}

for (const status of [401, 403, 500]) {
  test(`[FAILURE] [SG2-25:AC2] database lookup fails closed (${status})`, async () => {
    provider({ roleStatus: status });
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
    assert.equal(res.status, status === 401 ? 401 : 503);
    assert.doesNotMatch(res.text, /SENTINEL/);
  });
}

test('[CONFLICT] [SG2-24:AC2] [SG2-25:AC1] removing a role grant blocks the next action with the same access token', async () => {
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

for (const role of ACCOUNT_ROLES) {
  test(`[FAILURE] [SG2-25:AC1] default policy denies the unregistered fixture.edit action to ${role}`, async () => {
    const { app, calls } = guardedApp(createAuthorization({
      resolvePrincipal: async () => ({ userId, role })
    }));
    assert.equal((await request(app).post('/fixture/edit').set('Authorization', 'Bearer token')).status, 403);
    assert.equal(calls(), 0);
  });
}

for (const endpoint of ['/auth/v1/user', '/rest/v1/account_roles']) {
  test(`[FAILURE] [SG2-25:AC2] ${endpoint} timeout returns 503 without running the action`, async () => {
    const controller = new AbortController();
    let timedOutRequests = 0;
    mock.method(console, 'error', () => {});
    const timeout = mock.method(AbortSignal, 'timeout', () => controller.signal);
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
    // Assert outside the provider callback: the adapter catches provider exceptions.
    for (const call of timeout.mock.calls) assert.deepEqual(call.arguments, [5000]);
    for (const call of fetchMock.mock.calls) assert.equal(call.arguments[1]?.signal, controller.signal);
  });
}

for (const config of [
  { supabaseUrl: undefined }, { supabaseAnonKey: undefined },
  { supabaseUrl: 'http://auth-test.supabase.co' }, { supabaseUrl: 'not-a-url' }
]) {
  test(`[FAILURE] [SG2-25:AC2] configuration fails closed without a privileged fallback: ${JSON.stringify(config)}`, async () => {
    Object.assign(dbConfig, config);
    const fetchMock = provider();
    assert.equal((await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token')).status, 503);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

test('[FAILURE] [SG2-25:AC2] network failure is a generic 503', async () => {
  mock.method(console, 'error', () => {});
  const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'Access service unavailable' });
});

test('[FAILURE] [SG2-25:AC2] an Auth SDK error without an HTTP status denies access before the action', async () => {
  mock.method(AuthClient.prototype, 'getUser', async () => ({
    data: { user: null }, error: new AuthError('SDK_SECRET_SENTINEL')
  }));
  const fetchMock = provider();
  const { app, calls } = guardedApp(createAuthorization({
    permissions: { 'fixture.edit': ['event_organiser'] }
  }));
  const res = await request(app).post('/fixture/edit').set('Authorization', 'Bearer test-token');
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: 'Access service unavailable' });
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(calls(), 0);
});

test('[CONFLICT] [SG2-25:AC2] concurrent requests use separate user tokens and database identities', async () => {
  let releaseFirst!: () => void;
  const secondLookupStarted = new Promise<void>(resolve => { releaseFirst = resolve; });
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const token = new Headers(init?.headers).get('authorization')!;
    const id = token === 'Bearer first' ? userId : '20000000-0000-4000-8000-000000000002';
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') {
      if (token === 'Bearer first') await secondLookupStarted;
      else releaseFirst();
      return Response.json({ id, aud: 'authenticated' });
    }
    assert.equal(url.searchParams.get('user_id'), `eq.${id}`);
    return Response.json([{ role: token === 'Bearer first' ? 'event_organiser' : 'attendee' }]);
  });
  const app = createApp();
  const [first, second] = await Promise.all(['first', 'second'].map(token =>
    request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.userId, userId);
  assert.equal(first.body.role, 'event_organiser');
  assert.equal(second.body.userId, '20000000-0000-4000-8000-000000000002');
  assert.equal(second.body.role, 'attendee');
});

// SG2-86: Event Coordinator Lead and Safety Officer — Week 7 customer changes.
for (const role of ['safety_officer'] as const) {
  test(`[NORMAL] [SG2-86:AC1] GET /api/auth/me for ${role} returns only the universal profile grants`, async () => {
    const fetchMock = provider({ role });
    const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { userId, role, permissions: ['profile.read', 'profile.update'] });
    assert.equal(fetchMock.mock.callCount(), 2);
  });
}

test('[NORMAL] [SG2-86:AC1] [SG2-97:AC1] GET /api/auth/me for the Event Coordinator Lead adds assignment and its history to the profile grants', async () => {
  const fetchMock = provider({ role: 'event_coordinator_lead' });
  const res = await request(createApp()).get('/api/auth/me').set('Authorization', 'Bearer test-token');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    userId, role: 'event_coordinator_lead',
    permissions: ['event_request.assign_coordinator', 'event_request.history.view', 'profile.read', 'profile.update']
  });
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('[FAILURE] [SG2-97:AC1] no role but the Event Coordinator Lead holds the assign-coordinator grant', () => {
  const holders = SUPPORTED_ROLES.filter(role => permissionsFor(role, PERMISSIONS).includes('event_request.assign_coordinator'));
  assert.deepEqual(holders, ['event_coordinator_lead']);
});

test('[BOUNDARY] [SG2-86:AC1] isRole accepts the two new roles exactly, rejecting near misses', () => {
  assert.equal(isRole('event_coordinator_lead'), true);
  assert.equal(isRole('safety_officer'), true);
  assert.equal(isRole('safety_officer '), false);
  assert.equal(isRole('lead'), false);
});

test('[NORMAL] [SG2-86:AC4] [SG2-97:AC1] [SG2-52:AC3] permissionsFor existing roles keeps the documented grants, including Technical Support equipment maintenance', () => {
  const EXPECTED: Record<string, string[]> = {
    event_organiser: [
      'event_request.create', 'event_request.submit', 'event_request.view', 'event_request.delete',
      'event_request.update', 'event_request.clarify', 'event_request.stage.view', 'event_request.history.view',
      'venues.suitability.view', 'venue_booking.capacity_exception.approve', 'profile.read', 'profile.update'
    ],
    event_coordinator: [
      'work_queue.read', 'venues.availability.view', 'event_request.review', 'event_request.planning.update',
      'event_request.decide', 'event_request.clarify', 'event_request.stage.view', 'event_request.history.view',
      'venues.read', 'venues.layouts.read', 'venues.operations.read', 'venues.search', 'venues.suitability.view', 'venue_booking.request',
      'venue_booking.request.view', 'notifications.read', 'venues.holds.read', 'profile.read', 'profile.update'
    ],
    venue_staff: [
      'work_queue.read', 'venues.availability.view', 'event_request.stage.view', 'event_request.history.view',
      'venues.read', 'venues.create', 'venues.update', 'venues.layouts.read', 'venues.layouts.update',
      'venues.blocks.manage', 'venues.operations.read', 'venues.operations.update', 'venues.suitability.view', 'venue_booking.capacity_exception.approve',
      'venue_booking.request.view', 'venue_booking.decide', 'notifications.read', 'venues.holds.read', 'venues.holds.manage', 'profile.read', 'profile.update'
    ],
    technical_support_staff: [
      'work_queue.read', 'venues.availability.view', 'users.role.update',
      'event_request.stage.view', 'event_request.history.view', 'venues.operations.read', 'venues.suitability.view',
      'venue_booking.capacity_exception.approve', 'notifications.read', 'venues.holds.read',
      'equipment.read', 'equipment.create', 'equipment.update', 'profile.read', 'profile.update'
    ],
    attendee: ['profile.read', 'profile.update']
  };
  for (const [role, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(permissionsFor(role as Principal['role'], PERMISSIONS).sort(), [...expected].sort(), role);
  }
});

test('[BOUNDARY] [SG2-86:AC4] the internal-role list holds exactly the five internal roles', () => {
  assert.deepEqual([...INTERNAL_ROLES].sort(), [
    'event_coordinator', 'event_coordinator_lead', 'safety_officer', 'technical_support_staff', 'venue_staff'
  ]);
  assert.equal(isInternalRole('event_organiser'), false);
  assert.equal(isInternalRole('attendee'), false);
});

for (const action of ['work_queue.read', 'event_request.decide', 'venues.search'] as const) {
  test(`[FAILURE] [SG2-86:AC2] safety_officer is refused ${action} server-side`, async () => {
    const access = createAuthorization({
      resolvePrincipal: async () => ({ userId, role: 'safety_officer' }),
      permissions: PERMISSIONS
    });
    let calls = 0;
    const app = express();
    app.use(access.requireAuth);
    app.post('/action', access.requirePermission(action), (_req, res) => { calls++; res.sendStatus(200); });
    const res = await request(app).post('/action').set('Authorization', 'Bearer token');
    assert.equal(res.status, 403);
    assert.equal(calls, 0);
  });
}

test('[CONFLICT] [SG2-86:AC1] two concurrent /api/auth/me requests resolving different new roles each get their own role', async () => {
  mock.method(globalThis, 'fetch', async (...[input, init]: Parameters<typeof fetch>) => {
    const token = new Headers(init?.headers).get('authorization')!;
    const id = token === 'Bearer lead-token' ? userId : '20000000-0000-4000-8000-000000000002';
    const url = new URL(String(input));
    if (url.pathname === '/auth/v1/user') return Response.json({ id, aud: 'authenticated' });
    assert.equal(url.searchParams.get('user_id'), `eq.${id}`);
    return Response.json([{ role: token === 'Bearer lead-token' ? 'event_coordinator_lead' : 'safety_officer' }]);
  });
  const app = createApp();
  const [lead, safety] = await Promise.all(['lead-token', 'safety-token'].map(token =>
    request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)));
  assert.equal(lead.body.role, 'event_coordinator_lead');
  assert.equal(safety.body.role, 'safety_officer');
});
