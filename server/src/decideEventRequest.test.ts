import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createDecideEventRequestHandler, type Decision } from './events/decide';
import type { DecideEventRequestResult } from './db/eventRequests';
import type { Principal } from './auth/policy';

const COORDINATOR: Principal = { userId: 'coordinator-1', role: 'event_coordinator' };

const DECIDED_REQUEST = {
  event_id: 7,
  organiser_id: 'organiser-1',
  organisation: 'ConnectSphere Test',
  status: 'approved',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Half-day forum with keynotes and a reception.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: true,
  coordinator_id: 'coordinator-1',
  coordinator_name: 'Casey Coordinator',
  decided_at: '2026-09-25T02:00:00.000Z',
  decision_reason: null
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  decideResult?: DecideEventRequestResult;
  captureDecide?: (eventId: number, coordinatorId: string, decision: Decision, reason: string | null) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId/decision',
    createDecideEventRequestHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      decide: async (_admin, eventId, coordinatorId, decision, reason) => {
        options.captureDecide?.(eventId, coordinatorId, decision, reason);
        return options.decideResult ?? { ok: true, request: DECIDED_REQUEST };
      }
    })
  );
  return app;
}

describe('PATCH /api/event-requests/:eventId/decision (SG2-37)', () => {
  test('approves a request under review, recording the deciding coordinator', async () => {
    let decided: { eventId: number; coordinatorId: string; decision: Decision; reason: string | null } | undefined;
    const response = await request(
      buildApp({
        captureDecide: (eventId, coordinatorId, decision, reason) =>
          (decided = { eventId, coordinatorId, decision, reason })
      })
    )
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'approved' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'approved');
    assert.deepEqual(decided, {
      eventId: 7,
      coordinatorId: 'coordinator-1',
      decision: 'approved',
      reason: null
    });
  });

  test('an approval may carry a reason, trimmed before it is stored', async () => {
    let decided: { reason: string | null } | undefined;
    const response = await request(
      buildApp({ captureDecide: (_e, _c, _d, reason) => (decided = { reason }) })
    )
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'approved', reason: '  Budget already signed off.  ' });

    assert.equal(response.status, 200);
    assert.equal(decided?.reason, 'Budget already signed off.');
  });

  test('rejects a request with the reason the organiser will read', async () => {
    let decided: { decision: Decision; reason: string | null } | undefined;
    const response = await request(
      buildApp({
        decideResult: {
          ok: true,
          request: { ...DECIDED_REQUEST, status: 'rejected', decision_reason: 'Date clashes with the AGM.' }
        },
        captureDecide: (_e, _c, decision, reason) => (decided = { decision, reason })
      })
    )
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'rejected', reason: 'Date clashes with the AGM.' });

    assert.equal(response.status, 200);
    assert.equal(response.body.request.decision_reason, 'Date clashes with the AGM.');
    assert.deepEqual(decided, { decision: 'rejected', reason: 'Date clashes with the AGM.' });
  });

  for (const [label, body] of [
    ['omitted', { decision: 'rejected' }],
    ['blank', { decision: 'rejected', reason: '   ' }],
    ['null', { decision: 'rejected', reason: null }]
  ] as const) {
    test(`refuses a rejection whose reason is ${label}, without touching the database`, async () => {
      let called = false;
      const response = await request(buildApp({ captureDecide: () => (called = true) }))
        .patch('/api/event-requests/7/decision')
        .send(body);

      assert.equal(response.status, 400);
      assert.match(response.body.error, /reason is required/i);
      assert.equal(called, false);
    });
  }

  for (const [label, body] of [
    ['an unknown outcome', { decision: 'maybe' }],
    ['a missing decision', {}],
    ['a non-string decision', { decision: 7 }],
    ['a status that is not a decision', { decision: 'under_review' }]
  ] as const) {
    test(`returns 400 for ${label}`, async () => {
      const response = await request(buildApp()).patch('/api/event-requests/7/decision').send(body);
      assert.equal(response.status, 400);
      assert.match(response.body.error, /approved or rejected/);
    });
  }

  test('returns 400 when the reason is not text', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'rejected', reason: 42 });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /must be text/);
  });

  test('returns 400 when the reason is longer than the field allows', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'rejected', reason: 'x'.repeat(5001) });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /5000 characters or fewer/);
  });

  test('treats an absent request body as a missing decision', async () => {
    // No express.json() here, so req.body is undefined rather than {}.
    const bare = express();
    bare.patch(
      '/api/event-requests/:eventId/decision',
      createDecideEventRequestHandler({
        getPrincipal: () => COORDINATOR,
        getAdminClient: () => ({}) as SupabaseClient,
        decide: async () => ({ ok: true, request: DECIDED_REQUEST })
      })
    );
    const response = await request(bare).patch('/api/event-requests/7/decision');
    assert.equal(response.status, 400);
  });

  test('returns 400 for a non-numeric eventId, without touching the database', async () => {
    let called = false;
    const response = await request(buildApp({ captureDecide: () => (called = true) }))
      .patch('/api/event-requests/not-a-number/decision')
      .send({ decision: 'approved' });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined }))
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'approved' });
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null }))
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'approved' });
    assert.equal(response.status, 503);
  });

  test('returns 404 when the request is not under review by this coordinator', async () => {
    const response = await request(
      buildApp({ decideResult: { ok: false, reason: 'not_found', message: 'missing' } })
    )
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'approved' });
    assert.equal(response.status, 404);
  });

  test('returns 503 without leaking the database error when the decision fails', async () => {
    const response = await request(
      buildApp({ decideResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7/decision')
      .send({ decision: 'approved' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('PATCH /api/event-requests/:eventId/decision authorisation wiring', () => {
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

  /** Uses the real PERMISSIONS policy; the decision handler itself is stubbed.
   * The handler is createApp's 17th parameter, after SG2-35's review handler. */
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

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_coordinator')).patch('/api/event-requests/7/decision');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('denies an Event Organiser, who cannot decide their own request', async () => {
    const response = await request(appForRole('event_organiser'))
      .patch('/api/event-requests/7/decision')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('lets an Event Coordinator reach the decision handler', async () => {
    const response = await request(appForRole('event_coordinator'))
      .patch('/api/event-requests/7/decision')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
