import test from 'node:test';
import assert from 'node:assert/strict';
import express, { type Request, type RequestHandler } from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Principal, type Role } from './auth';
import { actingRoleHeaders, currentActingRole, runAsActingRole } from './auth/actingRole';

type Authorization = ReturnType<typeof createAuthorization>;
const permissions = { 'fixture.read': ['event_coordinator', 'venue_staff'] as Role[] };

/** Exercise the same request passing through several sibling protected routers. */
function siblingApp(access: Authorization, between: RequestHandler = (_req, _res, next) => next()) {
  const app = express();
  app.use('/fixture', access.protectedRouter());
  app.use('/fixture', between);
  const terminal = access.protectedRouter();
  terminal.get('/read', access.requirePermission('fixture.read'), async (req, res) => {
    await Promise.resolve();
    res.json({ principal: access.getPrincipal(req), databaseRole: currentActingRole(), databaseHeaders: actingRoleHeaders() });
  });
  app.use('/fixture', terminal);
  return app;
}

/** Model trusted middleware changing request headers before another auth boundary. */
function replaceHeader(req: Request, name: string, values: string[]) {
  const normalized = name.toLowerCase();
  for (let index = req.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (req.rawHeaders[index].toLowerCase() === normalized) req.rawHeaders.splice(index, 2);
  }
  for (const value of values) req.rawHeaders.push(name, value);
  if (values.length === 0) delete req.headers[normalized];
  else req.headers[normalized] = values.length === 1 ? values[0] : values;
}

test('[NORMAL] [SG2-25:AC3] [SG2-104:AC2] sibling protected routers verify once and reenter the verified database acting role', async () => {
  let resolutions = 0;
  const access = createAuthorization({ permissions, resolvePrincipal: async () => {
    resolutions++;
    return { userId: 'member', roles: ['event_coordinator', 'venue_staff'] };
  } });
  // An intervening context must not change the database identity after reuse.
  const app = siblingApp(access, (_req, _res, next) => runAsActingRole('attendee', next));
  const response = await request(app).get('/fixture/read').set('Authorization', 'Bearer token')
    .set('X-Acting-Role', 'venue_staff').timeout({ deadline: 3000 });
  assert.equal(response.status, 200);
  assert.equal(resolutions, 1);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, {
    principal: { userId: 'member', role: 'venue_staff', roles: ['event_coordinator', 'venue_staff'] },
    databaseRole: 'venue_staff', databaseHeaders: { 'X-Acting-Role': 'venue_staff' },
  });
});

test('[CONFLICT] [FAILURE] [SG2-25:AC1] [SG2-25:AC3] the same token on new HTTP requests rechecks changed roles and revoked sessions', async () => {
  let role: Role = 'venue_staff';
  let revoked = false;
  let resolutions = 0;
  const access = createAuthorization({ permissions, resolvePrincipal: async () => {
    resolutions++;
    if (revoked) throw new AccessError(401);
    return { userId: 'member', role };
  } });
  const app = siblingApp(access);
  const read = () => request(app).get('/fixture/read').set('Authorization', 'Bearer same-token').timeout({ deadline: 3000 });
  assert.equal((await read()).status, 200);
  role = 'attendee';
  assert.equal((await read()).status, 403);
  revoked = true;
  assert.equal((await read()).status, 401);
  assert.equal(resolutions, 3);
});

test('[CONFLICT] [SG2-25:AC3] [SG2-104:AC2] changing only Authorization or acting-role headers requires a fresh verified principal', async () => {
  for (const change of ['token', 'acting-role', 'remove-acting-role']) {
    const tokens: string[] = [];
    const access = createAuthorization({ permissions, resolvePrincipal: async token => {
      tokens.push(token);
      return { userId: token, roles: ['event_coordinator', 'venue_staff'] };
    } });
    const app = siblingApp(access, (req, _res, next) => {
      if (change === 'token') replaceHeader(req, 'Authorization', ['Bearer replacement']);
      else replaceHeader(req, 'X-Acting-Role', change === 'acting-role' ? ['event_coordinator'] : []);
      next();
    });
    const response = await request(app).get('/fixture/read').set('Authorization', 'Bearer original')
      .set('X-Acting-Role', 'venue_staff').timeout({ deadline: 3000 });
    assert.equal(response.status, 200, change);
    assert.deepEqual(tokens, ['original', change === 'token' ? 'replacement' : 'original'], change);
    assert.equal(response.body.principal.userId, change === 'token' ? 'replacement' : 'original', change);
    assert.equal(response.body.principal.role, change === 'token' ? 'venue_staff' : 'event_coordinator', change);
    assert.equal(response.body.databaseRole, response.body.principal.role, change);
  }
});

test('[FAILURE] [BOUNDARY] [SG2-25:AC3] added duplicate or malformed Authorization headers clear the previously verified identity', async () => {
  for (const changed of [[], ['Basic token'], ['Bearer token', 'Bearer token'], ['Bearer token', 'Bearer other']]) {
    let resolutions = 0;
    const observed: (Principal | undefined)[] = [];
    const access = createAuthorization({ permissions, resolvePrincipal: async () => {
      resolutions++; return { userId: 'member', role: 'venue_staff' };
    } });
    const app = siblingApp(access, (req, res, next) => {
      res.once('finish', () => observed.push(access.getPrincipal(req)));
      replaceHeader(req, 'Authorization', changed);
      next();
    });
    const response = await request(app).get('/fixture/read').set('Authorization', 'Bearer token').timeout({ deadline: 3000 });
    assert.equal(response.status, 401, JSON.stringify(changed));
    assert.equal(response.headers['www-authenticate'], 'Bearer');
    assert.equal(resolutions, 1);
    assert.deepEqual(observed, [undefined]);
  }
});

