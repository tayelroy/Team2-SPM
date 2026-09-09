import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUpdateRoleHandler } from './auth/roles';

function fakeClients(options: {
  getUser?: () => Promise<any>;
  userRow?: any;
  roleRow?: any;
  updateResult?: any;
}) {
  const anon = {
    auth: {
      getUser:
        options.getUser ??
        (async () => ({ data: { user: { id: 'caller-1', email: 'tech@example.com' } }, error: null }))
    }
  } as unknown as SupabaseClient;

  const admin = {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle:
                async () => options.userRow ?? { data: { name: 'Tech', organisation: null, role_id: 4 }, error: null }
            })
          }),
          update: () => ({
            eq: () => ({
              select: async () => options.updateResult ?? { data: [{ user_id: 'target-1' }], error: null }
            })
          })
        };
      }
      if (table === 'roles') {
        // Shared by both the caller's role lookup (by role_id) and the
        // target role's id lookup (by role_name) — include both fields so
        // either read finds what it needs.
        return {
          select: () => ({
            eq: () => ({
              maybeSingle:
                async () =>
                  options.roleRow ?? { data: { role_id: 3, role_name: 'Technical Support Staff' }, error: null }
            })
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  } as unknown as SupabaseClient;

  return { anon, admin };
}

function buildApp(options: Parameters<typeof fakeClients>[0] = {}) {
  const { anon, admin } = fakeClients(options);
  const app = express();
  app.use(express.json());
  app.patch('/api/users/:userId/role', createUpdateRoleHandler(() => anon, () => admin));
  return app;
}

describe('PATCH /api/users/:userId/role', () => {
  test('returns 401 with no Authorization header', async () => {
    const app = buildApp();
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 401);
  });

  test('allows Technical Support Staff to change a role', async () => {
    const app = buildApp();
    const response = await request(app)
      .patch('/api/users/target-1/role')
      .set('Authorization', 'Bearer valid-token')
      .send({ role: 'Venue Staff' });
    assert.equal(response.status, 200);
  });

  test('rejects a caller who is not Technical Support Staff', async () => {
    const app = buildApp({ userRow: { data: { name: 'Attendee Al', organisation: null, role_id: 5 }, error: null }, roleRow: { data: { role_id: 5, role_name: 'Attendee' }, error: null } });
    const response = await request(app)
      .patch('/api/users/target-1/role')
      .set('Authorization', 'Bearer valid-token')
      .send({ role: 'Venue Staff' });
    assert.equal(response.status, 403);
    assert.match(response.body.error, /Technical Support Staff/);
  });

  test('rejects an invalid or expired token', async () => {
    const app = buildApp({ getUser: async () => ({ data: { user: null }, error: { message: 'bad' } }) });
    const response = await request(app)
      .patch('/api/users/target-1/role')
      .set('Authorization', 'Bearer bad-token')
      .send({ role: 'Venue Staff' });
    assert.equal(response.status, 401);
  });

  test('requires a target role in the body', async () => {
    const app = buildApp();
    const response = await request(app)
      .patch('/api/users/target-1/role')
      .set('Authorization', 'Bearer valid-token')
      .send({});
    assert.equal(response.status, 400);
  });

  test('rejects a role name that does not exist', async () => {
    const app = buildApp();
    const response = await request(app)
      .patch('/api/users/target-1/role')
      .set('Authorization', 'Bearer valid-token')
      .send({ role: 'Overlord' });
    assert.equal(response.status, 400);
  });

  test('returns 404 when the target account does not exist', async () => {
    const app = buildApp({ updateResult: { data: [], error: null } });
    const response = await request(app)
      .patch('/api/users/does-not-exist/role')
      .set('Authorization', 'Bearer valid-token')
      .send({ role: 'Venue Staff' });
    assert.equal(response.status, 404);
  });
});
