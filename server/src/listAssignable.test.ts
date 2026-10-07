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
  test('[NORMAL] [SG2-33:AC1] [SG2-34:AC1] returns the assignable requests and the coordinators to choose from', async () => {
    const response = await request(buildApp()).get('/api/event-requests/assignable');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { requests: [REQUEST], coordinators: [COORDINATOR] });
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 when the database is not configured', async () => {
    const response = await request(buildApp({ admin: null })).get('/api/event-requests/assignable');
    assert.equal(response.status, 503);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 when the request lookup fails, without leaking the cause', async () => {
    const response = await request(
      buildApp({ requests: { ok: false, reason: 'unavailable', message: 'SENTINEL leak' } })
    ).get('/api/event-requests/assignable');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 when the coordinator lookup fails, without leaking the cause', async () => {
    const response = await request(buildApp({ coordinators: { ok: false, error: 'SENTINEL leak' } })).get(
      '/api/event-requests/assignable'
    );
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] the default handler returns a retryable response when the database is unconfigured', async (t) => {
    const previous = { ...dbConfig };
    t.after(() => Object.assign(dbConfig, previous));
    dbConfig.supabaseUrl = undefined;
    dbConfig.supabaseAnonKey = undefined;
    dbConfig.supabaseServiceRoleKey = undefined;
    const app = express();
    app.get('/api/event-requests/assignable', createListAssignableHandler());
    const response = await request(app).get('/api/event-requests/assignable');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'Event requests are temporarily unavailable. Please try again later.'
    });
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

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_coordinator_lead')).get('/api/event-requests/assignable');
    assert.equal(response.status, 401);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] [SG2-97:AC1] denies roles that cannot assign a coordinator, Technical Support Staff included', async () => {
    for (const role of ['event_organiser', 'event_coordinator', 'venue_staff', 'attendee', 'technical_support_staff', 'safety_officer'] as const) {
      const response = await request(appForRole(role))
        .get('/api/event-requests/assignable')
        .set('Authorization', 'Bearer token');
      assert.equal(response.status, 403, role);
    }
  });

  test('[NORMAL] [SG2-33:AC1] [SG2-34:AC1] [SG2-97:AC4] routes the Event Coordinator Lead to the list, not to the single-request lookup', async () => {
    const response = await request(appForRole('event_coordinator_lead'))
      .get('/api/event-requests/assignable')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
