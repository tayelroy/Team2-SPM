import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization, type Principal } from './auth';
import { PERMISSIONS } from './auth/policy';
import { dbConfig } from './db/config';
import type {
  RecordSafetyDecisionInput,
  RecordSafetyDecisionResult,
  ReworkSafetyRejectedEventResult,
  SafetyDecisionRecord
} from './db/safetyDecisions';
import { createSafetyCheckHandlers, type SafetyCheckDependencies } from './events/safetyChecks';
import type { SafetyCheckEvent } from './safetyChecks/standInQueue';

const SAFETY = 'safety-1';
const COORDINATOR = 'coordinator-1';
const ORGANISER = 'organiser-1';
const ADMIN = {} as SupabaseClient;
const UNAVAILABLE = { error: 'Safety checks are temporarily unavailable. Please try again later.' };

const QUEUED: SafetyCheckEvent = {
  event_id: 12, name: 'Harbour Gala', proposed_date: '2030-06-20T02:00:00.000Z', expected_attendance: 300,
  accessibility_needs: 'Step-free access', coordinator_name: 'Casey Coordinator',
  venues: [{ name: 'Harbour Hall', capacity: 400, starts_at: '2030-06-20T01:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' }],
  equipment: [{ name: 'Wireless microphone', quantity: 2, placement_position: 'Stage left' }]
};
const STORED: SafetyDecisionRecord = {
  decision_id: 9, event_id: 12, decision: 'request_changes', reason: 'Move the stage', arrangements: ['venue'],
  decided_by: SAFETY, decided_by_name: 'Sam Safety', decided_at: '2030-06-01T00:00:00.000Z'
};

const originalConfig = { ...dbConfig };

describe('safety check routes behind the app (SG2-92)', () => {
  beforeEach(() => {
    dbConfig.supabaseUrl = undefined;
    dbConfig.supabaseAnonKey = undefined;
    dbConfig.supabaseServiceRoleKey = undefined;
  });
  afterEach(() => Object.assign(dbConfig, originalConfig));

  const appAs = (role: Principal['role']) => createApp(undefined,
    createAuthorization({ resolvePrincipal: async () => ({ userId: SAFETY, role }), permissions: PERMISSIONS }));
  const routes: [Principal['role'][], 'get' | 'post', string][] = [
    [['safety_officer'], 'get', '/api/safety-checks'],
    [['safety_officer'], 'post', '/api/event-requests/12/safety-decision'],
    [['safety_officer', 'event_coordinator', 'event_organiser'], 'get', '/api/event-requests/12/safety-decisions'],
    [['event_coordinator'], 'post', '/api/event-requests/12/rework']
  ];
  const ROLES: Principal['role'][] = ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee',
    'event_coordinator_lead', 'safety_officer'];

  test('[FAILURE] [SG2-92:AC1] a request without a session is refused with 401', async () => {
    for (const [, method, path] of routes) {
      assert.equal((await request(appAs('safety_officer'))[method](path)).status, 401, path);
    }
  });

  test('[FAILURE] [SG2-92:AC1] [SG2-92:AC4] every role outside each route\'s grant is refused with 403 before the handler runs', async () => {
    for (const [allowed, method, path] of routes) {
      for (const role of ROLES.filter(role => !allowed.includes(role))) {
        const res = await request(appAs(role))[method](path).set('Authorization', 'Bearer token').send({ decision: 'approve' });
        assert.deepEqual([res.status, res.body], [403, { error: 'Access denied' }], `${role} ${path}`);
      }
    }
  });

  test('[BOUNDARY] [SG2-92:AC1] [SG2-92:AC4] [SG2-92:AC6] an allowed role reaches each handler, which reports the unconfigured database as 503', async () => {
    for (const [allowed, method, path] of routes) {
      const res = await request(appAs(allowed[0]))[method](path).set('Authorization', 'Bearer token').send({ decision: 'approve' });
      assert.deepEqual([res.status, res.body], [503, UNAVAILABLE], path);
    }
  });
});

interface Harness { app: express.Express; recorded: RecordSafetyDecisionInput[]; reworked: [number, string][] }

