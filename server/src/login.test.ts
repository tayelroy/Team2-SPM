import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loginAccount, createLoginHandler, LoginResult } from './auth/login';

function fakeClient(options: {
  signIn?: () => Promise<any>;
  getUser?: () => Promise<any>;
  userRow?: any;
  roleRow?: any;
}): SupabaseClient {
  return {
    auth: {
      signInWithPassword:
        options.signIn ??
        (async () => ({
          data: { session: { access_token: 'access-1', refresh_token: 'refresh-1' }, user: { id: 'user-1' } },
          error: null
        })),
      getUser:
        options.getUser ?? (async () => ({ data: { user: { id: 'user-1', email: 'ada@example.com' } }, error: null }))
    },
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => options.userRow ?? { data: { name: 'Ada', organisation: 'Org', role_id: 5 }, error: null }
            })
          })
        };
      }
      if (table === 'roles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => options.roleRow ?? { data: { role_name: 'Attendee' }, error: null }
            })
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  } as unknown as SupabaseClient;
}

function buildApp(login: (input: unknown) => Promise<LoginResult>) {
  const app = express();
  app.use(express.json());
  app.post('/api/auth/login', createLoginHandler(login as any));
  return app;
}

describe('loginAccount', () => {
  test('returns a session and the caller role on valid credentials', async () => {
    const client = fakeClient({});
    const result = await loginAccount(
      { email: 'ada@example.com', password: 'Correct-Horse-9' },
      () => client,
      () => client
    );
    assert.deepEqual(result, {
      outcome: 'success',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { userId: 'user-1', email: 'ada@example.com', name: 'Ada', organisation: 'Org', role: 'Attendee' }
    });
  });

  test('rejects missing fields without calling Supabase', async () => {
    let called = false;
    const guard = () => {
      called = true;
      return fakeClient({});
    };
    const result = await loginAccount({ email: 'ada@example.com' }, guard, guard);
    assert.equal(result.outcome, 'invalid_credentials');
    assert.equal(called, false);
  });

  test('returns a generic error for wrong credentials, same as a nonexistent email', async () => {
    const client = fakeClient({
      signIn: async () => ({ data: { session: null, user: null }, error: { message: 'Invalid login credentials' } })
    });
    const result = await loginAccount({ email: 'ada@example.com', password: 'wrong' }, () => client, () => client);
    assert.deepEqual(result, { outcome: 'invalid_credentials' });
  });

  test('reports incomplete_account when Auth succeeds but no public.users row exists', async () => {
    const client = fakeClient({ userRow: { data: null, error: null } });
    const result = await loginAccount(
      { email: 'ada@example.com', password: 'Correct-Horse-9' },
      () => client,
      () => client
    );
    assert.deepEqual(result, { outcome: 'incomplete_account' });
  });

  test('reports unavailable when Supabase is not configured', async () => {
    const result = await loginAccount(
      { email: 'ada@example.com', password: 'Correct-Horse-9' },
      () => null,
      () => null
    );
    assert.deepEqual(result, { outcome: 'unavailable' });
  });
});

describe('POST /api/auth/login', () => {
  test('returns 200 with the session on success', async () => {
    const app = buildApp(async () => ({
      outcome: 'success',
      accessToken: 'a',
      refreshToken: 'r',
      user: { userId: '1', email: 'x', name: 'x', organisation: null, role: 'Attendee' }
    }));
    const response = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    assert.equal(response.status, 200);
    assert.equal(response.body.accessToken, 'a');
  });

  test('returns 401 for invalid credentials', async () => {
    const app = buildApp(async () => ({ outcome: 'invalid_credentials' }));
    const response = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    assert.equal(response.status, 401);
  });

  test('returns 403 for an incomplete account', async () => {
    const app = buildApp(async () => ({ outcome: 'incomplete_account' }));
    const response = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    assert.equal(response.status, 403);
  });

  test('returns 503 when unavailable', async () => {
    const app = buildApp(async () => ({ outcome: 'unavailable' }));
    const response = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    assert.equal(response.status, 503);
  });
});
