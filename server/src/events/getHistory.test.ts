import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../app';
import { createAuthorization } from '../auth';
import { INTERNAL_ONLY_AUDIT_FIELDS, PERMISSIONS, type Principal, type Role } from '../auth/policy';
import { dbConfig } from '../db/config';
import { createGetEventHistoryHandler } from './getHistory';
import type { EventAuditLogRecord, FetchEventAuditLogsResult } from '../db/auditLogs';
import type { FetchEventRequestResult, EventRequestRecord } from '../db/eventRequests';
import type { GetAccountRolesResult } from '../db/accountRoles';

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
  coordinator_name: 'Alex Coordinator',
  purpose: 'Annual gathering',
  description: 'A great tech summit',
  venue_requirements: 'Large hall with projector',
  accessibility_needs: 'Wheelchair ramp',
  equipment_requirements: '2 mics, 1 projector',
  registration_needed: true
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

/** What the API returns for SAMPLE_LOGS: the actor's role in Title Case. */
const SAMPLE_HISTORY = [
  {
    log_id: 2,
    event_id: 101,
    actor_id: COORDINATOR_ID,
    actor_name: 'Alex Coordinator',
    actor_role: 'Event Coordinator',
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
    actor_role: 'Event Coordinator',
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
  rolesResult?: GetAccountRolesResult;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  const fetchEventRequest = mock.fn(async (_admin: SupabaseClient, eventId: number): Promise<FetchEventRequestResult> => {
    if (options.eventResult) return options.eventResult;
    return { ok: true, request: { ...BASE_EVENT_REQUEST, event_id: eventId } };
  });
  const fetchAuditLogs = mock.fn(async (_admin: SupabaseClient, _eventId: number): Promise<FetchEventAuditLogsResult> => {
    if (options.historyResult) return options.historyResult;
    return { ok: true, logs: SAMPLE_LOGS };
  });
  const fetchActorRoles = mock.fn(async (_admin: SupabaseClient, _userIds: string[]): Promise<GetAccountRolesResult> =>
    options.rolesResult ?? { ok: true, roles: new Map([[COORDINATOR_ID, 'event_coordinator']]) });
  app.get(
    '/api/event-requests/:eventId/history',
    createGetEventHistoryHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchEventRequest,
      fetchAuditLogs,
      fetchActorRoles
    })
  );
  return { app, fetchEventRequest, fetchAuditLogs, fetchActorRoles };
}