function harness(overrides: Partial<SafetyCheckDependencies> & { principal?: Principal | null } = {}): Harness {
  const recorded: RecordSafetyDecisionInput[] = [];
  const reworked: [number, string][] = [];
  const principal = overrides.principal === undefined ? { userId: SAFETY, role: 'safety_officer' as const } : overrides.principal;
  const handlers = createSafetyCheckHandlers({
    getPrincipal: () => principal ?? undefined,
    getAdminClient: () => ADMIN,
    queue: { list: async () => ({ ok: true, events: [QUEUED] }) },
    fetchEvent: async () => ({ ok: true, event: { event_id: 12, status: 'planning', organiser_id: ORGANISER, coordinator_id: COORDINATOR } }),
    listDecisions: async () => ({ ok: true, decisions: [STORED] }),
    recordDecision: async (_admin, input): Promise<RecordSafetyDecisionResult> => {
      recorded.push(input);
      return { outcome: 'ok', decision_id: 9, decision: input.decision, previous_status: 'awaiting_safety_check',
        status: 'planning', decided_at: '2030-06-01T00:00:00.000Z' };
    },
    rework: async (_admin, eventId, actorId): Promise<ReworkSafetyRejectedEventResult> => {
      reworked.push([eventId, actorId]);
      return { outcome: 'ok', status: 'planning' };
    },
    ...overrides
  });
  const app = express();
  app.use(express.json());
  app.get('/safety-checks', handlers.queue);
  app.post('/events/:eventId/safety-decision', handlers.record);
  app.get('/events/:eventId/safety-decisions', handlers.decisions);
  app.post('/events/:eventId/rework', handlers.rework);
  return { app, recorded, reworked };
}

describe('GET /api/safety-checks (SG2-92; stand-in for SG2-91)', () => {
  test('[NORMAL] [SG2-92:AC1] lists the events awaiting a check, labelled as the stand-in', async () => {
    const res = await request(harness().app).get('/safety-checks');
    assert.deepEqual([res.status, res.body], [200, { source: 'stand-in', events: [QUEUED] }]);
  });

  test('[FAILURE] [SG2-92:AC1] an unreadable queue is 503 without details', async () => {
    const res = await request(harness({ queue: { list: async () => ({ ok: false }) } }).app).get('/safety-checks');
    assert.deepEqual([res.status, res.body], [503, UNAVAILABLE]);
  });
});

describe('POST /api/event-requests/:eventId/safety-decision (SG2-92)', () => {
  test('[NORMAL] [SG2-92:AC1] [SG2-92:AC2] [SG2-92:AC6] a valid decision is recorded as the signed-in Safety Officer and returned as stored', async () => {
    const { app, recorded } = harness();
    const res = await request(app).post('/events/12/safety-decision')
      .send({ decision: 'request_changes', reason: ' Move the stage ', arrangements: ['venue'], decided_by: 'forged', event_id: 99 });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { decision: STORED, previous_status: 'awaiting_safety_check', status: 'planning' });
    assert.deepEqual(recorded, [{ decision: 'request_changes', reason: 'Move the stage', arrangements: ['venue'], eventId: 12, actorId: SAFETY }]);
  });

  test('[BOUNDARY] [SG2-92:AC6] when the history cannot be re-read the response is built from what was recorded', async () => {
    for (const listDecisions of [async () => ({ ok: false as const }), async () => ({ ok: true as const, decisions: [] })]) {
      const res = await request(harness({ listDecisions }).app).post('/events/12/safety-decision').send({ decision: 'approve' });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body.decision, {
        decision_id: 9, event_id: 12, decision: 'approve', reason: null, arrangements: [],
        decided_by: SAFETY, decided_by_name: null, decided_at: '2030-06-01T00:00:00.000Z'
      });
    }
  });

  test('[FAILURE] [SG2-92:AC2] an invalid decision is refused with every problem before anything is written', async () => {
    const { app, recorded } = harness();
    const res = await request(app).post('/events/12/safety-decision').send({ decision: 'request_changes', reason: '' });
    assert.deepEqual([res.status, res.body], [400, { error: 'Invalid safety decision',
      details: ['A reason is required to request changes.', 'Name at least one arrangement to change.'] }]);
    assert.deepEqual(recorded, []);
  });

  test('[BOUNDARY] [SG2-92:AC1] event ids must be positive whole numbers that fit the database', async () => {
    for (const id of ['0', '-1', '1.5', 'abc', '2147483648']) {
      const res = await request(harness().app).post(`/events/${id}/safety-decision`).send({ decision: 'approve' });
      assert.deepEqual([res.status, res.body], [400, { error: 'eventId must be a positive integer.' }], id);
    }
  });

  test('[CONFLICT] [SG2-92:AC1] each database refusal is answered with its own status', async () => {
    const cases: [RecordSafetyDecisionResult, number, unknown][] = [
      [{ outcome: 'closed', status: 'preparation' }, 409, { error: 'This event is no longer awaiting a safety check.', status: 'preparation' }],
      [{ outcome: 'missing' }, 404, { error: 'Event not found.' }],
      [{ outcome: 'forbidden' }, 403, { error: 'Access denied' }],
      [{ outcome: 'invalid' }, 400, { error: 'Invalid safety decision', details: [] }],
      [{ outcome: 'unavailable' }, 503, UNAVAILABLE]
    ];
    for (const [result, status, body] of cases) {
      const res = await request(harness({ recordDecision: async () => result }).app).post('/events/12/safety-decision').send({ decision: 'approve' });
      assert.deepEqual([res.status, res.body], [status, body], result.outcome);
    }
  });

  test('[FAILURE] [SG2-92:AC1] without a principal or a database the decision is refused', async () => {
    const anonymous = await request(harness({ principal: null }).app).post('/events/12/safety-decision').send({ decision: 'approve' });
    assert.deepEqual([anonymous.status, anonymous.body], [401, { error: 'Authentication required' }]);
    const down = await request(harness({ getAdminClient: () => null }).app).post('/events/12/safety-decision').send({ decision: 'approve' });
    assert.deepEqual([down.status, down.body], [503, UNAVAILABLE]);
  });
});

