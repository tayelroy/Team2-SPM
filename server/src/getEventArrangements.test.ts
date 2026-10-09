import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGetEventArrangementsHandler } from './events/getArrangements';
import type { Principal } from './auth/policy';
import type { EventPlanningRecord, FetchEventPlanningResult } from './db/eventPlanning';
import type { FetchEventArrangementFactsResult } from './db/eventArrangements';

const COORDINATOR: Principal = {
  userId: '20000000-0000-4000-8000-000000000002',
  role: 'event_coordinator'
};

const OTHER_COORDINATOR: Principal = {
  userId: '2f000000-0000-4000-8000-00000000000f',
  role: 'event_coordinator'
};

const ORGANISER: Principal = {
  userId: '10000000-0000-4000-8000-000000000001',
  role: 'event_organiser'
};

const ATTENDEE: Principal = {
  userId: '40000000-0000-4000-8000-000000000004',
  role: 'attendee'
};

const MOCK_EVENT: EventPlanningRecord = {
  event_id: 101,
  status: 'planning',
  coordinator_id: COORDINATOR.userId,
  coordinator_name: 'Sarah Coordinator',
  organiser_id: ORGANISER.userId,
  expected_attendance: 120,
  proposed_date: '2026-11-04T09:00:00.000Z',
  venue_requirements: 'Auditorium',
  accessibility_needs: null,
  equipment_requirements: 'Projector',
  registration_needed: true,
  registration_capacity: 120,
  registration_opens_at: '2026-11-01T00:00:00.000Z',
  registration_closes_at: '2026-11-03T00:00:00.000Z',
  planning_notes: null,
  arrangements_recheck_needed: false,
  outstanding_arrangements: []
};

const READY_FACTS: FetchEventArrangementFactsResult = {
  ok: true,
  facts: {
    venue_requests: [{ status: 'approved' }],
    equipment_requests: [{ status: 'pending', shortfall: 0, placement_venue_id: 7 }]
  }
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  planning?: FetchEventPlanningResult;
  facts?: FetchEventArrangementFactsResult;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.get(
    '/api/event-requests/:eventId/arrangements',
    createGetEventArrangementsHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchPlanningRecord: async () => options.planning ?? { ok: true, event: MOCK_EVENT },
      fetchArrangementFacts: async () => options.facts ?? READY_FACTS
    })
  );
  return app;
}

describe('GET /api/event-requests/:eventId/arrangements (SG2-57)', () => {
  test('[NORMAL] [SG2-57:AC1] [SG2-57:AC2] [SG2-57:AC3] returns 200 with readiness for the assigned coordinator', async () => {
    const res = await request(buildApp()).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 200);
    assert.equal(res.body.event_id, 101);
    assert.equal(res.body.ready_for_confirmation, true);
    assert.deepEqual(res.body.outstanding, []);
    assert.equal(res.body.arrangements.length, 3);
  });

  test('[NORMAL] [SG2-57:AC1] [SG2-57:AC3] reports outstanding arrangements and withholds readiness', async () => {
    const res = await request(
      buildApp({
        facts: {
          ok: true,
          facts: {
            venue_requests: [{ status: 'pending' }],
            equipment_requests: []
          }
        },
        planning: { ok: true, event: { ...MOCK_EVENT, registration_needed: false } }
      })
    ).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.outstanding, ['venue']);
    assert.equal(res.body.ready_for_confirmation, false);
  });

  test('[FAILURE] [SG2-57:AC1] returns 401 when the caller is not authenticated', async () => {
    const res = await request(buildApp({ principal: undefined })).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 401);
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-57:AC1] returns 403 for a non-coordinator role', async () => {
    for (const principal of [ORGANISER, ATTENDEE]) {
      const res = await request(buildApp({ principal })).get('/api/event-requests/101/arrangements');
      assert.equal(res.status, 403, principal.role);
    }
  });

  test('[FAILURE] [SG2-90:AC1] [SG2-57:AC1] returns 403 for a coordinator who is not the assigned one', async () => {
    const res = await request(buildApp({ principal: OTHER_COORDINATOR })).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 403);
    assert.match(res.body.error, /assigned event coordinator/i);
  });

  test('[CONFLICT] [SG2-90:AC1] [SG2-57:AC1] a coordinator unassigned by a concurrent reassignment is denied', async () => {
    // The caller was this event's coordinator when they opened the screen, but
    // the event was reassigned to OTHER_COORDINATOR before this read resolved;
    // the record now carries the new coordinator, so the ownership check denies
    // the previous one rather than serving a stale readiness view.
    const reassigned = { ...MOCK_EVENT, coordinator_id: OTHER_COORDINATOR.userId };
    const res = await request(
      buildApp({ principal: COORDINATOR, planning: { ok: true, event: reassigned } })
    ).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 403);
    assert.match(res.body.error, /assigned event coordinator/i);
  });

  test('[FAILURE] [SG2-57:AC1] returns 400 for a non-numeric event id', async () => {
    const res = await request(buildApp()).get('/api/event-requests/not-a-number/arrangements');

    assert.equal(res.status, 400);
    assert.match(res.body.error, /positive integer/);
  });

  test('[FAILURE] [SG2-57:AC1] returns 404 when the event does not exist', async () => {
    const res = await request(
      buildApp({ planning: { ok: false, reason: 'not_found', message: 'Event not found.' } })
    ).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 404);
  });

  test('[FAILURE] [SG2-57:AC1] returns 503 when the planning lookup is unavailable', async () => {
    const res = await request(
      buildApp({ planning: { ok: false, reason: 'unavailable', message: 'down' } })
    ).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 503);
  });

  test('[FAILURE] [SG2-57:AC1] returns 503 when the arrangement facts are unavailable', async () => {
    const res = await request(
      buildApp({ facts: { ok: false, reason: 'unavailable', message: 'down' } })
    ).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 503);
  });

  test('[FAILURE] [SG2-57:AC1] returns 503 when the database client is unavailable', async () => {
    const res = await request(buildApp({ admin: null })).get('/api/event-requests/101/arrangements');

    assert.equal(res.status, 503);
  });
});
