import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../app';
import { createAuthorization } from '../auth';
import { PERMISSIONS, type Principal, type Role } from '../auth/policy';
import { dbConfig } from '../db/config';
import {
  createGetEventHistoryHandler,
  type GetEventHistoryDependencies
} from './getHistory';
import type { EventAuditLogRecord, FetchEventAuditLogsResult } from '../db/auditLogs';
import type { FetchEventRequestResult, EventRequestRecord } from '../db/eventRequests';

const ORGANISER_ID = '10000000-0000-4000-8000-000000000001';
const UNRELATED_ORGANISER_ID = '20000000-0000-4000-8000-000000000002';
const COORDINATOR_ID = '30000000-0000-4000-8000-000000000003';
const VENUE_STAFF_ID = '40000000-0000-4000-8000-000000000004';
const TECH_SUPPORT_ID = '50000000-0000-4000-8000-000000000005';
const ATTENDEE_ID = '60000000-0000-4000-8000-000000000006';

const ORGANISER: Principal = { userId: ORGANISER_ID, role: 'event_organiser' };
const UNRELATED_ORGANISER: Principal = { userId: UNRELATED_ORGANISER_ID, role: 'event_organiser' };
const COORDINATOR: Principal = { userId: COORDINATOR_ID, role: 'event_coordinator' };
const VENUE_STAFF: Principal = { userId: VENUE_STAFF_ID, role: 'venue_staff' };
const TECH_SUPPORT: Principal = { userId: TECH_SUPPORT_ID, role: 'technical_support_staff' };
const ATTENDEE: Principal = { userId: ATTENDEE_ID, role: 'attendee' };

const BASE_EVENT_REQUEST: EventRequestRecord = {
  event_id: 101,
  organiser_id: ORGANISER_ID,
  organisation: 'Acme Corp',
  name: 'Annual Tech Summit',
  proposed_date: '2026-11-15T09:00:00.000Z',
  status: 'planning',
  expected_attendance: 200,
  coordinator_id: COORDINATOR_ID,
  coordinator_name: 'Alex Coordinator'
};

const SAMPLE_LOGS: EventAuditLogRecord[] = [
  {
    log_id: 2,
    event_id: 101,
    actor_id: COORDINATOR_ID,
    actor_name: 'Alex Coordinator',
    field_name: 'expected_attendance',
    old_value: '200',
    new_value: '250',
    created_at: '2026-09-25T14:30:00.000Z'
  },
  {
    log_id: 1,
    event_id: 101,
    actor_id: COORDINATOR_ID,
    actor_name: 'Alex Coordinator',
    field_name: 'proposed_date',
    old_value: '2026-11-10T09:00:00.000Z',
    new_value: '2026-11-15T09:00:00.000Z',
    created_at: '2026-09-25T14:00:00.000Z'
  }
];

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  eventResult?: FetchEventRequestResult;
  historyResult?: FetchEventAuditLogsResult;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.get(
    '/api/event-requests/:eventId/history',
    createGetEventHistoryHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchEventRequest: async (_admin, eventId) => {
        if (options.eventResult) return options.eventResult;
        return { ok: true, request: { ...BASE_EVENT_REQUEST, event_id: eventId } };
      },
      fetchAuditLogs: async (_admin, _eventId) => {
        if (options.historyResult) return options.historyResult;
        return { ok: true, logs: SAMPLE_LOGS };
      }
    })
  );
  return app;
}