describe('GET /api/event-requests/:eventId/safety-decisions (SG2-92 AC6)', () => {
  test('[NORMAL] [SG2-92:AC6] the Safety Officer, the assigned coordinator and the organiser read every decision', async () => {
    for (const principal of [
      { userId: 'any-safety', role: 'safety_officer' as const },
      { userId: COORDINATOR, role: 'event_coordinator' as const },
      { userId: ORGANISER, role: 'event_organiser' as const }
    ]) {
      const res = await request(harness({ principal }).app).get('/events/12/safety-decisions');
      assert.deepEqual([res.status, res.body], [200, { decisions: [STORED] }], principal.role);
    }
  });

  test('[FAILURE] [SG2-92:AC6] another coordinator, another organiser or a missing event learn only that it was not found', async () => {
    const notFound = [404, { error: 'Event not found.' }];
    for (const principal of [{ userId: 'other', role: 'event_coordinator' as const }, { userId: 'other', role: 'event_organiser' as const }]) {
      const res = await request(harness({ principal }).app).get('/events/12/safety-decisions');
      assert.deepEqual([res.status, res.body], notFound, principal.role);
    }
    const missing = await request(harness({ fetchEvent: async () => ({ ok: false, reason: 'not_found' }) }).app).get('/events/12/safety-decisions');
    assert.deepEqual([missing.status, missing.body], notFound);
  });

  test('[FAILURE] [SG2-92:AC6] a failed event or history read is 503', async () => {
    const event = await request(harness({ fetchEvent: async () => ({ ok: false, reason: 'unavailable' }) }).app).get('/events/12/safety-decisions');
    assert.deepEqual([event.status, event.body], [503, UNAVAILABLE]);
    const history = await request(harness({ listDecisions: async () => ({ ok: false }) }).app).get('/events/12/safety-decisions');
    assert.deepEqual([history.status, history.body], [503, UNAVAILABLE]);
  });
});

describe('POST /api/event-requests/:eventId/rework (SG2-92 AC4)', () => {
  const coordinator = { userId: COORDINATOR, role: 'event_coordinator' as const };

  test('[NORMAL] [SG2-92:AC4] the assigned coordinator takes a Safety Rejected event back to Planning', async () => {
    const { app, reworked } = harness({ principal: coordinator });
    const res = await request(app).post('/events/12/rework');
    assert.deepEqual([res.status, res.body], [200, { event_id: 12, status: 'planning' }]);
    assert.deepEqual(reworked, [[12, COORDINATOR]]);
  });

  test('[CONFLICT] [SG2-92:AC4] an event that is not Safety Rejected, or not the caller\'s, is refused', async () => {
    const cases: [ReworkSafetyRejectedEventResult, number, unknown][] = [
      [{ outcome: 'closed', status: 'planning' }, 409, { error: 'Only a Safety Rejected event can be reworked.', status: 'planning' }],
      [{ outcome: 'missing' }, 404, { error: 'Event not found.' }],
      [{ outcome: 'unavailable' }, 503, UNAVAILABLE]
    ];
    for (const [result, status, body] of cases) {
      const res = await request(harness({ principal: coordinator, rework: async () => result }).app).post('/events/12/rework');
      assert.deepEqual([res.status, res.body], [status, body], result.outcome);
    }
  });
});
