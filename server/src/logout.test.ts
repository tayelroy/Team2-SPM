import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import { AuthError, type SupabaseClient } from '@supabase/supabase-js';
import { logoutAccount, createLogoutHandler } from './auth/logout';

function fakeClient(signOut: SupabaseClient['auth']['admin']['signOut']): SupabaseClient {
  return { auth: { admin: { signOut } } } as unknown as SupabaseClient;
}

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
    for (const authorization of [undefined, 'Basic invalid']) {
      const req = request(app).post('/api/auth/logout');
      if (authorization) req.set('Authorization', authorization).send({ accessToken: 'someone-else' });
      const response = await req;
      assert.equal(response.status, 200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(response.body, { message: 'Signed out.' });
    }
  });
});