describe('GET /api/event-requests/:eventId/history Handler Logic (SG2-40)', () => {
  describe('RBAC & Access Restriction (AC 3)', () => {
    test('rejects unauthenticated request with 401', async () => {
      const app = buildApp({ principal: undefined });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 401);
      assert.match(res.body.error, /authentication required/i);
    });

    test('denies attendee role with 403 Forbidden', async () => {
      const app = buildApp({ principal: ATTENDEE });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'Attendees are not authorized to view change history.');
    });

    test('denies unrelated event organiser with 403 Forbidden', async () => {
      const app = buildApp({ principal: UNRELATED_ORGANISER });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'You are not authorized to view the change history of this event.');
    });

    test('allows owning event organiser to retrieve history with 200', async () => {
      const app = buildApp({ principal: ORGANISER });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.equal(res.body.event_id, 101);
      assert.equal(res.body.history.length, 2);
    });

    test('allows event coordinator to retrieve history with 200', async () => {
      const app = buildApp({ principal: COORDINATOR });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.equal(res.body.event_id, 101);
      assert.equal(res.body.history.length, 2);
    });

    test('allows venue staff to retrieve history with 200', async () => {
      const app = buildApp({ principal: VENUE_STAFF });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.equal(res.body.event_id, 101);
    });

    test('allows technical support staff to retrieve history with 200', async () => {
      const app = buildApp({ principal: TECH_SUPPORT });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.equal(res.body.event_id, 101);
    });
  });

  describe('Validation & Error Handling', () => {
    test('returns 400 for non-integer or negative or invalid eventId', async () => {
      for (const invalidId of ['abc', '0', '-5', '1.5']) {
        const app = buildApp();
        const res = await request(app).get(`/api/event-requests/${invalidId}/history`);
        assert.equal(res.status, 400);
        assert.match(res.body.error, /positive integer/i);
      }
    });

    test('returns 503 when admin client is unavailable', async () => {
      const app = buildApp({ admin: null });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 503);
      assert.match(res.body.error, /temporarily unavailable/i);
    });

    test('returns 404 when event request does not exist', async () => {
      const app = buildApp({
        eventResult: { ok: false, reason: 'not_found', message: 'Not found' }
      });
      const res = await request(app).get('/api/event-requests/999/history');
      assert.equal(res.status, 404);
      assert.match(res.body.error, /event not found/i);
    });

    test('returns 503 when fetching event request fails', async () => {
      const app = buildApp({
        eventResult: { ok: false, reason: 'unavailable', message: 'DB down' }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 503);
      assert.match(res.body.error, /temporarily unavailable/i);
    });

    test('returns 503 when fetching audit logs fails', async () => {
      const app = buildApp({
        historyResult: { ok: false, reason: 'unavailable', message: 'DB error' }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 503);
      assert.match(res.body.error, /temporarily unavailable/i);
    });
  });

  describe('Payload & Ordering (AC 1 & AC 2)', () => {
    test('returns empty history array when event has no audit logs', async () => {
      const app = buildApp({
        historyResult: { ok: true, logs: [] }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        event_id: 101,
        history: []
      });
    });

    test('returns full history in reverse chronological order with resolved actor names and diffs', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.equal(res.body.event_id, 101);
      assert.equal(res.body.history.length, 2);

      // Verify newest entry is first
      assert.equal(res.body.history[0].log_id, 2);
      assert.equal(res.body.history[0].actor_name, 'Alex Coordinator');
      assert.equal(res.body.history[0].field_name, 'expected_attendance');
      assert.equal(res.body.history[0].old_value, '200');
      assert.equal(res.body.history[0].new_value, '250');
      assert.equal(res.body.history[0].created_at, '2026-09-25T14:30:00.000Z');

      // Verify second entry
      assert.equal(res.body.history[1].log_id, 1);
      assert.equal(res.body.history[1].actor_name, 'Alex Coordinator');
      assert.equal(res.body.history[1].field_name, 'proposed_date');
      assert.equal(res.body.history[1].old_value, '2026-11-10T09:00:00.000Z');
      assert.equal(res.body.history[1].new_value, '2026-11-15T09:00:00.000Z');
      assert.equal(res.body.history[1].created_at, '2026-09-25T14:00:00.000Z');
    });

    test('falls back actor_name to Unknown if actor_name is null', async () => {
      const app = buildApp({
        historyResult: {
          ok: true,
          logs: [
            {
              log_id: 1,
              event_id: 101,
              actor_id: 'unknown-id',
              actor_name: null,
              field_name: 'venue_requirements',
              old_value: null,
              new_value: 'Stage setup',
              created_at: '2026-09-25T12:00:00.000Z'
            }
          ]
        }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.equal(res.body.history[0].actor_name, 'Unknown');
    });
  });
});

describe('GET /api/event-requests/:eventId/history Integration & Authorisation Wiring', () => {
  const originalConfig = { ...dbConfig };

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

  test('policy grants event_request.history.view to organisers and internal staff, excluding attendees', () => {
    const rolesWithPermission = PERMISSIONS['event_request.history.view'];
    assert.ok(rolesWithPermission, 'event_request.history.view permission must exist');
    assert.deepEqual([...rolesWithPermission].sort(), [
      'event_coordinator',
      'event_organiser',
      'technical_support_staff',
      'venue_staff'
    ]);
  });

  const appForRole = (role: Role) =>
    createApp(
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) }),
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
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ route: 'history', reached: true });
      }
    );

  test('rejects unauthenticated request on app route with 401', async () => {
    const res = await request(appForRole('event_coordinator')).get('/api/event-requests/101/history');
    assert.equal(res.status, 401);
    assert.equal(res.headers['www-authenticate'], 'Bearer');
  });

  test('denies attendee role with 403 Forbidden on app route', async () => {
    const res = await request(appForRole('attendee'))
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 403);
  });

  test('allows event_coordinator role to reach mounted history handler on app route', async () => {
    const res = await request(appForRole('event_coordinator'))
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });

  test('allows event_organiser role to reach mounted history handler on app route', async () => {
    const res = await request(appForRole('event_organiser'))
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });

  test('allows venue_staff role to reach mounted history handler on app route', async () => {
    const res = await request(appForRole('venue_staff'))
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });

  test('allows technical_support_staff role to reach mounted history handler on app route', async () => {
    const res = await request(appForRole('technical_support_staff'))
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.reached, true);
  });
});
