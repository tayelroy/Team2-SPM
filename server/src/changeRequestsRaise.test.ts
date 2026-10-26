import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization, type Principal } from './auth';
import { PERMISSIONS } from './auth/policy';
import { dbConfig } from './db/config';
import type { ChangeImpactEventRecord } from './db/changeImpact';
import type { RaiseChangeRequestInput, RaiseChangeRequestResult } from './db/changeRequests';
import type { ChangeRequest, ChangeRequestSource } from './changeRequests/mockChangeRequests';
import { createChangeRequestHandlers, type ChangeRequestDependencies } from './events/changeRequests';

const ORGANISER = 'organiser-1';
const EVENT = {
  event_id: 12, status: 'confirmed', coordinator_id: 'coordinator-1', organiser_id: ORGANISER,
  name: 'Harbour Showcase', expected_attendance: 120
} as ChangeImpactEventRecord;
const STORED: ChangeRequest = {
  id: '41', requested_at: '2026-10-24T02:00:00.000Z', reason: 'More guests confirmed.', status: 'pending',
  changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }]
};
const BODY = { field: 'expected_attendance', to: 180, reason: 'More guests confirmed.' };
const UNAVAILABLE = { error: 'Change request service is temporarily unavailable. Please try again later.' };

const listing = (requests: ChangeRequest[]): ChangeRequestSource => ({
  list: async () => requests, get: async () => null, markAccepted: async () => undefined
});

function harness(overrides: Partial<ChangeRequestDependencies> & { principal?: Principal | null; event?: Partial<ChangeImpactEventRecord> } = {}) {
  const raised: RaiseChangeRequestInput[] = [];
  const principal = overrides.principal === undefined ? { userId: ORGANISER, role: 'event_organiser' as const } : overrides.principal;
  const handlers = createChangeRequestHandlers({
    getPrincipal: () => principal ?? undefined,
    getAdminClient: () => ({}) as SupabaseClient,
    fetchEvent: async () => ({ ok: true, event: { ...EVENT, ...overrides.event } }),
    source: listing([STORED]),
    raise: async (_admin, input): Promise<RaiseChangeRequestResult> => {
      raised.push(input);
      return { outcome: 'ok', request: STORED, coordinator_notified: true };
    },
    ...overrides
  });
  const app = express();
  app.use(express.json());
  app.post('/events/:eventId/change-requests', handlers.raise);
  app.get('/events/:eventId/change-requests', handlers.list);
  return { app, raised };
}

const post = (app: express.Express, body: unknown, id = '12') => request(app).post(`/events/${id}/change-requests`).send(body as object);

