import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role, Principal } from './auth/policy';
import { dbConfig } from './db/config';
import { getEventRequestsHandler, getEventRequestDetailHandler } from './events/list';
import type {
  EventRequestSummaryRecord,
  EventRequestRecord,
  FetchEventRequestsResult,
  FetchEventRequestResult
} from './db/eventRequests';

const ORGANISER: Principal = {
  userId: '10000000-0000-4000-8000-000000000001',
  role: 'event_organiser'
};

const SAMPLE_SUMMARY: EventRequestSummaryRecord = {
  event_id: 101,
  name: 'Leadership Retreat',
  proposed_date: '2026-11-15T09:00:00.000Z',
  status: 'draft',
  coordinator_id: '20000000-0000-4000-8000-000000000002',
  coordinator_name: 'Sarah Coordinator'
};

const SAMPLE_DETAIL: EventRequestRecord = {
  event_id: 101,
  organiser_id: '10000000-0000-4000-8000-000000000001',
  organisation: 'Acme Corp',
  status: 'draft',
  name: 'Leadership Retreat',
  purpose: 'Annual executive retreat',
  description: 'Three-day planning retreat',
  proposed_date: '2026-11-15T09:00:00.000Z',
  expected_attendance: 50,
  venue_requirements: 'Auditorium with AV',
  accessibility_needs: 'Step-free access',
  equipment_requirements: 'Projector',
  registration_needed: true,
  coordinator_id: '20000000-0000-4000-8000-000000000002',
  coordinator_name: 'Sarah Coordinator'
};

interface ListHarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  listResult?: FetchEventRequestsResult;
  captureList?: (organiserId: string, statusFilter?: string) => void;
}

function buildListApp(options: ListHarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.get(
    '/api/event-requests',
    getEventRequestsHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchRequests: async (_admin, organiserId, statusFilter) => {
        options.captureList?.(organiserId, statusFilter);
        return options.listResult ?? { ok: true, requests: [SAMPLE_SUMMARY] };
      }
    })
  );
  return app;
}

interface DetailHarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  detailResult?: FetchEventRequestResult;
  captureDetail?: (eventId: number, organiserId: string) => void;
}

function buildDetailApp(options: DetailHarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.get(
    '/api/event-requests/:eventId',
    getEventRequestDetailHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchOwnRequest: async (_admin, eventId, organiserId) => {
        options.captureDetail?.(eventId, organiserId);
        return options.detailResult ?? { ok: true, request: SAMPLE_DETAIL };
      }
    })
  );
  return app;
}

describe('GET /api/event-requests (SG2-31)', () => {
  test('returns 200 with list of requests owned by the authenticated organiser', async () => {
    let capturedOrganiser: string | undefined;
    let capturedFilter: string | undefined;

    const response = await request(
      buildListApp({
        captureList: (orgId, filter) => {
          capturedOrganiser = orgId;
          capturedFilter = filter;
        }
      })
    ).get('/api/event-requests');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { requests: [SAMPLE_SUMMARY] });
    assert.equal(capturedOrganiser, ORGANISER.userId);
    assert.equal(capturedFilter, undefined);
  });

  test('applies valid status filter when provided in query', async () => {
    let capturedFilter: string | undefined;

    const response = await request(
      buildListApp({
        captureList: (_orgId, filter) => {
          capturedFilter = filter;
        }
      })
    ).get('/api/event-requests?status=draft');

    assert.equal(response.status, 200);
    assert.equal(capturedFilter, 'draft');
  });

  test('normalizes status query filter case and whitespace', async () => {
    let capturedFilter: string | undefined;

    const response = await request(
      buildListApp({
        captureList: (_orgId, filter) => {
          capturedFilter = filter;
        }
      })
    ).get('/api/event-requests?status=%20SUBMITTED%20');

    assert.equal(response.status, 200);
    assert.equal(capturedFilter, 'submitted');
  });

  test('treats status=all as no filter', async () => {
    let capturedFilter: string | undefined = 'initial';

    const response = await request(
      buildListApp({
        captureList: (_orgId, filter) => {
          capturedFilter = filter;
        }
      })
    ).get('/api/event-requests?status=all');

    assert.equal(response.status, 200);
    assert.equal(capturedFilter, undefined);
  });

  test('returns 400 for an invalid status filter', async () => {
    const response = await request(buildListApp()).get('/api/event-requests?status=not_a_valid_status');
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Invalid status filter.' });
  });

  test('returns 400 for non-string status query parameter', async () => {
    const response = await request(buildListApp()).get('/api/event-requests?status[]=draft');
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Invalid status filter.' });
  });

  test('treats blank status query as no filter', async () => {
    let capturedFilter: string | undefined = 'initial';
    const response = await request(
      buildListApp({
        captureList: (_orgId, filter) => {
          capturedFilter = filter;
        }
      })
    ).get('/api/event-requests?status=%20%20');

    assert.equal(response.status, 200);
    assert.equal(capturedFilter, undefined);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildListApp({ principal: undefined })).get('/api/event-requests');
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildListApp({ admin: null })).get('/api/event-requests');
    assert.equal(response.status, 503);
  });

  test('returns 503 when fetchRequests fails', async () => {
    const response = await request(
      buildListApp({ listResult: { ok: false, reason: 'unavailable', message: 'DB down' } })
    ).get('/api/event-requests');
    assert.equal(response.status, 503);
  });
});

