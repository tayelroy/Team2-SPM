import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization } from './auth';
import {
  ACTING_ROLE_DEFAULT_ORDER, ActingRoleError, actingRoleHeaders, currentActingRole, runAsActingRole, selectActingRole
} from './auth/actingRole';
import { heldRoles, ROLES } from './auth/policy';
import { createUpdateRoleHandler } from './auth/roles';
import { userScopedHeaders } from './db/user-client';
import { hasEventRelationship } from './events/eventRelationship';

// SG2-104: an account that holds two roles acts as exactly one per request.
function multiRoleApp(roles: string[] = ['event_coordinator', 'venue_staff']) {
  const access = createAuthorization({
    resolvePrincipal: async () => ({ userId: 'multi-1', roles: roles as never }),
    permissions: { coordinate: ['event_coordinator'], staff: ['venue_staff'] }
  });
  const app = express();
  app.use(access.requireAuth);
  for (const action of ['coordinate', 'staff']) {
    app.get(`/${action}`, access.requirePermission(action), (req, res) =>
      res.json({ principal: access.getPrincipal(req), acting: currentActingRole(), headers: userScopedHeaders('t') }));
  }
  return app;
}
const call = (app: express.Express, path: string, acting?: string | string[]) => {
  const pending = request(app).get(path).set('Authorization', 'Bearer token');
  // An array sends the header once per value, as a client repeating it would.
  if (acting !== undefined) pending.set('X-Acting-Role', acting as string);
  return pending;
};

test('[NORMAL] [SG2-104:AC1] [SG2-104:AC5] a two-role account reaches each role\'s functions only while acting as it', async () => {
  const app = multiRoleApp();
  const asCoordinator = await call(app, '/coordinate', 'event_coordinator');
  assert.equal(asCoordinator.status, 200);
  assert.deepEqual(asCoordinator.body.principal, { userId: 'multi-1', role: 'event_coordinator', roles: ['event_coordinator', 'venue_staff'] });
  assert.equal(asCoordinator.body.acting, 'event_coordinator');
  // The database calls of the request carry the same acting role.
  assert.deepEqual(asCoordinator.body.headers, { Authorization: 'Bearer t', 'X-Acting-Role': 'event_coordinator' });
  assert.equal((await call(app, '/staff', 'event_coordinator')).status, 403);
  assert.equal((await call(app, '/staff', 'venue_staff')).status, 200);
  assert.equal((await call(app, '/coordinate', 'venue_staff')).status, 403);
});

test('[FAILURE] [SG2-104:AC2] a role the account does not hold, a malformed role or two headers are refused before the handler', async () => {
  const app = multiRoleApp();
  assert.deepEqual([(await call(app, '/staff', 'technical_support_staff')).status, (await call(app, '/staff', 'technical_support_staff')).body.code], [403, 'role_not_held']);
  for (const value of ['Venue Staff', 'venue_staffs', '']) assert.equal((await call(app, '/staff', value)).status, 400, value);
  assert.equal((await call(app, '/staff', ['venue_staff', 'venue_staff'])).status, 400);
});

test('[BOUNDARY] [SG2-104:AC4] without a header a single-role account acts as its role and a multi-role account as its least-privileged one', async () => {
  assert.equal((await call(multiRoleApp(['venue_staff']), '/staff')).status, 200);
  const multi = await call(multiRoleApp(), '/coordinate');
  assert.equal(multi.body.acting, 'event_coordinator');
  assert.equal(selectActingRole([...ROLES], []), 'attendee');
  assert.deepEqual([...ACTING_ROLE_DEFAULT_ORDER].sort(), [...ROLES].sort());
  assert.throws(() => selectActingRole([], []), (error: unknown) => error instanceof ActingRoleError && error.status === 403);
  // Outside a request nothing is acting; heldRoles falls back to the acting role.
  assert.deepEqual([currentActingRole(), actingRoleHeaders()], [undefined, {}]);
  assert.equal(runAsActingRole('attendee', () => currentActingRole()), 'attendee');
  assert.deepEqual(heldRoles({ userId: 'u', role: 'attendee' }), ['attendee']);
});

test('[FAILURE] [SG2-104:AC2] the role change route refuses a request with no verified caller', async () => {
  const app = express();
  app.use(express.json());
  app.patch('/api/users/:userId/role', createUpdateRoleHandler(() => ({} as SupabaseClient), () => undefined));
  assert.equal((await request(app).patch('/api/users/t/role').send({ role: 'Attendee' })).status, 401);
});

function tables(rows: Record<string, unknown[]>, failing: string[] = []): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ limit: async () => failing.includes(table)
        ? { data: null, error: { message: 'down' } } : { data: rows[table] ?? null, error: null } }) })
    })
  } as unknown as SupabaseClient;
}

test('[NORMAL] [SG2-104:AC6] the relationship rule for every acting role', async () => {
  const event = { event_id: 7, organiser_id: 'org', coordinator_id: 'coord', status: 'planning' };
  const none = tables({});
  const related = async (role: Parameters<typeof hasEventRelationship>[1], userId: string, admin = none, e = event) =>
    (await hasEventRelationship(admin, role, userId, e));
  assert.deepEqual(await related('event_organiser', 'org'), { ok: true, related: true });
  assert.deepEqual(await related('event_organiser', 'other'), { ok: true, related: false });
  assert.deepEqual(await related('event_coordinator', 'coord'), { ok: true, related: true });
  assert.deepEqual(await related('event_coordinator', 'coord', none, { ...event, coordinator_id: undefined as never }), { ok: true, related: false });
  assert.deepEqual(await related('event_coordinator_lead', 'x'), { ok: true, related: true });
  assert.deepEqual(await related('event_coordinator_lead', 'x', none, { ...event, status: 'draft' }), { ok: true, related: false });
  assert.deepEqual(await related('safety_officer', 'x'), { ok: true, related: false });
  assert.deepEqual(await related('safety_officer', 'x', none, { ...event, status: 'awaiting_safety_check' }), { ok: true, related: true });
  assert.deepEqual(await related('attendee', 'x'), { ok: true, related: false });
  assert.deepEqual(await related('venue_staff', 'x'), { ok: true, related: false });
  assert.deepEqual(await related('venue_staff', 'x', tables({ venue_bookings: [{ event_id: 7 }] })), { ok: true, related: true });
  assert.deepEqual(await related('technical_support_staff', 'x', tables({ equipment_reservations: [{ event_id: 7 }] })), { ok: true, related: true });
  assert.deepEqual(await related('technical_support_staff', 'x', tables({}, ['equipment_requests'])), { ok: false });
});
