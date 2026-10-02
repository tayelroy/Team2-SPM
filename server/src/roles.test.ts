import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUpdateRoleHandler } from './auth/roles';
import { createAuthorization } from './auth';
import { createApp } from './app';

function fakeAdmin(options: {
  update?: (payload: any) => Promise<{ data: any; error: { message: string } | null }>;
  captureTarget?: (column: string, userId: string) => void;
}): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'account_roles');
      return {
        update: (payload: any) => ({
          eq: (column: string, userId: string) => {
            options.captureTarget?.(column, userId);
            return { select: async () =>
              options.update ? options.update(payload) : { data: [{ user_id: 'target-1' }], error: null } };
          }
        })
      };
    }
  } as unknown as SupabaseClient;
}

function buildApp(options: Parameters<typeof fakeAdmin>[0] = {}, getAdmin?: () => SupabaseClient | null) {
  const app = express();
  app.use(express.json());
  app.patch('/api/users/:userId/role', createUpdateRoleHandler(getAdmin ?? (() => fakeAdmin(options))));
  return app;
}

// Caller authorisation (only Technical Support Staff reach this handler at
// all) is enforced by requireAuth/requirePermission in app.ts, not here —
// see server/src/authorization.test.ts for that gate.
describe('PATCH /api/users/:userId/role', () => {
  for (const [displayRole, storedRole] of [
    ['Event Organiser', 'event_organiser'], ['Event Coordinator', 'event_coordinator'],
    ['Venue Staff', 'venue_staff'], ['Technical Support Staff', 'technical_support_staff'], ['Attendee', 'attendee']
  ]) test(`[NORMAL] [SG2-24:AC1] [SG2-24:AC2] updates the target account using the stored form of ${displayRole}`, async () => {
    let updatePayload: any;
    let target: unknown;
    const app = buildApp({
      captureTarget: (column, userId) => { target = { column, userId }; },
      update: async (payload) => {
        updatePayload = payload;
        return { data: [{ user_id: 'target-1' }], error: null };
      }
    });
    const response = await request(app).patch('/api/users/target-1/role').send({ role: displayRole });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Role updated.' });
    assert.deepEqual(updatePayload, { role: storedRole });
    assert.deepEqual(target, { column: 'user_id', userId: 'target-1' });
  });

  test('[FAILURE] [SG2-24:AC1] requires a target role in the body', async () => {
    let writes = 0;
    const app = buildApp({ update: async () => { writes++; return { data: [], error: null }; } });
    const response = await request(app).patch('/api/users/target-1/role').send({});
    assert.equal(response.status, 400);
    assert.equal(writes, 0);
  });

  test('[FAILURE] [SG2-24:AC1] rejects a role name that does not exist', async () => {
    let writes = 0;
    const app = buildApp({ update: async () => { writes++; return { data: [], error: null }; } });
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Overlord' });
    assert.equal(response.status, 400);
    assert.equal(writes, 0);
  });

  test('[FAILURE] [SG2-24:AC2] returns 404 when the target account does not exist', async () => {
    const app = buildApp({ update: async () => ({ data: [], error: null }) });
    const response = await request(app).patch('/api/users/does-not-exist/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'No account with that id.' });
  });

  test('[FAILURE] [SG2-24:AC2] returns 503 when the admin client is unavailable', async () => {
    const app = buildApp({}, () => null);
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Service temporarily unavailable. Please try again later.' });
  });

  test('[FAILURE] [SG2-24:AC2] returns 503 when the update itself fails', async () => {
    const app = buildApp({ update: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Could not update the role. Please try again later.' });
  });
});

describe('role changes through the protected app route', () => {
  for (const role of ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee'] as const) {
    test(`${role === 'technical_support_staff' ? '[NORMAL]' : '[FAILURE]'} [SG2-24:AC2] ${role} is checked before a role change`, async () => {
      let changes = 0;
      const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'caller-1', role }) });
      const app = createApp(undefined, access, undefined, undefined, undefined, (req, res) => {
        changes++;
        assert.equal(req.params.userId, 'target-1');
        res.status(200).json({ message: 'Role updated.' });
      });
      const response = await request(app).patch('/api/users/target-1/role').set('Authorization', 'Bearer caller-token')
        .send({ role: 'Venue Staff', callerRole: 'Technical Support Staff' });
      assert.equal(response.status, role === 'technical_support_staff' ? 200 : 403);
      assert.equal(changes, role === 'technical_support_staff' ? 1 : 0);
      assert.deepEqual(response.body, role === 'technical_support_staff' ? { message: 'Role updated.' } : { error: 'Access denied' });
    });
  }

  test('[FAILURE] [SG2-24:AC2] [SG2-25:AC3] an anonymous caller cannot reach the role-change handler', async () => {
    let changes = 0;
    const app = createApp(undefined, undefined, undefined, undefined, undefined, (_req, res) => {
      changes++;
      res.sendStatus(200);
    });
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 401);
    assert.equal(changes, 0);
    assert.deepEqual(response.body, { error: 'Authentication required' });
  });
});
