import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logoutAccount, createLogoutHandler } from './auth/logout';

function fakeClient(options: { getUser?: () => Promise<any>; setSession?: () => Promise<any>; signOut?: () => Promise<any> }) {
  return {
    auth: {
      getUser: options.getUser ?? (async () => ({ data: { user: { id: 'user-1' } }, error: null })),
      setSession: options.setSession ?? (async () => ({ data: {}, error: null })),
      signOut: options.signOut ?? (async () => ({ error: null }))
    }
  } as unknown as SupabaseClient;
}

describe('logoutAccount', () => {
  test('verifies the access token, then revokes the session, when both tokens are present', async () => {
    let getUserCalledWith: string | undefined;
    let setSessionCalled = false;
    let signOutCalled = false;
    const client = fakeClient({
      getUser: async (...args: any[]) => {
        getUserCalledWith = args[0];
        return { data: { user: { id: 'user-1' } }, error: null };
      },
      setSession: async () => {
        setSessionCalled = true;
        return { data: {}, error: null };
      },
      signOut: async () => {
        signOutCalled = true;
        return { error: null };
      }
    });

    const result = await logoutAccount('access-1', { refreshToken: 'refresh-1' }, () => client);
    assert.deepEqual(result, { outcome: 'success' });
    assert.equal(getUserCalledWith, 'access-1');
    assert.equal(setSessionCalled, true);
    assert.equal(signOutCalled, true);
  });

  test('does not attempt revocation when the access token does not verify', async () => {
    let setSessionCalled = false;
    const client = fakeClient({
      getUser: async () => ({ data: { user: null }, error: { message: 'invalid JWT' } }),
      setSession: async () => {
        setSessionCalled = true;
        return { data: {}, error: null };
      }
    });

    const result = await logoutAccount('bad-token', { refreshToken: 'refresh-1' }, () => client);
    assert.deepEqual(result, { outcome: 'success' });
    assert.equal(setSessionCalled, false);
  });

  test('does not attempt revocation with no access token (unauthenticated request)', async () => {
    let getUserCalled = false;
    const client = fakeClient({
      getUser: async () => {
        getUserCalled = true;
        return { data: { user: { id: 'user-1' } }, error: null };
      }
    });

    const result = await logoutAccount(null, { refreshToken: 'refresh-1' }, () => client);
    assert.deepEqual(result, { outcome: 'success' });
    assert.equal(getUserCalled, false);
  });

  test('still succeeds when revocation itself throws', async () => {
    const client = fakeClient({
      setSession: async () => {
        throw new Error('network down');
      }
    });

    const result = await logoutAccount('access-1', { refreshToken: 'refresh-1' }, () => client);
    assert.deepEqual(result, { outcome: 'success' });
  });

  test('succeeds with no tokens and no client configured', async () => {
    const result = await logoutAccount(null, {}, () => null);
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

  test('treats an absent request body as empty input', async () => {
    const app = express();
    app.post(
      '/api/auth/logout',
      createLogoutHandler(async (_accessToken, input) => {
        assert.deepEqual(input, {});
        return { outcome: 'success' };
      })
    );
    const response = await request(app).post('/api/auth/logout');
    assert.equal(response.status, 200);
  });
});
