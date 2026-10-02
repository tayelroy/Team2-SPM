import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role, Principal } from './auth/policy';
import { dbConfig } from './db/config';
import { createAssignCoordinatorHandler } from './events/assignCoordinator';
import type { AssignCoordinatorResult, FetchEventRequestResult } from './db/eventRequests';
import type { GetAccountRoleResult } from './db/accountRoles';

const STAFF: Principal = { userId: 'staff-1', role: 'technical_support_staff' };

const SUBMITTED_REQUEST = {
  event_id: 7,
  organiser_id: 'user-1',
  organisation: 'ConnectSphere Test',
  status: 'submitted',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Quarterly partner networking session.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: true,
  coordinator_id: null,
  coordinator_name: null
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventRequestResult;
  roleResult?: GetAccountRoleResult;
  assignResult?: AssignCoordinatorResult;
  captureFetch?: (eventId: number) => void;
  captureRole?: (userId: string) => void;
  captureAssign?: (eventId: number, coordinatorId: string) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId/coordinator',
    createAssignCoordinatorHandler({
      getPrincipal: () => ('principal' in options ? options.principal : STAFF),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchRequest: async (_admin, eventId) => {
        options.captureFetch?.(eventId);
        return options.fetchResult ?? { ok: true, request: SUBMITTED_REQUEST };
      },
      lookupRole: async (_admin, userId) => {
        options.captureRole?.(userId);
        return options.roleResult ?? { ok: true, role: 'event_coordinator' };
      },
      assignCoordinator: async (_admin, eventId, coordinatorId) => {
        options.captureAssign?.(eventId, coordinatorId);
        return (
          options.assignResult ?? {
            ok: true,
            request: { ...SUBMITTED_REQUEST, coordinator_id: coordinatorId, coordinator_name: 'Coord One' }
          }
        );
      }
    })
  );
  return app;
}

describe('PATCH /api/event-requests/:eventId/coordinator (SG2-33/SG2-34)', () => {
  test('[BOUNDARY] [SG2-33:AC1] assignment accepts event id one and refuses zero before any lookup or write', async () => {
    const calls: unknown[] = [];
    const app = buildApp({
      fetchResult: { ok: true, request: { ...SUBMITTED_REQUEST, event_id: 1 } },
      assignResult: { ok: true, request: { ...SUBMITTED_REQUEST, event_id: 1, coordinator_id: 'coord-1' } },
      captureFetch: eventId => { calls.push(['event', eventId]); },
      captureRole: coordinatorId => { calls.push(['role', coordinatorId]); },
      captureAssign: (eventId, coordinatorId) => { calls.push(['assign', eventId, coordinatorId]); }
    });
    const refused = await request(app).patch('/api/event-requests/0/coordinator').send({ coordinatorId: 'coord-1' });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, { error: 'eventId must be a positive integer.' });
    assert.deepEqual(calls, []);
    const accepted = await request(app).patch('/api/event-requests/1/coordinator').send({ coordinatorId: 'coord-1' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.event_id, 1);
    assert.deepEqual(calls, [['event', 1], ['role', 'coord-1'], ['assign', 1, 'coord-1']]);
  });

  test('[NORMAL] [SG2-33:AC1] [SG2-33:AC2] assigns a coordinator to a request with none yet (SG2-33)', async () => {
    let assigned: { eventId: number; coordinatorId: string } | undefined;
    const response = await request(
      buildApp({ captureAssign: (eventId, coordinatorId) => (assigned = { eventId, coordinatorId }) })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.coordinator_id, 'coord-1');
    assert.deepEqual(assigned, { eventId: 7, coordinatorId: 'coord-1' });
  });

  test('[NORMAL] [SG2-34:AC1] [SG2-34:AC2] reassigns a request that already has a coordinator (SG2-34)', async () => {
    const response = await request(
      buildApp({
        fetchResult: {
          ok: true,
          request: { ...SUBMITTED_REQUEST, coordinator_id: 'coord-old', coordinator_name: 'Old Coord' }
        }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-new' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.coordinator_id, 'coord-new');
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 for a non-numeric eventId', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/not-a-number/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 when coordinatorId is missing', async () => {
    const response = await request(buildApp()).patch('/api/event-requests/7/coordinator').send({});
    assert.equal(response.status, 400);
  });

  test('[BOUNDARY] [SG2-33:AC1] [SG2-34:AC1] returns 400 when coordinatorId is blank', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: '   ' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 401);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 404 when the event request does not exist', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 404);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 without leaking the database error when the lookup fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 when coordinatorId does not belong to any account', async () => {
    const response = await request(buildApp({ roleResult: { ok: false, reason: 'user_not_found' } }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'ghost' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 400 when the target account is not an Event Coordinator', async () => {
    const response = await request(buildApp({ roleResult: { ok: true, role: 'venue_staff' } }))
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 without leaking the database error when the role lookup fails', async () => {
    const response = await request(
      buildApp({ roleResult: { ok: false, reason: 'error', error: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('[CONFLICT] [SG2-33:AC1] [SG2-34:AC1] returns 409 when the assignment no longer matches an assignable status', async () => {
    const response = await request(
      buildApp({
        assignResult: {
          ok: false,
          reason: 'not_assignable',
          message: 'This event request cannot have a coordinator assigned in its current status.'
        }
      })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 409);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] returns 503 without leaking the database error when the update fails', async () => {
    const response = await request(
      buildApp({ assignResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7/coordinator')
      .send({ coordinatorId: 'coord-1' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('PATCH /api/event-requests/:eventId/coordinator authorisation wiring', () => {
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

  /**
   * Uses the real PERMISSIONS policy, exercising the actual grant for
   * 'event_request.assign_coordinator'. Every other handler param is left
   * as the default (unused by this route); the assign-coordinator handler
   * is stubbed so reaching it is unambiguous.
   */
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
      undefined,
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] rejects an unauthenticated request', async () => {
    const response = await request(appForRole('technical_support_staff')).patch(
      '/api/event-requests/7/coordinator'
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] denies a role without the assign-coordinator permission', async () => {
    const response = await request(appForRole('event_organiser'))
      .patch('/api/event-requests/7/coordinator')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] denies an Event Coordinator (they receive assignments, not make them)', async () => {
    const response = await request(appForRole('event_coordinator'))
      .patch('/api/event-requests/7/coordinator')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('[NORMAL] [SG2-33:AC1] [SG2-34:AC1] lets Technical Support Staff reach the assign-coordinator handler', async () => {
    const response = await request(appForRole('technical_support_staff'))
      .patch('/api/event-requests/7/coordinator')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