test('[FAILURE] [BOUNDARY] [SG2-104:AC2] [SG2-104:AC5] duplicate, malformed or unheld acting-role changes cannot retain earlier permissions', async () => {
  for (const changed of [
    ['venue_staff', 'venue_staff'], ['venue_staff', 'event_coordinator'], ['event_coordinator', 'venue_staff'],
    ['Venue Staff'], ['venue_staff,event_coordinator'], ['safety_officer'],
  ]) {
    let resolutions = 0;
    const observed: (Principal | undefined)[] = [];
    const access = createAuthorization({ permissions, resolvePrincipal: async () => {
      resolutions++; return { userId: 'member', roles: ['event_coordinator', 'venue_staff'] };
    } });
    const app = siblingApp(access, (req, res, next) => {
      res.once('finish', () => observed.push(access.getPrincipal(req)));
      replaceHeader(req, 'X-Acting-Role', changed);
      next();
    });
    const response = await request(app).get('/fixture/read').set('Authorization', 'Bearer token')
      .set('X-Acting-Role', 'venue_staff').timeout({ deadline: 3000 });
    const unheld = changed[0] === 'safety_officer';
    assert.equal(response.status, unheld ? 403 : 400, JSON.stringify(changed));
    assert.equal(response.body.code, unheld ? 'role_not_held' : 'invalid_acting_role');
    assert.equal(resolutions, 2);
    assert.deepEqual(observed, [undefined]);
  }
});

test('[FAILURE] [SG2-25:AC2] [SG2-25:AC3] a changed token that fails verification never leaves the old principal available', async () => {
  for (const failure of [new AccessError(401), new Error('PRIVATE_PROVIDER_DETAIL')]) {
    const observed: (Principal | undefined)[] = [];
    let resolutions = 0;
    const access = createAuthorization({ permissions, resolvePrincipal: async token => {
      resolutions++;
      if (token === 'revoked') throw failure;
      return { userId: 'member', role: 'venue_staff' };
    } });
    const app = siblingApp(access, (req, res, next) => {
      res.once('finish', () => observed.push(access.getPrincipal(req)));
      replaceHeader(req, 'Authorization', ['Bearer revoked']);
      next();
    });
    const response = await request(app).get('/fixture/read').set('Authorization', 'Bearer active').timeout({ deadline: 3000 });
    assert.equal(response.status, failure instanceof AccessError ? 401 : 503);
    assert.doesNotMatch(response.text, /PRIVATE_PROVIDER_DETAIL/);
    assert.equal(resolutions, 2);
    assert.deepEqual(observed, [undefined]);
  }
});

test('[CONFLICT] [SG2-25:AC3] [SG2-104:AC2] concurrent requests retain independent principals and database acting roles', async () => {
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const resolutions = new Map<string, number>();
  const access = createAuthorization({ permissions, resolvePrincipal: async token => {
    resolutions.set(token, (resolutions.get(token) ?? 0) + 1);
    if (++arrived === 2) release();
    await barrier;
    return { userId: token, role: token === 'venue-token' ? 'venue_staff' : 'event_coordinator' };
  } });
  const app = siblingApp(access, (_req, _res, next) => runAsActingRole('attendee', next));
  const [venue, coordinator] = await Promise.all(['venue-token', 'coordinator-token'].map(token =>
    request(app).get('/fixture/read').set('Authorization', `Bearer ${token}`).timeout({ deadline: 3000 })));
  assert.equal(venue.status, 200);
  assert.equal(coordinator.status, 200);
  assert.equal(venue.body.principal.userId, 'venue-token');
  assert.equal(venue.body.databaseRole, 'venue_staff');
  assert.deepEqual(venue.body.databaseHeaders, { 'X-Acting-Role': 'venue_staff' });
  assert.equal(coordinator.body.principal.userId, 'coordinator-token');
  assert.equal(coordinator.body.databaseRole, 'event_coordinator');
  assert.deepEqual(coordinator.body.databaseHeaders, { 'X-Acting-Role': 'event_coordinator' });
  assert.deepEqual([...resolutions], [['venue-token', 1], ['coordinator-token', 1]]);
});

test('[FAILURE] [SG2-25:AC1] [SG2-25:AC3] separate authorization factories never trust another factory or a public request property', async () => {
  let firstResolutions = 0;
  let secondResolutions = 0;
  const first = createAuthorization({ permissions, resolvePrincipal: async () => {
    firstResolutions++; return { userId: 'first', role: 'venue_staff' };
  } });
  const second = createAuthorization({ permissions, resolvePrincipal: async () => {
    secondResolutions++; return { userId: 'second', role: 'attendee' };
  } });
  const app = express();
  app.use(first.requireAuth);
  app.use((req, _res, next) => {
    (req as Request & { principal: Principal }).principal = first.getPrincipal(req)!;
    next();
  });
  app.get('/read', second.requireAuth, second.requirePermission('fixture.read'), (_req, res) => res.sendStatus(200));
  const response = await request(app).get('/read').set('Authorization', 'Bearer token').timeout({ deadline: 3000 });
  assert.equal(response.status, 403);
  assert.equal(firstResolutions, 1);
  assert.equal(secondResolutions, 1);
});
