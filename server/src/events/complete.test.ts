import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createCompleteEventHandler } from './complete';
import type { CompleteEventResult, EventRequestRecord } from '../db/eventRequests';
import type { InsertAuditLogInput, InsertAuditLogsResult } from '../db/auditLogs';
import type { Principal } from '../auth/policy';

const COORDINATOR: Principal = { userId: 'coord-1', role: 'event_coordinator' };

/** Fixed instants: nothing in this file reads the real clock. */
const NOW = new Date('2026-11-05T12:00:00.000Z');

const CONFIRMED_EVENT: EventRequestRecord = {
  event_id: 7,
  organiser_id: 'user-1',
  organisation: 'ConnectSphere Test',
  status: 'confirmed',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Quarterly partner networking session.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: true,
  coordinator_id: 'coord-1',
  coordinator_name: 'Coord One'
};

const COMPLETED_EVENT: EventRequestRecord = {
  ...CONFIRMED_EVENT,
  status: 'completed',
  completed_by: 'coord-1',
  completed_at: NOW.toISOString()
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  completeResult?: CompleteEventResult;
  auditResult?: InsertAuditLogsResult;
  audits?: InsertAuditLogInput[][];
  /** Every (eventId, coordinatorId, now) the handler passed down. */
  calls?: [number, string, string][];
  now?: Date;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId/complete',
    createCompleteEventHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      complete: async (_admin, eventId, coordinatorId, now) => {
        options.calls?.push([eventId, coordinatorId, now.toISOString()]);
        return (
          options.completeResult ?? {
            ok: true,
            request: COMPLETED_EVENT,
            previous_status: 'confirmed'
          }
        );
      },
      recordAudit: async (_admin, entries) => {
        options.audits?.push(entries);
        return options.auditResult ?? { ok: true, logs: [] };
      },
      now: () => options.now ?? NOW
    })
  );
  return app;
}

describe('PATCH /api/event-requests/:eventId/complete (SG2-100 AC4)', () => {
  test('[NORMAL] [SG2-100:AC6] [SG2-100:AC8] the assigned coordinator completes a confirmed event and the change is recorded once', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const calls: [number, string, string][] = [];
    const response = await request(buildApp({ audits, calls }))
      .patch('/api/event-requests/7/complete')
      .send();

    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'completed');
    assert.equal(response.body.request.completed_by, 'coord-1');
    assert.equal(response.body.request.completed_at, '2026-11-05T12:00:00.000Z');
    // The acting coordinator and the injected instant are what reach the write.
    assert.deepEqual(calls, [[7, 'coord-1', '2026-11-05T12:00:00.000Z']]);
    assert.deepEqual(audits, [[
      { event_id: 7, actor_id: 'coord-1', field_name: 'status', old_value: 'confirmed', new_value: 'completed' }
    ]]);
  });

  test('[NORMAL] [SG2-100:AC8] completing from preparation records preparation as the previous value', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(
      buildApp({
        audits,
        completeResult: {
          ok: true,
          request: { ...COMPLETED_EVENT },
          previous_status: 'preparation'
        }
      })
    )
      .patch('/api/event-requests/7/complete')
      .send();

    assert.equal(response.status, 200);
    assert.deepEqual(audits, [[
      { event_id: 7, actor_id: 'coord-1', field_name: 'status', old_value: 'preparation', new_value: 'completed' }
    ]]);
  });

  test('[CONFLICT] [SG2-100:AC6] an event that has not finished is refused with the one error worth naming', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(
      buildApp({
        audits,
        completeResult: { ok: false, reason: 'not_finished', message: 'ignored' }
      })
    )
      .patch('/api/event-requests/7/complete')
      .send();

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: 'This event has not finished yet.' });
    // Nothing happened, so nothing is recorded.
    assert.deepEqual(audits, []);
  });

  test('[CONFLICT] [SG2-100:AC6] a second completion of the same event adds no second history row', async () => {
    const audits: InsertAuditLogInput[][] = [];
    const response = await request(
      buildApp({ audits, completeResult: { ok: false, reason: 'not_found', message: 'ignored' } })
    )
      .patch('/api/event-requests/7/complete')
      .send();

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'No completable event is assigned to this account.' });
    assert.deepEqual(audits, []);
  });

  for (const eventId of ['0', '-1', 'abc', '1.5']) {
    test(`[BOUNDARY] [SG2-100:AC6] event id ${eventId} is refused before any write`, async () => {
      const calls: [number, string, string][] = [];
      const response = await request(buildApp({ calls }))
        .patch(`/api/event-requests/${eventId}/complete`)
        .send();

      assert.equal(response.status, 400);
      assert.deepEqual(response.body, { error: 'eventId must be a positive integer.' });
      assert.deepEqual(calls, []);
    });
  }

  test('[BOUNDARY] [SG2-100:AC6] the first positive id reaches the write', async () => {
    const calls: [number, string, string][] = [];
    const response = await request(buildApp({ calls })).patch('/api/event-requests/1/complete').send();
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[1, 'coord-1', '2026-11-05T12:00:00.000Z']]);
  });

  test('[FAILURE] [SG2-100:AC6] a coordinator the event is not assigned to is told nothing about it', async () => {
    const response = await request(
      buildApp({
        principal: { userId: 'coord-other', role: 'event_coordinator' },
        completeResult: { ok: false, reason: 'not_found', message: 'ignored' }
      })
    )
      .patch('/api/event-requests/7/complete')
      .send();

    // 404 rather than 403: a coordinator must not be able to tell "someone
    // else's event" apart from "no such event".
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'No completable event is assigned to this account.' });
  });

  test('[FAILURE] [SG2-100:AC6] no verified principal is refused before any write', async () => {
    const calls: [number, string, string][] = [];
    const response = await request(buildApp({ principal: undefined, calls }))
      .patch('/api/event-requests/7/complete')
      .send();

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Authentication required' });
    assert.deepEqual(calls, []);
  });

  test('[FAILURE] [SG2-100:AC6] an unconfigured database is reported as temporarily unavailable', async () => {
    const response = await request(buildApp({ admin: null }))
      .patch('/api/event-requests/7/complete')
      .send();

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'Event requests are temporarily unavailable. Please try again later.'
    });
  });

  test('[FAILURE] [SG2-100:AC6] a failing write is reported as temporarily unavailable', async () => {
    const response = await request(
      buildApp({ completeResult: { ok: false, reason: 'unavailable', message: 'connection reset' } })
    )
      .patch('/api/event-requests/7/complete')
      .send();

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'Event requests are temporarily unavailable. Please try again later.'
    });
  });

  test('[FAILURE] [SG2-100:AC8] a lost history row does not undo a completion that really happened', async () => {
    const response = await request(
      buildApp({ auditResult: { ok: false, reason: 'unavailable', message: 'history down' } })
    )
      .patch('/api/event-requests/7/complete')
      .send();

    // completed_by/completed_at on the row are the authoritative record, so
    // the transition stands and the caller is not told to retry something
    // that has already happened.
    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'completed');
  });
});
