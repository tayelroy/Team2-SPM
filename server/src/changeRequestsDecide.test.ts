import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization, type Principal } from './auth';
import { PERMISSIONS } from './auth/policy';
import { dbConfig } from './db/config';
import type { ApplyAcceptedEventChangeInput, ChangeImpactEventRecord } from './db/changeImpact';
import type { ChangeDecision, ChangeRequest, ChangeRequestSource } from './changeRequests/mockChangeRequests';
import { createChangeRequestHandlers, type ChangeRequestDependencies } from './events/changeRequests';

const COORDINATOR = 'coordinator-1';
const EVENT = {
  event_id: 12, status: 'planning', coordinator_id: COORDINATOR, organiser_id: 'organiser-1',
  name: 'Harbour Showcase', expected_attendance: 120, proposed_date: null, description: null,
  arrangements_recheck_needed: false, outstanding_arrangements: [], registration_capacity: null
} as unknown as ChangeImpactEventRecord;
const STORED: ChangeRequest = {
  id: '41', requested_at: '2026-10-24T02:00:00.000Z', reason: 'More guests confirmed.', status: 'pending',
  changes: [{ field: 'description', label: 'Description', from: null, to: 'New agenda' }]
};
const UNAVAILABLE = { error: 'Change request service is temporarily unavailable. Please try again later.' };
const DECIDED = { error: 'This change request has already been decided. Refresh to see the latest.' };
const REASON_ERROR = { error: 'Give a reason for refusing, up to 1000 characters.' };
const NEXT_STEP_ERROR = { error: 'Choose whether the request goes back to review or the organiser resubmits it.' };

/** One stored request; records every decision and answers with `outcome`. */
function store(outcome: 'ok' | 'not_pending' | 'not_found' | 'throws' = 'ok') {
  const decisions: [string, ChangeDecision][] = [];
  const source: ChangeRequestSource = {
    list: async () => [STORED],
    get: async (_event, id) => (id === STORED.id ? STORED : null),
    decide: async (_event, id, decision) => {
      if (outcome === 'throws') throw new Error('store down');
      decisions.push([id, decision]);
      return outcome;
    }
  };
  return { source, decisions };
}

function harness(overrides: Partial<ChangeRequestDependencies> & { event?: Partial<ChangeImpactEventRecord> } = {}) {
  const applied: ApplyAcceptedEventChangeInput[] = [];
  const handlers = createChangeRequestHandlers({
    getPrincipal: () => ({ userId: COORDINATOR, role: 'event_coordinator' }),
    getAdminClient: () => ({}) as SupabaseClient,
    fetchEvent: async () => ({ ok: true, event: { ...EVENT, ...overrides.event } }),
    fetchFacts: async () => ({ ok: true, facts: { venues: [], equipment: [], registrations: 0 } }),
    applyChange: async (_admin, input) => {
      applied.push(input);
      return { outcome: 'ok', previous_status: input.expectedStatus, status: input.expectedStatus, returned_to_planning: false,
        arrangements_recheck_needed: false, outstanding_arrangements: [] };
    },
    now: () => Date.parse('2026-10-26T00:00:00.000Z'),
    ...overrides
  });
  const app = express();
  app.use(express.json());
  app.get('/events/:eventId/change-requests', handlers.list);
  app.post('/events/:eventId/change-requests/:changeRequestId/accept', handlers.accept);
  app.post('/events/:eventId/change-requests/:changeRequestId/refuse', handlers.refuse);
  return { app, applied };
}

const refuse = (app: express.Express, body: unknown, id = '41') =>
  request(app).post(`/events/12/change-requests/${id}/refuse`).send(body as object);
const accept = (app: express.Express, body: unknown = {}) =>
  request(app).post('/events/12/change-requests/41/accept').send(body as object);

