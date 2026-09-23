import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createStartEventReviewHandler } from './events/review';
import type { StartReviewResult } from './db/eventRequests';
import type { Principal } from './auth/policy';

const COORDINATOR: Principal = { userId: 'coordinator-1', role: 'event_coordinator' };

const REVIEWED_REQUEST = {
  event_id: 7,
  organiser_id: 'organiser-1',
  organisation: 'ConnectSphere Test',
  status: 'under_review',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Half-day forum with keynotes and a reception.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: 'Hearing loop',
  equipment_requirements: 'Lectern, 2 radio mics',
  registration_needed: true,
  coordinator_id: 'coordinator-1',
  coordinator_name: 'Casey Coordinator'
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  reviewResult?: StartReviewResult;
  captureReview?: (eventId: number, coordinatorId: string) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.patch(
    '/api/event-requests/:eventId/review',
    createStartEventReviewHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      startReview: async (_admin, eventId, coordinatorId) => {
        options.captureReview?.(eventId, coordinatorId);
        return options.reviewResult ?? { ok: true, request: REVIEWED_REQUEST };
      }
    })
  );
  return app;
}

describe('PATCH /api/event-requests/:eventId/review (SG2-35)', () => {
  test('opens a request assigned to the caller, passing the caller id to the transition', async () => {
    let reviewed: { eventId: number; coordinatorId: string } | undefined;
    const response = await request(
      buildApp({ captureReview: (eventId, coordinatorId) => (reviewed = { eventId, coordinatorId }) })
    ).patch('/api/event-requests/7/review');

    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'under_review');
    assert.deepEqual(reviewed, { eventId: 7, coordinatorId: 'coordinator-1' });
  });

  test('returns 400 for a non-numeric eventId, without touching the database', async () => {
    let called = false;
    const response = await request(buildApp({ captureReview: () => (called = true) })).patch(
      '/api/event-requests/not-a-number/review'
    );
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined })).patch('/api/event-requests/7/review');
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).patch('/api/event-requests/7/review');
    assert.equal(response.status, 503);
  });

  test('returns 404 when the request is assigned to another coordinator or is not reviewable', async () => {
    const response = await request(
      buildApp({ reviewResult: { ok: false, reason: 'not_found', message: 'missing' } })
    ).patch('/api/event-requests/7/review');
    assert.equal(response.status, 404);
  });

  test('returns 503 without leaking the database error when the transition fails', async () => {
    const response = await request(
      buildApp({ reviewResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).patch('/api/event-requests/7/review');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('PATCH /api/event-requests/:eventId/review authorisation wiring', () => {
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

  /** Uses the real PERMISSIONS policy; the review handler itself is stubbed. */
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
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_coordinator')).patch('/api/event-requests/7/review');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('denies an Event Organiser, who owns requests but does not review them', async () => {
    const response = await request(appForRole('event_organiser'))
      .patch('/api/event-requests/7/review')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('lets an Event Coordinator reach the review handler', async () => {
    const response = await request(appForRole('event_coordinator'))
      .patch('/api/event-requests/7/review')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
