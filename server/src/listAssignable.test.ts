import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createListAssignableHandler } from './events/listAssignable';
import type { FetchAssignableRequestsResult } from './db/eventRequests';
import type { ListCoordinatorsResult } from './db/accountRoles';

const REQUEST = {
  event_id: 7,
  name: 'Partner Forum',
  organisation: 'Acme',
  status: 'submitted',
  coordinator_id: null,
  coordinator_name: null
};
const COORDINATOR = { user_id: 'coord-1', name: 'Sarah Coordinator' };

interface HarnessOptions {
  admin?: SupabaseClient | null;
  requests?: FetchAssignableRequestsResult;
  coordinators?: ListCoordinatorsResult;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.get(
    '/api/event-requests/assignable',
    createListAssignableHandler({
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchRequests: async () => options.requests ?? { ok: true, requests: [REQUEST] },
      fetchCoordinators: async () => options.coordinators ?? { ok: true, coordinators: [COORDINATOR] }
    })
  );
  return app;
}

describe('GET /api/event-requests/assignable (SG2-33/SG2-34)', () => {
  test('returns the assignable requests and the coordinators to choose from', async () => {
    const response = await request(buildApp()).get('/api/event-requests/assignable');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { requests: [REQUEST], coordinators: [COORDINATOR] });
  });

  test('returns 503 when the database is not configured', async () => {
    const response = await request(buildApp({ admin: null })).get('/api/event-requests/assignable');
    assert.equal(response.status, 503);
  });

  test('returns 503 when the request lookup fails, without leaking the cause', async () => {
    const response = await request(
      buildApp({ requests: { ok: false, reason: 'unavailable', message: 'SENTINEL leak' } })
    ).get('/api/event-requests/assignable');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('returns 503 when the coordinator lookup fails, without leaking the cause', async () => {
    const response = await request(buildApp({ coordinators: { ok: false, error: 'SENTINEL leak' } })).get(
      '/api/event-requests/assignable'
    );
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('builds with its production defaults', () => {
    assert.equal(typeof createListAssignableHandler(), 'function');
  });
});

describe('GET /api/event-requests/assignable authorisation wiring', () => {
  const userId = '10000000-0000-4000-8000-000000000002';
  const originalConfig = { ...dbConfig };

  beforeEach(() => {
    dbConfig.supabaseUrl = 'https://auth-test.supabase.co';
    dbConfig.supabaseAnonKey = 'sb_publishable_test';
    dbConfig.supabaseServiceRoleKey = 'test-service-role';
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('Unexpected network request');
    });
  });

  afterEach(() => {
    mock.restoreAll();
    Object.assign(dbConfig, originalConfig);
  });

  /** Real PERMISSIONS policy; only the list handler (the 19th param) is stubbed. */
  const appForRole = (role: Role) => {
    const args: unknown[] = new Array(19).fill(undefined);
    args[1] = createAuthorization({ resolvePrincipal: async () => ({ userId, role }) });
    args[18] = (_req: unknown, res: express.Response) => {
      res.status(200).json({ reached: true });
    };
    return (createApp as (...a: unknown[]) => express.Express)(...args);
  };

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('technical_support_staff')).get('/api/event-requests/assignable');
    assert.equal(response.status, 401);
  });

  test('denies roles that cannot assign a coordinator', async () => {
    for (const role of ['event_organiser', 'event_coordinator', 'venue_staff', 'attendee'] as const) {
      const response = await request(appForRole(role))
        .get('/api/event-requests/assignable')
        .set('Authorization', 'Bearer token');
      assert.equal(response.status, 403, role);
    }
  });

  test('routes Technical Support Staff to the list, not to the single-request lookup', async () => {
    const response = await request(appForRole('technical_support_staff'))
      .get('/api/event-requests/assignable')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
