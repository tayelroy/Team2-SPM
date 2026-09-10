import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUpdateRoleHandler } from './auth/roles';

function fakeAdmin(options: {
  update?: (payload: any) => Promise<{ data: any; error: { message: string } | null }>;
}): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'account_roles');
      return {
        update: (payload: any) => ({
          eq: () => ({
            select: async () =>
              options.update ? options.update(payload) : { data: [{ user_id: 'target-1' }], error: null }
          })
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
  test('updates the role when given a recognised role name', async () => {
    let updatePayload: any;
    const app = buildApp({
      update: async (payload) => {
        updatePayload = payload;
        return { data: [{ user_id: 'target-1' }], error: null };
      }
    });
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 200);
    assert.deepEqual(updatePayload, { role: 'venue_staff' });
  });

  test('requires a target role in the body', async () => {
    const app = buildApp();
    const response = await request(app).patch('/api/users/target-1/role').send({});
    assert.equal(response.status, 400);
  });

  test('rejects a role name that does not exist', async () => {
    const app = buildApp();
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Overlord' });
    assert.equal(response.status, 400);
  });

  test('returns 404 when the target account does not exist', async () => {
    const app = buildApp({ update: async () => ({ data: [], error: null }) });
    const response = await request(app).patch('/api/users/does-not-exist/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 404);
  });

  test('returns 503 when the admin client is unavailable', async () => {
    const app = buildApp({}, () => null);
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 503);
  });

  test('returns 503 when the update itself fails', async () => {
    const app = buildApp({ update: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const response = await request(app).patch('/api/users/target-1/role').send({ role: 'Venue Staff' });
    assert.equal(response.status, 503);
  });
});