describe('GET /api/event-requests/:eventId (SG2-31)', () => {
  test('returns 200 with request detail for an owned event', async () => {
    let capturedEventId: number | undefined;
    let capturedOrganiser: string | undefined;

    const response = await request(
      buildDetailApp({
        captureDetail: (eventId, orgId) => {
          capturedEventId = eventId;
          capturedOrganiser = orgId;
        }
      })
    ).get('/api/event-requests/101');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { request: SAMPLE_DETAIL });
    assert.equal(capturedEventId, 101);
    assert.equal(capturedOrganiser, ORGANISER.userId);
  });

  test('returns 400 for non-numeric or non-positive eventId', async () => {
    const nonNumeric = await request(buildDetailApp()).get('/api/event-requests/abc');
    assert.equal(nonNumeric.status, 400);

    const nonPositive = await request(buildDetailApp()).get('/api/event-requests/0');
    assert.equal(nonPositive.status, 400);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildDetailApp({ principal: undefined })).get(
      '/api/event-requests/101'
    );
    assert.equal(response.status, 401);
  });

  test('returns 404 when request is not found or owned by someone else (TC-SG2-31-05)', async () => {
    const response = await request(
      buildDetailApp({ detailResult: { ok: false, reason: 'not_found', message: 'No event' } })
    ).get('/api/event-requests/999');

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'No event request found for this account.' });
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildDetailApp({ admin: null })).get('/api/event-requests/101');
    assert.equal(response.status, 503);
  });

  test('returns 503 when fetchOwnRequest fails with unavailable', async () => {
    const response = await request(
      buildDetailApp({ detailResult: { ok: false, reason: 'unavailable', message: 'DB down' } })
    ).get('/api/event-requests/101');
    assert.equal(response.status, 503);
  });
});

describe('Authorisation wiring for event_request.view (SG2-31)', () => {
  const userId = '10000000-0000-4000-8000-000000000001';
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
      (_req, res) => {
        res.status(200).json({ listReached: true });
      },
      (_req, res) => {
        res.status(200).json({ detailReached: true });
      }
    );

  test('rejects unauthenticated requests to GET /api/event-requests', async () => {
    const response = await request(appForRole('event_organiser')).get('/api/event-requests');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('rejects unauthenticated requests to GET /api/event-requests/:eventId', async () => {
    const response = await request(appForRole('event_organiser')).get('/api/event-requests/101');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('allows event_organiser to access GET /api/event-requests', async () => {
    const response = await request(appForRole('event_organiser'))
      .get('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.listReached, true);
  });

  test('allows event_coordinator to access GET /api/event-requests', async () => {
    const response = await request(appForRole('event_coordinator'))
      .get('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.listReached, true);
  });

  test('allows event_organiser to access GET /api/event-requests/:eventId', async () => {
    const response = await request(appForRole('event_organiser'))
      .get('/api/event-requests/101')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.detailReached, true);
  });

  test('allows event_coordinator to access GET /api/event-requests/:eventId', async () => {
    const response = await request(appForRole('event_coordinator'))
      .get('/api/event-requests/101')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.detailReached, true);
  });

  for (const role of ['attendee', 'venue_staff', 'technical_support_staff'] as const) {
    test(`denies ${role} without event_request.view permission`, async () => {
      const listRes = await request(appForRole(role))
        .get('/api/event-requests')
        .set('Authorization', 'Bearer token');
      assert.equal(listRes.status, 403);

      const detailRes = await request(appForRole(role))
        .get('/api/event-requests/101')
        .set('Authorization', 'Bearer token');
      assert.equal(detailRes.status, 403);
    });
  }
});
