import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGetEventStageHandler } from './events/getStage';
import type { Principal } from './auth/policy';
import type { EventPlanningRecord, FetchEventPlanningResult } from './db/eventPlanning';

const ORGANISER: Principal = {
  userId: '10000000-0000-4000-8000-000000000001',
  role: 'event_organiser'
};

const COORDINATOR: Principal = {
  userId: '20000000-0000-4000-8000-000000000002',
  role: 'event_coordinator'
};

const VENUE_STAFF: Principal = {
  userId: '30000000-0000-4000-8000-000000000003',
  role: 'venue_staff'
};

const ATTENDEE: Principal = {
  userId: '40000000-0000-4000-8000-000000000004',
  role: 'attendee'
};

const UNRELATED_ORGANISER: Principal = {
  userId: '50000000-0000-4000-8000-000000000005',
  role: 'event_organiser'
};

const MOCK_EVENT: EventPlanningRecord = {
  event_id: 101,
  status: 'approved',
  coordinator_id: '20000000-0000-4000-8000-000000000002',
  coordinator_name: 'Sarah Coordinator',
  organiser_id: '10000000-0000-4000-8000-000000000001',
  expected_attendance: 120,
  proposed_date: '2026-11-04T09:00:00.000Z',
  venue_requirements: 'Auditorium',
  accessibility_needs: 'Wheelchair access',
  equipment_requirements: 'Projector',
  registration_needed: true,
  registration_capacity: 120,
  registration_opens_at: null,
  registration_closes_at: null,
  planning_notes: null,
  arrangements_recheck_needed: false,
  outstanding_arrangements: []
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventPlanningResult;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.get(
    '/api/event-requests/:eventId/stage',
    createGetEventStageHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchPlanningRecord: async () => options.fetchResult ?? { ok: true, event: MOCK_EVENT }
    })
  );
  return app;
}

describe('GET /api/event-requests/:eventId/stage (SG2-38)', () => {
  test('returns 200 with computed stage and waiting-on for owning organiser', async () => {
    const app = buildApp({ principal: ORGANISER });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'Approved — In Planning');
    assert.equal(res.body.stage_key, 'in_planning');
    assert.equal(res.body.event_id, 101);
    assert.deepEqual(res.body.waiting_on, {
      persona: 'Event Coordinator (Sarah Coordinator)',
      action: 'Complete venue suitability check and equipment reservation',
      user_id: '20000000-0000-4000-8000-000000000002'
    });
    assert.equal(Array.isArray(res.body.stepper_steps), true);
    assert.equal(res.body.stepper_steps[3].status, 'current');
  });

  test('returns 200 for internal coordinator', async () => {
    const app = buildApp({ principal: COORDINATOR });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'Approved — In Planning');
  });

  test('returns 200 for venue staff', async () => {
    const app = buildApp({ principal: VENUE_STAFF });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'Approved — In Planning');
  });

  test('returns 403 Forbidden for attendee', async () => {
    const app = buildApp({ principal: ATTENDEE });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('authorized'));
  });

  test('returns 403 Forbidden for unrelated organiser', async () => {
    const app = buildApp({ principal: UNRELATED_ORGANISER });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('authorized'));
  });

  test('returns 400 Bad Request for invalid event ID parameter', async () => {
    const app = buildApp({ principal: ORGANISER });
    const res = await request(app).get('/api/event-requests/invalid/stage');

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('positive integer'));
  });

  test('returns 404 Not Found when event record does not exist', async () => {
    const app = buildApp({
      principal: ORGANISER,
      fetchResult: { ok: false, reason: 'not_found', message: 'Event not found.' }
    });
    const res = await request(app).get('/api/event-requests/999/stage');

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Event not found.');
  });

  test('returns 503 Service Unavailable when database query fails', async () => {
    const app = buildApp({
      principal: ORGANISER,
      fetchResult: { ok: false, reason: 'unavailable', message: 'DB connection timeout' }
    });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 503);
  });
});