describe('GET /api/event-requests/:eventId/history Handler Logic (SG2-40)', () => {
  describe('RBAC & Access Restriction (AC 3)', () => {
    test('[FAILURE] [SG2-40:authentication] [SG2-25:AC3] rejects unauthenticated request with 401 before database reads', async () => {
      const { app, fetchEventRequest, fetchAuditLogs } = buildApp({ principal: undefined });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { error: 'Authentication required' });
      assert.equal(fetchEventRequest.mock.callCount(), 0);
      assert.equal(fetchAuditLogs.mock.callCount(), 0);
    });

    test('[FAILURE] [SG2-40:AC3] denies attendee role with 403 Forbidden and performs zero event or audit reads', async () => {
      const { app, fetchEventRequest, fetchAuditLogs } = buildApp({ principal: ATTENDEE });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'Attendees are not authorized to view change history.');
      assert.equal(fetchEventRequest.mock.calls.length, 0);
      assert.equal(fetchAuditLogs.mock.calls.length, 0);
    });

    test('[FAILURE] [SG2-40:AC3] denies unrelated event organiser with 403 Forbidden and performs zero audit reads', async () => {
      const { app, fetchEventRequest, fetchAuditLogs } = buildApp({ principal: UNRELATED_ORGANISER });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 403);
      assert.equal(res.body.error, 'You are not authorized to view the change history of this event.');
      assert.equal(fetchEventRequest.mock.callCount(), 1);
      assert.equal(fetchEventRequest.mock.calls[0].arguments[1], 101);
      assert.equal(fetchAuditLogs.mock.calls.length, 0);
    });

    test('[NORMAL] [SG2-40:AC1] [SG2-40:AC2] allows owning event organiser to retrieve history with 200', async () => {
      const { app, fetchEventRequest, fetchAuditLogs } = buildApp({ principal: ORGANISER });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event_id: 101, history: SAMPLE_HISTORY });
      assert.equal(fetchEventRequest.mock.callCount(), 1);
      assert.equal(fetchAuditLogs.mock.callCount(), 1);
      assert.equal(fetchEventRequest.mock.calls[0].arguments[1], 101);
      assert.equal(fetchAuditLogs.mock.calls[0].arguments[1], 101);
    });

    test('[NORMAL] [SG2-40:AC1] [SG2-40:AC2] allows event coordinator to retrieve history with 200', async () => {
      const { app } = buildApp({ principal: COORDINATOR });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event_id: 101, history: SAMPLE_HISTORY });
    });

    test('[NORMAL] [SG2-40:AC1] [SG2-40:AC2] allows venue staff to retrieve history with 200', async () => {
      const { app } = buildApp({ principal: VENUE_STAFF });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event_id: 101, history: SAMPLE_HISTORY });
    });

    test('[NORMAL] [SG2-40:AC1] [SG2-40:AC2] allows technical support staff to retrieve history with 200', async () => {
      const { app } = buildApp({ principal: TECH_SUPPORT });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event_id: 101, history: SAMPLE_HISTORY });
    });
  });

  describe('Internal-only planning notes (AC 3)', () => {
    const NOTES_LOG: EventAuditLogRecord = {
      log_id: 3,
      event_id: 101,
      actor_id: COORDINATOR_ID,
      actor_name: 'Alex Coordinator',
      field_name: 'planning_notes',
      old_value: null,
      new_value: 'Client is difficult about catering',
      created_at: '2026-09-25T15:00:00.000Z'
    };

    test('[NORMAL] [SG2-40:AC3] policy marks planning notes as the only internal-only history field', () => {
      assert.deepEqual([...INTERNAL_ONLY_AUDIT_FIELDS], ['planning_notes']);
    });

    test('[FAILURE] [SG2-40:AC3] owning organiser never receives planning-notes entries, while their other changes keep their order', async () => {
      const { app } = buildApp({ principal: ORGANISER, historyResult: { ok: true, logs: [NOTES_LOG, ...SAMPLE_LOGS] } });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event_id: 101, history: SAMPLE_HISTORY });
      assert.equal(JSON.stringify(res.body).includes('Client is difficult about catering'), false);
    });

    test('[BOUNDARY] [SG2-40:AC3] organiser whose event history holds only planning notes receives an empty history', async () => {
      const { app } = buildApp({ principal: ORGANISER, historyResult: { ok: true, logs: [NOTES_LOG] } });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event_id: 101, history: [] });
    });

    test('[NORMAL] [SG2-40:AC3] every internal role still receives planning-notes entries in full', async () => {
      const internalRoles: Role[] = [
        'event_coordinator',
        'event_coordinator_lead',
        'safety_officer',
        'technical_support_staff',
        'venue_staff'
      ];
      for (const role of internalRoles) {
        const { app } = buildApp({
          principal: { userId: 'internal-user', role },
          historyResult: { ok: true, logs: [NOTES_LOG, ...SAMPLE_LOGS] }
        });
        const res = await request(app).get('/api/event-requests/101/history');
        assert.equal(res.status, 200, role);
        assert.deepEqual(res.body, { event_id: 101, history: [{ ...NOTES_LOG, actor_role: 'Event Coordinator' }, ...SAMPLE_HISTORY] }, role);
      }
    });
  });

  describe('Validation & Error Handling', () => {
    test('[BOUNDARY] [FAILURE] [SG2-40:event-id-validation] event ID one is accepted; zero and malformed IDs are refused before reads', async () => {
      for (const invalidId of ['abc', '0', '-5', '1.5']) {
        const { app, fetchEventRequest, fetchAuditLogs } = buildApp();
        const res = await request(app).get(`/api/event-requests/${invalidId}/history`);
        assert.equal(res.status, 400);
        assert.deepEqual(res.body, { error: 'eventId must be a positive integer.' });
        assert.equal(fetchEventRequest.mock.callCount(), 0);
        assert.equal(fetchAuditLogs.mock.callCount(), 0);
      }
      const { app, fetchEventRequest, fetchAuditLogs } = buildApp({ historyResult: { ok: true, logs: [] } });
      const accepted = await request(app).get('/api/event-requests/1/history');
      assert.equal(accepted.status, 200);
      assert.deepEqual(accepted.body, { event_id: 1, history: [] });
      assert.equal(fetchEventRequest.mock.callCount(), 1);
      assert.equal(fetchAuditLogs.mock.callCount(), 1);
      assert.equal(fetchEventRequest.mock.calls[0].arguments[1], 1);
      assert.equal(fetchAuditLogs.mock.calls[0].arguments[1], 1);
    });

    test('[FAILURE] [SG2-40:history-unavailability] returns 503 when admin client is unavailable before reads', async () => {
      const { app, fetchEventRequest, fetchAuditLogs } = buildApp({ admin: null });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { error: 'Event history service is temporarily unavailable. Please try again later.' });
      assert.equal(fetchEventRequest.mock.callCount(), 0);
      assert.equal(fetchAuditLogs.mock.callCount(), 0);
    });

    test('[FAILURE] [SG2-40:event-not-found] returns 404 when event request does not exist without reading audit logs', async () => {
      const { app, fetchAuditLogs } = buildApp({
        eventResult: { ok: false, reason: 'not_found', message: 'Not found' }
      });
      const res = await request(app).get('/api/event-requests/999/history');
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: 'Event not found.' });
      assert.equal(fetchAuditLogs.mock.callCount(), 0);
    });

    test('[FAILURE] [SG2-40:history-unavailability] event read failure returns generic 503 without reading audit logs', async () => {
      const { app, fetchAuditLogs } = buildApp({
        eventResult: { ok: false, reason: 'unavailable', message: 'SECRET_PROVIDER_DETAILS' }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { error: 'Event history service is temporarily unavailable. Please try again later.' });
      assert.equal(fetchAuditLogs.mock.callCount(), 0);
    });

    test('[FAILURE] [SG2-40:history-unavailability] audit read failure returns generic 503 without provider details', async () => {
      const { app } = buildApp({
        historyResult: { ok: false, reason: 'unavailable', message: 'SECRET_PROVIDER_DETAILS' }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { error: 'Event history service is temporarily unavailable. Please try again later.' });
    });
  });

  describe('Payload & Ordering (AC 1 & AC 2)', () => {
    test('[BOUNDARY] [SG2-40:AC1] returns empty history array when event has no audit logs', async () => {
      const { app } = buildApp({
        historyResult: { ok: true, logs: [] }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, {
        event_id: 101,
        history: []
      });
    });

    test('[NORMAL] [SG2-40:AC1] [SG2-40:AC2] returns actor, time and before/after values in the provider order without extra provider fields', async () => {
      const { app } = buildApp({ historyResult: {
        ok: true,
        logs: SAMPLE_LOGS.map(log => ({ ...log, provider_internal_note: 'SECRET_PROVIDER_DETAILS' }))
      } });
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
      assert.deepEqual(res.body, { event_id: 101, history: SAMPLE_HISTORY });
    });

    test('[BOUNDARY] [SG2-40:AC1] [SG2-40:AC2] missing actor names use Unknown, an actor without a role row has no role, and null old/new values are retained', async () => {
      const { app } = buildApp({
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
      assert.deepEqual(res.body, { event_id: 101, history: [{
        log_id: 1, event_id: 101, actor_id: 'unknown-id', actor_name: 'Unknown', actor_role: null,
        field_name: 'venue_requirements', old_value: null, new_value: 'Stage setup',
        created_at: '2026-09-25T12:00:00.000Z'
      }] });
      const cleared = buildApp({ historyResult: { ok: true, logs: [{
        log_id: 2, event_id: 101, actor_id: COORDINATOR_ID, actor_name: 'Alex Coordinator',
        field_name: 'venue_requirements', old_value: 'Stage setup', new_value: null,
        created_at: '2026-09-25T13:00:00.000Z'
      }] } });
      const clearedResponse = await request(cleared.app).get('/api/event-requests/101/history');
      assert.equal(clearedResponse.status, 200);
      assert.deepEqual(clearedResponse.body, { event_id: 101, history: [{
        log_id: 2, event_id: 101, actor_id: COORDINATOR_ID, actor_name: 'Alex Coordinator', actor_role: 'Event Coordinator',
        field_name: 'venue_requirements', old_value: 'Stage setup', new_value: null,
        created_at: '2026-09-25T13:00:00.000Z'
      }] });
    });
  });

  describe('Actor roles (AC 1)', () => {
    const LEAD_ID = '70000000-0000-4000-8000-000000000007';
    const MIXED_LOGS: EventAuditLogRecord[] = [
      { log_id: 4, event_id: 101, actor_id: COORDINATOR_ID, actor_name: 'Alex Coordinator', field_name: 'status',
        old_value: 'submitted', new_value: 'under_review', created_at: '2026-09-25T14:00:00.000Z' },
      { log_id: 3, event_id: 101, actor_id: LEAD_ID, actor_name: 'Lee Lead', field_name: 'coordinator_id',
        old_value: null, new_value: 'Alex Coordinator', created_at: '2026-09-25T13:00:00.000Z' },
      { log_id: 2, event_id: 101, actor_id: COORDINATOR_ID, actor_name: 'Alex Coordinator', field_name: 'expected_attendance',
        old_value: '200', new_value: '250', created_at: '2026-09-25T12:30:00.000Z' },
      { log_id: 1, event_id: 101, actor_id: ORGANISER_ID, actor_name: 'Olive Organiser', field_name: 'status',
        old_value: 'draft', new_value: 'unassigned', created_at: '2026-09-25T12:00:00.000Z' }
    ];

    test('[NORMAL] [SG2-40:AC1] names each actor\'s real role in Title Case, looking each actor up once', async () => {
      const { app, fetchActorRoles } = buildApp({
        principal: ORGANISER,
        historyResult: { ok: true, logs: MIXED_LOGS },
        rolesResult: { ok: true, roles: new Map([
          [COORDINATOR_ID, 'event_coordinator'],
          [LEAD_ID, 'event_coordinator_lead'],
          [ORGANISER_ID, 'event_organiser']
        ]) }
      });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.history.map((entry: { log_id: number; actor_role: string | null }) => [entry.log_id, entry.actor_role]),
        [[4, 'Event Coordinator'], [3, 'Event Coordinator Lead'], [2, 'Event Coordinator'], [1, 'Event Organiser']]
      );
      assert.equal(fetchActorRoles.mock.callCount(), 1);
      assert.deepEqual(fetchActorRoles.mock.calls[0].arguments[1], [COORDINATOR_ID, LEAD_ID, ORGANISER_ID]);
    });

    test('[BOUNDARY] [SG2-40:AC1] system-written entries have no role, and a history of only system entries looks up no roles', async () => {
      const systemLog: EventAuditLogRecord = {
        log_id: 5, event_id: 101, actor_id: null, actor_name: null, field_name: 'venue_hold_status',
        old_value: 'Tentative hold 3', new_value: 'Expired hold 3', created_at: '2026-09-26T00:00:00.000Z'
      };
      const { app, fetchActorRoles } = buildApp({ historyResult: { ok: true, logs: [systemLog] } });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { event_id: 101, history: [{
        log_id: 5, event_id: 101, actor_id: null, actor_name: 'Unknown', actor_role: null, field_name: 'venue_hold_status',
        old_value: 'Tentative hold 3', new_value: 'Expired hold 3', created_at: '2026-09-26T00:00:00.000Z'
      }] });
      assert.equal(fetchActorRoles.mock.callCount(), 0);
    });

    test('[FAILURE] [SG2-40:AC1] a failed role lookup answers the generic 503 without provider details', async () => {
      const { app } = buildApp({ rolesResult: { ok: false, error: 'SECRET_PROVIDER_DETAILS' } });
      const res = await request(app).get('/api/event-requests/101/history');
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { error: 'Event history service is temporarily unavailable. Please try again later.' });
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

  test('[NORMAL] [SG2-40:AC3] [SG2-97:AC2] [SG2-100:AC13] policy grants event_request.history.view to organisers and every internal role, excluding attendees', () => {
    const rolesWithPermission = PERMISSIONS['event_request.history.view'];
    assert.ok(rolesWithPermission, 'event_request.history.view permission must exist');
    // SG2-100 added the two Week 7 roles: the Lead assigns coordinators and
    // the Safety Officer answers a safety check, and neither can do so
    // without seeing what has already changed on the event. Attendees stay
    // out.
    assert.deepEqual([...rolesWithPermission].sort(), [
      'event_coordinator',
      'event_coordinator_lead',
      'event_organiser',
      'safety_officer',
      'technical_support_staff',
      'venue_staff'
    ]);
    assert.equal(rolesWithPermission.includes('attendee' as never), false);
  });

  const appForRole = (role: Role) => {
    const historyHandler = mock.fn((_req: express.Request, res: express.Response) => {
      res.status(200).json({ route: 'history', reached: true });
    });
    const app = createApp(
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
      historyHandler
    );
    return { app, historyHandler };
  };

  test('[FAILURE] [SG2-40:authentication] [SG2-25:AC3] rejects unauthenticated request on app route with 401 before the history handler', async () => {
    const { app, historyHandler } = appForRole('event_coordinator');
    const res = await request(app).get('/api/event-requests/101/history');
    assert.equal(res.status, 401);
    assert.equal(res.headers['www-authenticate'], 'Bearer');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.body, { error: 'Authentication required' });
    assert.equal(historyHandler.mock.callCount(), 0);
  });

  test('[FAILURE] [SG2-40:AC3] denies attendee role with 403 Forbidden on app route before the history handler', async () => {
    const { app, historyHandler } = appForRole('attendee');
    const res = await request(app)
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 403);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(res.body, { error: 'Access denied' });
    assert.equal(historyHandler.mock.callCount(), 0);
  });

  test('[NORMAL] [SG2-40:history-route-wiring] allows event_coordinator role to reach mounted history handler on app route', async () => {
    const { app, historyHandler } = appForRole('event_coordinator');
    const res = await request(app)
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { route: 'history', reached: true });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(historyHandler.mock.callCount(), 1);
  });

  test('[NORMAL] [SG2-40:history-route-wiring] allows event_organiser role to reach mounted history handler on app route', async () => {
    const { app, historyHandler } = appForRole('event_organiser');
    const res = await request(app)
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { route: 'history', reached: true });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(historyHandler.mock.callCount(), 1);
  });

  test('[NORMAL] [SG2-40:history-route-wiring] allows venue_staff role to reach mounted history handler on app route', async () => {
    const { app, historyHandler } = appForRole('venue_staff');
    const res = await request(app)
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { route: 'history', reached: true });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(historyHandler.mock.callCount(), 1);
  });

  test('[NORMAL] [SG2-40:history-route-wiring] allows technical_support_staff role to reach mounted history handler on app route', async () => {
    const { app, historyHandler } = appForRole('technical_support_staff');
    const res = await request(app)
      .get('/api/event-requests/101/history')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { route: 'history', reached: true });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(historyHandler.mock.callCount(), 1);
  });
});
