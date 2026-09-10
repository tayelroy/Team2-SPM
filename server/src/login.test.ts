import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loginAccount, createLoginHandler, LoginResult } from './auth/login';
import { AccessError } from './auth/policy';

function fakeClient(signIn?: () => Promise<any>): SupabaseClient {
  return {
    auth: {
      signInWithPassword:
        signIn ??
        (async () => ({
          data: { session: { access_token: 'access-1', refresh_token: 'refresh-1' }, user: { id: 'user-1', email: 'ada@example.com' } },
          error: null
        }))
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
    const result = await loginAccount(
      { email: 'ada@example.com', password: 'Correct-Horse-9' },
      () => fakeClient(),
      async () => ({ userId: 'user-1', role: 'venue_staff' })
    );
    assert.deepEqual(result, {
      outcome: 'success',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { userId: 'user-1', email: 'ada@example.com', role: 'Venue Staff' }
    });
  });

  test('rejects missing fields without calling Supabase', async () => {
    let called = false;
    const result = await loginAccount({ email: 'ada@example.com' }, () => {
      called = true;
      return fakeClient();
    });
    assert.equal(result.outcome, 'invalid_credentials');
    assert.equal(called, false);
  });

  test('returns a generic error for wrong credentials, same as a nonexistent email', async () => {
    const client = fakeClient(async () => ({
      data: { session: null, user: null },
      error: { message: 'Invalid login credentials' }
    }));
    const result = await loginAccount({ email: 'ada@example.com', password: 'wrong' }, () => client);
    assert.deepEqual(result, { outcome: 'invalid_credentials' });
  });

  test('reports incomplete_account when the caller has no account_roles row', async () => {
    const result = await loginAccount(
      { email: 'ada@example.com', password: 'Correct-Horse-9' },
      () => fakeClient(),
      async () => {
        throw new AccessError(403);
      }
    );
    assert.deepEqual(result, { outcome: 'incomplete_account' });
  });

  test('reports unavailable when role resolution fails for any other reason', async () => {
    const result = await loginAccount(
      { email: 'ada@example.com', password: 'Correct-Horse-9' },
      () => fakeClient(),
      async () => {
        throw new AccessError(503);
      }
    );
    assert.deepEqual(result, { outcome: 'unavailable' });
  });

  test('reports unavailable when Supabase is not configured', async () => {
    const result = await loginAccount({ email: 'ada@example.com', password: 'Correct-Horse-9' }, () => null);
    assert.deepEqual(result, { outcome: 'unavailable' });
  });

  test('falls back to the submitted email if Auth returns none on the user object', async () => {
    const client = fakeClient(async () => ({
      data: { session: { access_token: 'access-1', refresh_token: 'refresh-1' }, user: { id: 'user-1' } },
      error: null
    }));
    const result = await loginAccount(
      { email: 'ada@example.com', password: 'Correct-Horse-9' },
      () => client,
      async () => ({ userId: 'user-1', role: 'attendee' })
    );
    assert.deepEqual(result, {
      outcome: 'success',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { userId: 'user-1', email: 'ada@example.com', role: 'Attendee' }
    });
  });
});

describe('POST /api/auth/login', () => {
  test('returns 200 with the session on success', async () => {
    const app = buildApp(async () => ({
      outcome: 'success',
      accessToken: 'a',
      refreshToken: 'r',
      user: { userId: '1', email: 'x', role: 'Attendee' }
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

  test('treats an absent request body as empty input', async () => {
    // Exercise the handler's fallback independently of express.json(), which
    // normalises a bodyless HTTP request to {} in this Express version.
    const app = express();
    app.post('/api/auth/login', createLoginHandler(async (input) => {
      assert.deepEqual(input, {});
      return { outcome: 'invalid_credentials' };
    }));
    const response = await request(app).post('/api/auth/login');
    assert.equal(response.status, 401);
  });
});
