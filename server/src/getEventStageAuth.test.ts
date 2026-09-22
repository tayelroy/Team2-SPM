import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';

const userId = '10000000-0000-4000-8000-000000000001';
const originalConfig = { ...dbConfig };

describe('GET /api/event-requests/:eventId/stage authorisation wiring (SG2-38)', () => {
  beforeEach(() => {
    dbConfig.supabaseUrl = 'https://auth-test.supabase.co';
    dbConfig.supabaseAnonKey = 'sb_publishable_test';
    dbConfig.supabaseServiceRoleKey = 'ADMIN_SECRET_SENTINEL';
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('Unexpected network request');
    });
  });

  afterEach(() => {
    mock.restoreAll();
    Object.assign(dbConfig, originalConfig);
  });

  const appForRole = (role: Role) =>
    createApp(
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ route: 'stage', reached: true });
      }
    );

  test('rejects unauthenticated request with 401', async () => {
    const res = await request(appForRole('event_organiser')).get('/api/event-requests/101/stage');
    assert.equal(res.status, 401);
    assert.equal(res.headers['www-authenticate'], 'Bearer');
  });

  test('denies attendee role with 403 Forbidden', async () => {
    const res = await request(appForRole('attendee'))
      .get('/api/event-requests/101/stage')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 403);
  });

  test('allows event_organiser role to reach handler', async () => {
    const res = await request(appForRole('event_organiser'))
      .get('/api/event-requests/101/stage')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });

  test('allows event_coordinator role to reach handler', async () => {
    const res = await request(appForRole('event_coordinator'))
      .get('/api/event-requests/101/stage')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });

  test('allows venue_staff role to reach handler', async () => {
    const res = await request(appForRole('venue_staff'))
      .get('/api/event-requests/101/stage')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });

  test('allows technical_support_staff role to reach handler', async () => {
    const res = await request(appForRole('technical_support_staff'))
      .get('/api/event-requests/101/stage')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });
});
