import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { AuthError, type SupabaseClient } from '@supabase/supabase-js';
import { logoutAccount, createLogoutHandler } from './auth/logout';
import { dbConfig } from './db/config';

const originalConfig = { ...dbConfig };
beforeEach(() => {
  dbConfig.supabaseUrl = undefined;
  dbConfig.supabaseAnonKey = undefined;
  dbConfig.supabaseServiceRoleKey = undefined;
  mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected outbound request'); });
});
afterEach(() => {
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
});

function fakeClient(signOut: SupabaseClient['auth']['admin']['signOut']): SupabaseClient {
  return { auth: { admin: { signOut } } } as unknown as SupabaseClient;
}

describe('POST /api/auth/logout success contract', () => {
  test('successfully revokes session and responds with 200 when SDK signOut succeeds', async () => {
    let passedToken: string | undefined;
    let passedScope: string | undefined;
    const client = fakeClient(async (token, scope) => {
      passedToken = token;
      passedScope = scope;
      return { data: null, error: null };
    });

    const app = express();
    app.post('/api/auth/logout', createLogoutHandler(token => logoutAccount(token, () => client)));

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer valid-session-token');

    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, { message: 'Signed out.' });
    assert.equal(passedToken, 'valid-session-token');
    assert.equal(passedScope, 'local');
  });
});

describe('POST /api/auth/logout failure and unauthenticated contracts', () => {
  for (const { name, getClient } of [
    { name: 'no client configured', getClient: () => null },
    { name: 'SDK returns an error', getClient: () => fakeClient(async () => ({
      data: null, error: new AuthError('PRIVATE_PROVIDER_ERROR'),
    })) },
    { name: 'SDK throws', getClient: () => fakeClient(async () => { throw new Error('PRIVATE_PROVIDER_ERROR'); }) },
  ]) test(`reports unconfirmed revocation when ${name}`, async () => {
    const app = express();
    app.post('/api/auth/logout', createLogoutHandler(token => logoutAccount(token, getClient)));
    const response = await request(app).post('/api/auth/logout').set('Authorization', 'Bearer current-token');
    assert.equal(response.status, 503);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body, { error: 'Unable to confirm server sign-out.' });
  });

  test('missing or malformed authorization is idempotent and cannot revoke a body-supplied session', async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/auth/logout', createLogoutHandler(token => logoutAccount(token, () => {
      assert.fail('Unauthenticated logout must not call the provider');
    })));
    for (const authorization of [undefined, 'Basic invalid', 'Bearer ']) {
      const req = request(app).post('/api/auth/logout');
      if (authorization !== undefined) req.set('Authorization', authorization);
      req.send({ accessToken: 'someone-else' });
      const response = await req;
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.body, { message: 'Signed out.' });
    }
  });
});

describe('logout with an unconfigured default provider', () => {
  test('logoutAccount returns success when accessToken is null without calling getClient', async () => {
    const result = await logoutAccount(null, () => {
      assert.fail('getClient should not be called when token is null');
    });
    assert.deepEqual(result, { outcome: 'success' });
  });

  test('the default provider reports unconfirmed revocation when no database is configured', async () => {
    // getSupabaseAdminClient returns null in test environment where DB is unconfigured
    const result = await logoutAccount('session-token');
    assert.deepEqual(result, { outcome: 'unavailable' });
  });

  test('the default handler keeps anonymous logout idempotent and reports unavailable authenticated logout', async () => {
    const app = express();
    app.post('/api/auth/logout', createLogoutHandler());

    // Without authorization header, default logoutAccount(null) succeeds
    const unauthResponse = await request(app).post('/api/auth/logout');
    assert.equal(unauthResponse.status, 200);
    assert.equal(unauthResponse.headers['cache-control'], 'no-store');
    assert.deepEqual(unauthResponse.body, { message: 'Signed out.' });

    // With bearer token, default getSupabaseAdminClient is unconfigured in test environment -> 503
    const authResponse = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', 'Bearer session-token');
    assert.equal(authResponse.status, 503);
    assert.equal(authResponse.headers['cache-control'], 'no-store');
    assert.deepEqual(authResponse.body, { error: 'Unable to confirm server sign-out.' });
  });
});
