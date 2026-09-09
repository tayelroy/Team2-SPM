import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logoutAccount, createLogoutHandler } from './auth/logout';

describe('logoutAccount', () => {
  test('attempts server-side revocation when both tokens are present', async () => {
    let setSessionCalled = false;
    let signOutCalled = false;
    const client = {
      auth: {
        setSession: async () => {
          setSessionCalled = true;
          return { data: {}, error: null };
        },
        signOut: async () => {
          signOutCalled = true;
          return { error: null };
        }
      }
    } as unknown as SupabaseClient;

    const result = await logoutAccount({ accessToken: 'a', refreshToken: 'r' }, () => client);
    assert.deepEqual(result, { outcome: 'success' });
    assert.equal(setSessionCalled, true);
    assert.equal(signOutCalled, true);
  });

  test('still succeeds when revocation itself throws', async () => {
    const client = {
      auth: {
        setSession: async () => {
          throw new Error('network down');
        },
        signOut: async () => ({ error: null })
      }
    } as unknown as SupabaseClient;

    const result = await logoutAccount({ accessToken: 'a', refreshToken: 'r' }, () => client);
    assert.deepEqual(result, { outcome: 'success' });
  });

  test('succeeds with no tokens and no client configured', async () => {
    const result = await logoutAccount({}, () => null);
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
});