describe('change requests for the creating organiser (SG2-64)', () => {
  const originalConfig = { ...dbConfig };
  beforeEach(() => {
    dbConfig.supabaseUrl = undefined;
    dbConfig.supabaseAnonKey = undefined;
    dbConfig.supabaseServiceRoleKey = undefined;
  });
  afterEach(() => Object.assign(dbConfig, originalConfig));
  const appAs = (role: Principal['role']) => createApp(undefined,
    createAuthorization({ resolvePrincipal: async () => ({ userId: ORGANISER, role }), permissions: PERMISSIONS }));

  test('[NORMAL] [SG2-64:AC1] [SG2-64:AC2] the owning organiser raises what, to what and why, normalised by the request form\'s rules, and the coordinator is notified', async () => {
    const { app, raised } = harness();
    const res = await post(app, { ...BODY, reason: '  More guests confirmed.  ' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { change_request: STORED, coordinator_notified: true });
    await post(app, { field: 'name', to: '  Harbour Gala ', reason: 'Rebrand' });
    await post(app, { field: 'proposed_date', to: '2030-06-27T10:00:00+08:00', reason: 'Speaker moved' });
    assert.deepEqual(raised, [
      { eventId: 12, actorId: ORGANISER, field: 'expected_attendance', to: 180, reason: 'More guests confirmed.' },
      { eventId: 12, actorId: ORGANISER, field: 'name', to: 'Harbour Gala', reason: 'Rebrand' },
      { eventId: 12, actorId: ORGANISER, field: 'proposed_date', to: '2030-06-27T02:00:00.000Z', reason: 'Speaker moved' }
    ]);
  });

  test('[BOUNDARY] [CONFLICT] [SG2-64:AC1] [SG2-64:AC4] limits, closed events, the current value and another organiser\'s event are refused', async () => {
    // A 1000-character reason and attendance of 1 are accepted; 1001 characters, 0 and blanks are not.
    const { app, raised } = harness();
    assert.equal((await post(app, { ...BODY, to: 1, reason: 'r'.repeat(1000) })).status, 201);
    const long = await post(app, { ...BODY, reason: 'r'.repeat(1001) });
    assert.deepEqual([long.status, long.body.details], [400, ['Give a reason for the change, up to 1000 characters.']]);
    const zero = await post(app, { ...BODY, to: 0 });
    assert.deepEqual([zero.status, zero.body.details], [400, ['expected_attendance must be at least 1.']]);
    const blank = await post(app, { field: 'description', to: '   ', reason: '   ' });
    assert.deepEqual([blank.status, blank.body], [400, { error: 'Invalid change request',
      details: ['Give the new value.', 'Give a reason for the change, up to 1000 characters.'] }]);
    assert.equal((await post(app, { field: 'description' })).status, 400);
    assert.equal(raised.length, 1);
    // AC4 and the function's other refusals.
    for (const status of ['draft', 'cancelled', 'rejected', 'completed']) {
      const res = await post(harness({ raise: async () => ({ outcome: 'closed', status }) }).app, BODY);
      assert.deepEqual([res.status, res.body], [409, {
        error: 'A change cannot be requested on a draft, cancelled, rejected or completed event.', status
      }], status);
    }
    const same = await post(harness({ raise: async () => ({ outcome: 'unchanged' }) }).app, BODY);
    assert.deepEqual([same.status, same.body], [409, { error: 'The event already has that value.' }]);
    const other = await post(harness({ raise: async () => ({ outcome: 'not_found' }) }).app, BODY);
    assert.deepEqual([other.status, other.body], [404, { error: 'Event not found.' }]);
  });

  test('[FAILURE] [SG2-64:AC1] other roles, bad ids, fields or bodies, and a missing or failing database are refused before any write', async () => {
    const { app: anonymous, raised } = harness({ principal: null });
    assert.equal((await post(anonymous, BODY)).status, 401);
    const coordinator = await post(harness({ principal: { userId: 'coordinator-1', role: 'event_coordinator' } }).app, BODY);
    assert.deepEqual([coordinator.status, coordinator.body], [403, { error: 'Access denied' }]);
    const { app } = harness();
    for (const id of ['abc', '0', '2147483648']) {
      assert.equal((await post(app, BODY, id)).status, 400, id);
    }
    for (const body of [[BODY], { ...BODY, field: 'status' }, { ...BODY, field: 'registration_needed' }, { ...BODY, to: 'many' }]) {
      assert.equal((await post(app, body)).status, 400, JSON.stringify(body));
    }
    assert.equal(raised.length, 0);
    assert.deepEqual((await post(harness({ getAdminClient: () => null }).app, BODY)).body, UNAVAILABLE);
    const failed = await post(harness({ raise: async () => ({ outcome: 'unavailable' }) }).app, BODY);
    assert.deepEqual([failed.status, failed.body], [503, UNAVAILABLE]);
    // Behind the app: every role but the Event Organiser gets 403, and the organiser reaches the handler.
    for (const role of ['event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee', 'event_coordinator_lead', 'safety_officer'] as const) {
      const res = await request(appAs(role)).post('/api/event-requests/12/change-requests')
        .set('Authorization', 'Bearer token').send(BODY);
      assert.deepEqual([res.status, res.body], [403, { error: 'Access denied' }], role);
    }
    const reached = await request(appAs('event_organiser')).post('/api/event-requests/12/change-requests')
      .set('Authorization', 'Bearer token').send(BODY);
    assert.deepEqual([reached.status, reached.body], [503, UNAVAILABLE]);
  });

  test('[NORMAL] [BOUNDARY] [FAILURE] [SG2-64:AC3] the owning organiser lists their outstanding requests without the impact; anyone else\'s event or a failing store is refused', async () => {
    const res = await request(harness().app).get('/events/12/change-requests');
    assert.deepEqual([res.status, res.body], [200, { event: { event_id: 12, status: 'confirmed' }, change_requests: [STORED] }]);
    const none = await request(harness({ source: listing([]) }).app).get('/events/12/change-requests');
    assert.deepEqual(none.body.change_requests, []);
    const other = await request(harness({ event: { organiser_id: 'organiser-2' } }).app).get('/events/12/change-requests');
    assert.deepEqual([other.status, other.body], [404, { error: 'Event not found.' }]);
    const missing = await request(harness({ fetchEvent: async () => ({ ok: false, reason: 'not_found' }) }).app).get('/events/12/change-requests');
    assert.equal(missing.status, 404);
    assert.equal((await request(harness().app).get('/events/x/change-requests')).status, 400);
    const failing: ChangeRequestSource = { ...listing([]), list: async () => { throw new Error('down'); } };
    for (const deps of [
      { getAdminClient: () => null },
      { fetchEvent: async () => ({ ok: false as const, reason: 'unavailable' as const }) },
      { source: failing }
    ]) {
      const failed = await request(harness(deps).app).get('/events/12/change-requests');
      assert.deepEqual([failed.status, failed.body], [503, UNAVAILABLE]);
    }
    const reached = await request(appAs('event_organiser')).get('/api/event-requests/12/change-requests')
      .set('Authorization', 'Bearer token');
    assert.deepEqual([reached.status, reached.body], [503, UNAVAILABLE]);
  });
});