// The mounted-route check runs createApp, which must not reach a real database.
const originalConfig = { ...dbConfig };
beforeEach(() => {
  dbConfig.supabaseUrl = undefined;
  dbConfig.supabaseAnonKey = undefined;
  dbConfig.supabaseServiceRoleKey = undefined;
});
afterEach(() => Object.assign(dbConfig, originalConfig));
const appAs = (role: Principal['role']) => createApp(undefined,
  createAuthorization({ resolvePrincipal: async () => ({ userId: 'someone', role }), permissions: PERMISSIONS }));

describe('refusing a change request (SG2-65 AC2/AC3)', () => {
  test('[NORMAL] [BOUNDARY] [SG2-65:AC2] [SG2-65:AC3] the assigned coordinator refuses with a trimmed reason of up to 1000 characters, recorded against them, and the event is not changed; a missing, blank or 1001-character reason records nothing', async () => {
    const { source, decisions } = store();
    const { app, applied } = harness({ source });
    for (const body of [{}, { reason: '   ' }, { reason: 42 }, { reason: 'r'.repeat(1001) }, null]) {
      const res = await refuse(app, body);
      assert.deepEqual([res.status, res.body], [400, REASON_ERROR], JSON.stringify(body));
    }
    assert.deepEqual(decisions, []);
    const res = await refuse(app, { reason: '  No larger room is free.  ' });
    assert.deepEqual([res.status, res.body], [200, { event_id: 12, change_request_id: '41', status: 'refused' }]);
    assert.equal((await refuse(app, { reason: ` ${'r'.repeat(1000)} ` })).status, 200);
    assert.deepEqual(decisions, [
      ['41', { decision: 'refused', by: COORDINATOR, reason: 'No larger room is free.' }],
      ['41', { decision: 'refused', by: COORDINATOR, reason: 'r'.repeat(1000) }]
    ]);
    assert.deepEqual(applied, []);
  });

  test('[CONFLICT] [FAILURE] [SG2-65:AC2] [SG2-65:AC3] a request decided meanwhile is 409, an unknown one, another coordinator\'s event or one reassigned meanwhile 404, a failing store 503, and only an Event Coordinator reaches the mounted route', async () => {
    assert.deepEqual(await refuse(harness({ source: store('not_pending').source }).app, { reason: 'No.' })
      .then(res => [res.status, res.body]), [409, DECIDED]);
    assert.deepEqual(await refuse(harness({ source: store('not_found').source }).app, { reason: 'No.' })
      .then(res => [res.status, res.body]), [404, { error: 'Event not found.' }]);
    const unknown = await refuse(harness({ source: store().source }).app, { reason: 'No.' }, '99');
    assert.deepEqual([unknown.status, unknown.body], [404, { error: 'Change request not found.' }]);
    const other = await refuse(harness({ event: { coordinator_id: 'coordinator-2' } }).app, { reason: 'No.' });
    assert.deepEqual([other.status, other.body], [404, { error: 'Event not found.' }]);

    const reading = store();
    reading.source.get = async () => { throw new Error('store down'); };
    for (const source of [reading.source, store('throws').source]) {
      const res = await refuse(harness({ source }).app, { reason: 'No.' });
      assert.deepEqual([res.status, res.body], [503, UNAVAILABLE]);
    }

    for (const role of ['event_organiser', 'attendee', 'safety_officer'] as Principal['role'][]) {
      const res = await request(appAs(role)).post('/api/event-requests/12/change-requests/41/refuse')
        .set('Authorization', 'Bearer t').send({ reason: 'No.' });
      assert.equal(res.status, 403, role);
    }
    const coordinator = await request(appAs('event_coordinator')).post('/api/event-requests/12/change-requests/41/refuse')
      .set('Authorization', 'Bearer t').send({ reason: 'No.' });
    assert.equal(coordinator.status, 503);
  });
});

