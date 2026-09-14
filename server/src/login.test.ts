import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loginAccount, createLoginHandler, createLoginRateLimiter, LoginResult } from './auth/login';
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
      user: { userId: 'user-1', email: 'ada@example.com', role: 'Attendee' }
    });
  });
});

describe('POST /api/auth/login', () => {
  test('returns 200 with the session on success, and no refresh token', async () => {
    const app = buildApp(async () => ({
      outcome: 'success',
      accessToken: 'a',
      user: { userId: '1', email: 'x', role: 'Attendee' }
    }));
    const response = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'x' });
    assert.equal(response.status, 200);
    assert.equal(response.body.accessToken, 'a');
    assert.equal(response.body.refreshToken, undefined);
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

describe('login rate limiting', () => {
  test('allows requests under the limit, then blocks with 429', async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/auth/login', createLoginRateLimiter({ limit: 3 }), createLoginHandler(async () => ({ outcome: 'invalid_credentials' })));

    for (let i = 0; i < 3; i++) {
      const response = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'wrong' });
      assert.equal(response.status, 401);
    }
    const blocked = await request(app).post('/api/auth/login').send({ email: 'a@b.com', password: 'wrong' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'Too many sign-in attempts. Please try again later.');
  });

  test('tracks limits independently per app instance', async () => {
    // createLoginRateLimiter() is a factory, not a shared singleton — two
    // instances (as createApp() makes for every test) must not share a
    // counter, or one test's login calls could 429 another test's.
    const limiter = () => createLoginRateLimiter({ limit: 1 });
    const appOne = express();
    appOne.use(express.json());
    appOne.post('/api/auth/login', limiter(), createLoginHandler(async () => ({ outcome: 'invalid_credentials' })));
    const appTwo = express();
    appTwo.use(express.json());
    appTwo.post('/api/auth/login', limiter(), createLoginHandler(async () => ({ outcome: 'invalid_credentials' })));

    assert.equal((await request(appOne).post('/api/auth/login').send({})).status, 401);
    assert.equal((await request(appTwo).post('/api/auth/login').send({})).status, 401);
  });
});
