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
  expected_crowd_movement: null,
  arrangements_recheck_needed: false,
  outstanding_arrangements: []
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventPlanningResult;
}

/** SG2-104 AC6: an admin client answering the relationship lookups from fixed rows. */
function relationshipAdmin(rows: Record<string, unknown[]>, failing = false): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          limit: async () => (failing ? { data: null, error: { message: 'down' } } : { data: rows[table] ?? [], error: null })
        })
      })
    })
  } as unknown as SupabaseClient;
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
  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] returns 200 with computed stage and waiting-on for owning organiser', async () => {
    const app = buildApp({ principal: ORGANISER });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'Arrangements');
    assert.equal(res.body.stage_key, 'in_planning');
    assert.equal(res.body.event_id, 101);
    assert.deepEqual(res.body.waiting_on, {
      persona: 'Event Coordinator (Sarah Coordinator)',
      action: 'Complete venue suitability check and equipment reservation',
      user_id: '20000000-0000-4000-8000-000000000002'
    });
    assert.deepEqual(res.body.stepper_steps, [
      { key: 'draft', label: 'Draft', status: 'completed' },
      { key: 'unassigned', label: 'Awaiting Assignment', status: 'completed' },
      { key: 'under_review', label: 'Under Review', status: 'completed' },
      { key: 'in_planning', label: 'Arrangements', status: 'current' },
      { key: 'safety_check', label: 'Safety Check', status: 'upcoming' },
      { key: 'preparation', label: 'Preparation', status: 'upcoming' },
      { key: 'confirmed', label: 'Confirmed', status: 'upcoming' }
    ]);
  });

  test('[NORMAL] [SG2-38:AC1] returns 200 for internal coordinator', async () => {
    const app = buildApp({ principal: COORDINATOR });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'Arrangements');
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-104:AC6] returns 200 for venue staff working on the event\'s venue', async () => {
    const app = buildApp({ principal: VENUE_STAFF, admin: relationshipAdmin({ venue_booking_requests: [{ event_id: 101 }] }) });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 200);
    assert.equal(res.body.stage, 'Arrangements');
  });

  test('[BOUNDARY] [SG2-104:AC6] venue staff with no venue request or booking on the event are refused', async () => {
    const res = await request(buildApp({ principal: VENUE_STAFF, admin: relationshipAdmin({}) })).get('/api/event-requests/101/stage');
    assert.equal(res.status, 403);
  });

  test('[FAILURE] [SG2-104:AC6] a coordinator not assigned to the event is refused by ID', async () => {
    const other: Principal = { userId: '60000000-0000-4000-8000-000000000006', role: 'event_coordinator' };
    const res = await request(buildApp({ principal: other })).get('/api/event-requests/101/stage');
    assert.equal(res.status, 403);
  });

  test('[CONFLICT] [SG2-104:AC6] a reassigned coordinator loses access on the very next request', async () => {
    let event = MOCK_EVENT;
    const app = express();
    app.get('/api/event-requests/:eventId/stage', createGetEventStageHandler({
      getPrincipal: () => COORDINATOR,
      getAdminClient: () => ({} as SupabaseClient),
      fetchPlanningRecord: async () => ({ ok: true, event })
    }));
    assert.equal((await request(app).get('/api/event-requests/101/stage')).status, 200);
    event = { ...MOCK_EVENT, coordinator_id: '60000000-0000-4000-8000-000000000006' };
    assert.equal((await request(app).get('/api/event-requests/101/stage')).status, 403);
  });

  test('[FAILURE] [SG2-104:AC6] a relationship lookup that fails answers 503', async () => {
    const res = await request(buildApp({ principal: VENUE_STAFF, admin: relationshipAdmin({}, true) })).get('/api/event-requests/101/stage');
    assert.equal(res.status, 503);
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-38:AC1] returns 403 Forbidden for attendee', async () => {
    const app = buildApp({ principal: ATTENDEE });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('authorized'));
  });

  test('[FAILURE] [SG2-26:AC2] [SG2-38:AC1] returns 403 Forbidden for unrelated organiser', async () => {
    const app = buildApp({ principal: UNRELATED_ORGANISER });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 403);
    assert.ok(res.body.error.toLowerCase().includes('authorized'));
  });

  test('[FAILURE] [SG2-38:AC1] returns 400 Bad Request for invalid event ID parameter', async () => {
    const app = buildApp({ principal: ORGANISER });
    const res = await request(app).get('/api/event-requests/invalid/stage');

    assert.equal(res.status, 400);
    assert.ok(res.body.error.includes('positive integer'));
  });

  test('[FAILURE] [SG2-38:AC1] returns 404 Not Found when event record does not exist', async () => {
    const app = buildApp({
      principal: ORGANISER,
      fetchResult: { ok: false, reason: 'not_found', message: 'Event not found.' }
    });
    const res = await request(app).get('/api/event-requests/999/stage');

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Event not found.');
  });

  test('[FAILURE] [SG2-38:AC1] returns 503 Service Unavailable when database query fails', async () => {
    const app = buildApp({
      principal: ORGANISER,
      fetchResult: { ok: false, reason: 'unavailable', message: 'DB connection timeout' }
    });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'Event stage service is temporarily unavailable. Please try again later.' });
  });

  test('[FAILURE] [SG2-25:AC3] [SG2-38:AC1] returns 401 Unauthorized when principal is missing', async () => {
    const app = buildApp({ principal: undefined });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Authentication required');
  });

  test('[FAILURE] [SG2-38:AC1] returns 503 Service Unavailable when admin client is missing', async () => {
    const app = buildApp({ admin: null });
    const res = await request(app).get('/api/event-requests/101/stage');

    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'Event stage service is temporarily unavailable. Please try again later.' });
  });
});
