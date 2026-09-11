import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logoutAccount, createLogoutHandler } from './auth/logout';

function fakeClient(options: { signOut?: (jwt: string) => Promise<any> }) {
  return {
    auth: {
      admin: {
        signOut: options.signOut ?? (async () => ({ data: {}, error: null }))
      }
    }
  } as unknown as SupabaseClient;
}

describe('logoutAccount', () => {
  test('revokes the session tied to the access token via the admin API', async () => {
    let signOutCalledWith: string | undefined;
    const client = fakeClient({
      signOut: async (jwt) => {
        signOutCalledWith = jwt;
        return { data: {}, error: null };
      }
    });

    const result = await logoutAccount('access-1', () => client);
    assert.deepEqual(result, { outcome: 'success' });
    assert.equal(signOutCalledWith, 'access-1');
  });

  test('does not attempt revocation with no access token (unauthenticated request)', async () => {
    let signOutCalled = false;
    const client = fakeClient({
      signOut: async () => {
        signOutCalled = true;
        return { data: {}, error: null };
      }
    });

    const result = await logoutAccount(null, () => client);
    assert.deepEqual(result, { outcome: 'success' });
    assert.equal(signOutCalled, false);
  });

  test('still succeeds when revocation itself throws', async () => {
    const client = fakeClient({
      signOut: async () => {
        throw new Error('network down');
      }
    });

    const result = await logoutAccount('access-1', () => client);
    assert.deepEqual(result, { outcome: 'success' });
  });

  test('succeeds with no access token and no client configured', async () => {
    const result = await logoutAccount(null, () => null);
    assert.deepEqual(result, { outcome: 'success' });
  });

  test('succeeds with an access token but no client configured', async () => {
    const result = await logoutAccount('access-1', () => null);
    assert.deepEqual(result, { outcome: 'success' });
  });
});

describe('POST /api/auth/logout', () => {
  test('always returns 200', async () => {
    const app = express();
    app.use(express.json());
    app.post('/api/auth/logout', createLogoutHandler(async () => ({ outcome: 'success' })));
    const response = await request(app).post('/api/auth/logout').send({});
    assert.equal(response.status, 200);
  });

  test('passes the bearer token from the Authorization header, not the body', async () => {
    let receivedToken: string | null | undefined;
    const app = express();
    app.use(express.json());
    app.post(
      '/api/auth/logout',
      createLogoutHandler(async (accessToken) => {
        receivedToken = accessToken;
        return { outcome: 'success' };
      })
    );
    await request(app).post('/api/auth/logout').set('Authorization', 'Bearer real-token').send({ accessToken: 'spoofed-token' });
    assert.equal(receivedToken, 'real-token');
  });

  test('passes null when there is no Authorization header', async () => {
    let receivedToken: string | null | undefined = 'unset';
    const app = express();
    app.use(express.json());
    app.post(
      '/api/auth/logout',
      createLogoutHandler(async (accessToken) => {
        receivedToken = accessToken;
        return { outcome: 'success' };
      })
    );
    await request(app).post('/api/auth/logout').send({});
    assert.equal(receivedToken, null);
  });

  test('returns 200 with no request body at all', async () => {
    const app = express();
    app.post('/api/auth/logout', createLogoutHandler(async () => ({ outcome: 'success' })));
    const response = await request(app).post('/api/auth/logout');
    assert.equal(response.status, 200);
  });
});