describe('accepting a change request (SG2-65 AC1/AC4/AC5)', () => {
  test('[NORMAL] [SG2-65:AC1] [SG2-65:AC3] [SG2-65:AC5] on an open status SG2-66 applies the change first and then the acceptance is recorded; a significant change on a Confirmed event comes back in Planning', async () => {
    const { source, decisions } = store();
    const { app, applied } = harness({ source });
    const listed = await request(app).get('/events/12/change-requests');
    assert.deepEqual([listed.body.can_accept, listed.body.next_step_required], [true, false]);
    const res = await accept(app);
    assert.equal(res.status, 200);
    assert.deepEqual(applied.map(input => input.changes), [{ description: 'New agenda' }]);
    assert.deepEqual(decisions, [['41', { decision: 'accepted', by: COORDINATOR }]]);

    // AC5: the significant attendance change on a Confirmed event is applied
    // as Confirmed, and SG2-66's return to Planning is what the route reports.
    const significant = store();
    significant.source.get = async () => ({ ...STORED,
      changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }] });
    const returned: ApplyAcceptedEventChangeInput[] = [];
    const confirmed = harness({
      source: significant.source,
      event: { status: 'confirmed' },
      applyChange: async (_admin, input) => {
        returned.push(input);
        return { outcome: 'ok', previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
          arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck'] };
      }
    });
    const back = await accept(confirmed.app);
    assert.deepEqual([back.status, back.body], [200, {
      event_id: 12, previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
      arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck']
    }]);
    assert.deepEqual(returned.map(input => [input.expectedStatus, input.changes]), [['confirmed', { expected_attendance: 180 }]]);
    assert.deepEqual(significant.decisions, [['41', { decision: 'accepted', by: COORDINATOR }]]);
  });

  test('[NORMAL] [BOUNDARY] [CONFLICT] [FAILURE] [SG2-65:AC4] on a request returned for clarification the coordinator must choose back to review or resubmit, SG2-66\'s apply is not used, and a decided request, a closed event or a failing store are refused', async () => {
    const { source, decisions } = store();
    const { app, applied } = harness({ source, event: { status: 'needs_clarification' } });
    const listed = await request(app).get('/events/12/change-requests');
    assert.deepEqual([listed.body.can_accept, listed.body.next_step_required], [true, true]);

    // BOUNDARY: no valid next step, nothing recorded.
    for (const body of [{}, { next: 'later' }, { next: 'REVIEW' }]) {
      const res = await accept(app, body);
      assert.deepEqual([res.status, res.body], [400, NEXT_STEP_ERROR], JSON.stringify(body));
    }
    assert.deepEqual(decisions, []);

    // NORMAL: both next steps.
    const review = await accept(app, { next: 'review' });
    const resubmit = await accept(app, { next: 'resubmit' });
    assert.deepEqual([review.status, review.body], [200, {
      event_id: 12, previous_status: 'needs_clarification', status: 'under_review', returned_to_planning: false,
      arrangements_recheck_needed: false, outstanding_arrangements: []
    }]);
    assert.equal(resubmit.body.status, 'needs_clarification');
    assert.deepEqual(decisions, [
      ['41', { decision: 'accepted', by: COORDINATOR, next: 'review' }],
      ['41', { decision: 'accepted', by: COORDINATOR, next: 'resubmit' }]
    ]);
    assert.deepEqual(applied, []);

    // CONFLICT: decided meanwhile, or a status that cannot accept.
    const decided = await accept(harness({ source: store('not_pending').source, event: { status: 'needs_clarification' } }).app,
      { next: 'review' });
    assert.deepEqual([decided.status, decided.body], [409, DECIDED]);
    const closed = await accept(harness({ source: store().source, event: { status: 'under_review' } }).app);
    assert.equal(closed.status, 409);
    assert.match(closed.body.error, /returned for clarification, Approved/);

    // FAILURE: the decision store is down.
    const failing = await accept(harness({ source: store('throws').source, event: { status: 'needs_clarification' } }).app,
      { next: 'resubmit' });
    assert.deepEqual([failing.status, failing.body], [503, UNAVAILABLE]);
  });
});
