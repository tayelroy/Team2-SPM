import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMeHandler } from './auth/me';

function fakeClients(options: { getUser?: () => Promise<any>; userRow?: any; roleRow?: any }) {
  const anon = {
    auth: {
      getUser:
        options.getUser ?? (async () => ({ data: { user: { id: 'user-1', email: 'ada@example.com' } }, error: null }))
    }
  } as unknown as SupabaseClient;

  const admin = {
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

  return { anon, admin };
}

describe('GET /api/auth/me', () => {
  test('returns 401 with no Authorization header', async () => {
    const app = express();
    app.get('/api/auth/me', createMeHandler(() => null, () => null));
    const response = await request(app).get('/api/auth/me');
    assert.equal(response.status, 401);
  });

  test('returns the caller on a valid token', async () => {
    const { anon, admin } = fakeClients({});
    const app = express();
    app.get('/api/auth/me', createMeHandler(() => anon, () => admin));
    const response = await request(app).get('/api/auth/me').set('Authorization', 'Bearer valid-token');
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.body.user, {
      userId: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      organisation: 'Org',
      role: 'Attendee'
    });
  });

  test('returns 401 for an invalid token', async () => {
    const { anon, admin } = fakeClients({
      getUser: async () => ({ data: { user: null }, error: { message: 'bad' } })
    });
    const app = express();
    app.get('/api/auth/me', createMeHandler(() => anon, () => admin));
    const response = await request(app).get('/api/auth/me').set('Authorization', 'Bearer bad-token');
    assert.equal(response.status, 401);
  });

  test('returns 403 for a valid token with no account row', async () => {
    const { anon, admin } = fakeClients({ userRow: { data: null, error: null } });
    const app = express();
    app.get('/api/auth/me', createMeHandler(() => anon, () => admin));
    const response = await request(app).get('/api/auth/me').set('Authorization', 'Bearer valid-token');
    assert.equal(response.status, 403);
  });

  test('returns 503 when Supabase is not configured', async () => {
    const app = express();
    app.get('/api/auth/me', createMeHandler(() => null, () => null));
    const response = await request(app).get('/api/auth/me').set('Authorization', 'Bearer valid-token');
    assert.equal(response.status, 503);
  });
});
