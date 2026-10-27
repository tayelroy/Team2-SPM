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
  ApplyAcceptedEventChangeInput,
  ApplyAcceptedEventChangeResult,
  ChangeImpactEventRecord,
  SettleArrangementRecheckResult
} from './db/changeImpact';
import {
  createMockChangeRequestSource,
  mockChangeRequests,
  type ChangeRequestEvent,
  type ChangeRequestSource
} from './changeRequests/mockChangeRequests';
import { createChangeRequestHandlers, type ChangeRequestDependencies } from './events/changeRequests';
import type { ChangeImpactFacts, RecheckKey } from './events/changeImpact';

const COORDINATOR = 'coordinator-1';
const START = '2030-06-20T02:00:00.000Z';
const END = '2030-06-20T06:00:00.000Z';
const CLOCK = new Date('2026-10-19T02:00:00.000Z');

const EVENT: ChangeImpactEventRecord = {
  event_id: 12, status: 'confirmed', coordinator_id: COORDINATOR, organiser_id: 'organiser-1',
  name: 'Harbour Showcase', purpose: 'Showcase', description: 'An evening showcase.',
  expected_attendance: 120, proposed_date: START, venue_requirements: 'A stage', accessibility_needs: null,
  equipment_requirements: null, registration_needed: true, registration_capacity: 150,
  registration_opens_at: '2026-01-01T00:00:00.000Z', registration_closes_at: '2030-06-19T16:00:00.000Z',
  planning_notes: null, expected_crowd_movement: null, arrangements_recheck_needed: false, outstanding_arrangements: []
};
const FACTS: ChangeImpactFacts = {
  venues: [{ kind: 'venue_booking', id: 5, venue_name: 'The Kelp Room', capacity: 150, starts_at: START, ends_at: END, exception_attendance: null }],
  equipment: [{ kind: 'equipment_reservation', id: 3, equipment_name: 'Wireless microphones', quantity: 12, starts_at: START, ends_at: END }],
  registrations: 40
};
const ADMIN = {} as SupabaseClient;

describe('mock change requests (stand-in for SG2-64/SG2-65)', () => {
  const event = (overrides: Partial<ChangeRequestEvent> = {}): ChangeRequestEvent =>
    ({ event_id: 12, expected_attendance: 120, proposed_date: START, description: 'Agenda', ...overrides });

  test('[NORMAL] [SG2-66:AC1] seeds an attendance, a date and a description request per event', async () => {
    const source = createMockChangeRequestSource(() => CLOCK);
    assert.deepEqual(await source.list(event()), [
      { id: 'mock-12-attendance', requested_at: '2026-10-19T02:00:00.000Z', reason: 'More guests have confirmed than planned.',
        status: 'pending', changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }] },
      { id: 'mock-12-date', requested_at: '2026-10-19T02:00:00.000Z', reason: 'The keynote speaker can only attend a week later.',
        status: 'pending', changes: [{ field: 'proposed_date', label: 'Event date and time', from: START, to: '2030-06-27T02:00:00.000Z' }] },
      { id: 'mock-12-description', requested_at: '2026-10-19T02:00:00.000Z', reason: 'Agenda wording update.',
        status: 'pending', changes: [{ field: 'description', label: 'Description', from: 'Agenda', to: 'Agenda (updated agenda)' }] }
    ]);
  });

  test('[BOUNDARY] [SG2-66:AC2] attendance rises by at least 20, unknown attendance becomes 100, and an undated event has no date request', async () => {
    const source = createMockChangeRequestSource(() => CLOCK);
    const small = await source.list(event({ event_id: 1, expected_attendance: 10 }));
    assert.deepEqual(small[0].changes[0], { field: 'expected_attendance', label: 'Expected attendance', from: 10, to: 30 });
    const odd = await source.list(event({ event_id: 2, expected_attendance: 41 }));
    assert.equal(odd[0].changes[0].to, 62);
    const blank = await source.list(event({ event_id: 3, expected_attendance: null, proposed_date: null, description: null }));
    assert.deepEqual(blank.map(request => request.id), ['mock-3-attendance', 'mock-3-description']);
    assert.deepEqual(blank[0].changes[0].to, 100);
    assert.deepEqual(blank[1].changes[0], { field: 'description', label: 'Description', from: null, to: '(updated agenda)' });
  });

  test('[CONFLICT] [SG2-66:AC4] requests stay frozen as the event changes, and accepted ones are hidden', async () => {
    let now = CLOCK;
    const source = createMockChangeRequestSource(() => now);
    const first = await source.list(event());
    now = new Date('2027-01-01T00:00:00.000Z');
    first[0].reason = 'mutated by a caller';
    assert.deepEqual(await source.list(event({ expected_attendance: 500 })), await source.list(event()));
    assert.equal((await source.get(event(), 'mock-12-attendance'))?.changes[0].to, 180);
    assert.equal((await source.get(event(), 'mock-12-attendance'))?.reason, 'More guests have confirmed than planned.');
    assert.equal(await source.decide(event(), 'mock-12-attendance', { decision: 'accepted', by: 'c' }), 'ok');
    assert.equal(await source.decide(event(), 'mock-12-attendance', { decision: 'refused', by: 'c', reason: 'r' }), 'not_pending');
    assert.equal(await source.get(event(), 'mock-12-attendance'), null);
    assert.equal(await source.get(event(), 'mock-99-attendance'), null);
    assert.deepEqual((await source.list(event())).map(request => request.id), ['mock-12-date', 'mock-12-description']);
    source.reset();
    const reseeded = await source.list(event({ expected_attendance: 500 }));
    assert.deepEqual([reseeded.length, reseeded[0].changes[0].to, reseeded[0].requested_at], [3, 750, '2027-01-01T00:00:00.000Z']);
  });

  test('[NORMAL] [SG2-66:AC1] the process-wide stand-in uses the real clock', async () => {
    const [attendance] = await mockChangeRequests.list(event({ event_id: 2147483000 }));
    assert.equal(Number.isNaN(Date.parse(attendance.requested_at)), false);
    mockChangeRequests.reset();
  });
});

const originalConfig = { ...dbConfig };

describe('change request routes behind the app (SG2-66)', () => {
  beforeEach(() => {
    dbConfig.supabaseUrl = undefined;
    dbConfig.supabaseAnonKey = undefined;
    dbConfig.supabaseServiceRoleKey = undefined;
  });
  afterEach(() => Object.assign(dbConfig, originalConfig));

  const routes: ['get' | 'post', string][] = [
    ['get', '/api/event-requests/12/change-requests'],
    ['post', '/api/event-requests/12/change-requests/mock-12-attendance/accept'],
    ['post', '/api/event-requests/12/rechecks/venue_recheck/settle']
  ];
  const appAs = (role: Principal['role']) => createApp(undefined,
    createAuthorization({ resolvePrincipal: async () => ({ userId: COORDINATOR, role }), permissions: PERMISSIONS }));

  test('[FAILURE] [SG2-66:AC1] [SG2-66:AC4] a request without a session is refused with 401', async () => {
    for (const [method, path] of routes) {
      const res = await request(appAs('event_coordinator'))[method](path);
      assert.equal(res.status, 401, path);
    }
  });

  test('[FAILURE] [SG2-66:AC1] [SG2-66:AC4] every role but the Event Coordinator is refused with 403', async () => {
    for (const role of ['event_organiser', 'venue_staff', 'technical_support_staff', 'attendee', 'event_coordinator_lead', 'safety_officer'] as const) {
      for (const [method, path] of routes) {
        // SG2-64 AC3: the organiser may read the list (their own requests only).
        if (role === 'event_organiser' && method === 'get') continue;
        const res = await request(appAs(role))[method](path).set('Authorization', 'Bearer token');
        assert.equal(res.status, 403, `${role} ${path}`);
        assert.deepEqual(res.body, { error: 'Access denied' });
      }
    }
  });

  test('[BOUNDARY] [SG2-66:AC1] [SG2-66:AC4] a coordinator reaches each handler, which reports the unconfigured database as 503', async () => {
    for (const [method, path] of routes) {
      const res = await request(appAs('event_coordinator'))[method](path).set('Authorization', 'Bearer token');
      assert.equal(res.status, 503, path);
      assert.deepEqual(res.body, { error: 'Change request service is temporarily unavailable. Please try again later.' });
    }
  });
});

interface Harness {
  app: express.Express;
  applied: ApplyAcceptedEventChangeInput[];
  settled: [number, string, RecheckKey][];
  source: ChangeRequestSource;
}

function harness(overrides: Partial<ChangeRequestDependencies> & { principal?: Principal | null; event?: Partial<ChangeImpactEventRecord> } = {}): Harness {
  const applied: ApplyAcceptedEventChangeInput[] = [];
  const settled: [number, string, RecheckKey][] = [];
  const source = overrides.source ?? createMockChangeRequestSource(() => CLOCK);
  const principal = overrides.principal === undefined ? { userId: COORDINATOR, role: 'event_coordinator' as const } : overrides.principal;
  const handlers = createChangeRequestHandlers({
    getPrincipal: () => principal ?? undefined,
    getAdminClient: () => ADMIN,
    fetchEvent: async () => ({ ok: true, event: { ...EVENT, ...overrides.event } }),
    fetchFacts: async () => ({ ok: true, facts: FACTS }),
    applyChange: async (_admin, input): Promise<ApplyAcceptedEventChangeResult> => {
      applied.push(input);
      return { outcome: 'ok', previous_status: input.expectedStatus, status: 'planning', returned_to_planning: true,
        arrangements_recheck_needed: true, outstanding_arrangements: input.outstanding };
    },
    settleRecheck: async (_admin, eventId, actorId, key): Promise<SettleArrangementRecheckResult> => {
      settled.push([eventId, actorId, key]);
      return { outcome: 'ok', arrangements_recheck_needed: false, outstanding_arrangements: [] };
    },
    now: () => CLOCK.getTime(),
    ...overrides,
    source
  });
  const app = express();
  app.get('/events/:eventId/change-requests', handlers.list);
  app.post('/events/:eventId/change-requests/:changeRequestId/accept', handlers.accept);
  app.post('/events/:eventId/rechecks/:key/settle', handlers.settle);
  return { app, applied, settled, source };
}

const UNAVAILABLE = { error: 'Change request service is temporarily unavailable. Please try again later.' };
const failing = (method: keyof ChangeRequestSource): ChangeRequestSource => {
  const source = createMockChangeRequestSource(() => CLOCK);
  return { ...source, [method]: async () => { throw new Error('store down'); } };
};

describe('GET /api/event-requests/:eventId/change-requests (SG2-66 AC1-AC3)', () => {
  test('[NORMAL] [SG2-66:AC1] [SG2-66:AC2] [SG2-66:AC3] lists each sample request with its significance and impact', async () => {
    const res = await request(harness().app).get('/events/12/change-requests');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.event, { event_id: 12, status: 'confirmed' });
    assert.equal(res.body.can_accept, true);
    const [attendance, date, description] = res.body.change_requests;
    assert.equal(attendance.id, 'mock-12-attendance');
    assert.equal(attendance.significant, true);
    assert.deepEqual(attendance.impact.outstanding_arrangements, ['venue_recheck', 'equipment_recheck', 'registration_recheck']);
    assert.deepEqual(attendance.impact.arrangements[0].reasons.map((reason: { code: string }) => reason.code), ['revalidate', 'capacity_check']);
    assert.deepEqual(date.impact.arrangements[1].reasons.map((reason: { code: string }) => reason.code), ['revalidate', 'period_recheck']);
    assert.deepEqual([description.significant, description.impact],
      [false, { requires_revalidation: false, outstanding_arrangements: [], arrangements: [] }]);
  });

  test('[BOUNDARY] [SG2-66:AC4] an event outside the changeable statuses lists requests but cannot accept them', async () => {
    const res = await request(harness({ event: { status: 'completed' } }).app).get('/events/12/change-requests');
    assert.equal(res.body.can_accept, false);
  });

  test('[FAILURE] [SG2-66:AC1] no principal, a non-coordinator and malformed ids are refused before any read', async () => {
    assert.equal((await request(harness({ principal: null }).app).get('/events/12/change-requests')).status, 401);
    const staff = await request(harness({ principal: { userId: COORDINATOR, role: 'venue_staff' } }).app).get('/events/12/change-requests');
    assert.deepEqual([staff.status, staff.body], [403, { error: 'Access denied' }]);
    for (const id of ['abc', '0', '01', '2147483648']) {
      const res = await request(harness().app).get(`/events/${id}/change-requests`);
      assert.deepEqual([res.status, res.body], [400, { error: 'eventId must be a positive integer.' }], id);
    }
  });

  test('[FAILURE] [SG2-66:AC1] an unknown event and one assigned to another coordinator are both 404', async () => {
    const missing = await request(harness({ fetchEvent: async () => ({ ok: false, reason: 'not_found' }) }).app).get('/events/12/change-requests');
    assert.deepEqual([missing.status, missing.body], [404, { error: 'Event not found.' }]);
    const other = await request(harness({ event: { coordinator_id: 'coordinator-2' } }).app).get('/events/12/change-requests');
    assert.deepEqual([other.status, other.body], [404, { error: 'Event not found.' }]);
  });

  test('[FAILURE] [SG2-66:AC1] a missing database, failed reads or a failing change-request store are 503', async () => {
    for (const deps of [
      { getAdminClient: () => null },
      { fetchEvent: async () => ({ ok: false as const, reason: 'unavailable' as const }) },
      { fetchFacts: async () => ({ ok: false as const, reason: 'unavailable' as const }) },
      { source: failing('list') }
    ]) {
      const res = await request(harness(deps).app).get('/events/12/change-requests');
      assert.deepEqual([res.status, res.body], [503, UNAVAILABLE]);
    }
  });
});

describe('POST /api/event-requests/:eventId/change-requests/:id/accept (SG2-66 AC4/AC7)', () => {
  test('[NORMAL] [SG2-66:AC4] [SG2-66:AC7] applies the change with freshly computed rechecks and hides the request', async () => {
    const { app, applied } = harness();
    const res = await request(app).post('/events/12/change-requests/mock-12-attendance/accept').send({ outstanding: [] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { event_id: 12, previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
      arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck', 'equipment_recheck', 'registration_recheck'] });
    assert.deepEqual(applied, [{ eventId: 12, actorId: COORDINATOR, expectedStatus: 'confirmed',
      changeReference: 'change request mock-12-attendance', changes: { expected_attendance: 180 },
      outstanding: ['venue_recheck', 'equipment_recheck', 'registration_recheck'] }]);
    const listed = await request(app).get('/events/12/change-requests');
    assert.deepEqual(listed.body.change_requests.map((item: { id: string }) => item.id), ['mock-12-date', 'mock-12-description']);
    const again = await request(app).post('/events/12/change-requests/mock-12-attendance/accept');
    assert.deepEqual([again.status, again.body], [404, { error: 'Change request not found.' }]);
  });

  test('[BOUNDARY] [SG2-66:AC1] a non-significant change is applied with nothing to recheck', async () => {
    const { app, applied } = harness();
    assert.equal((await request(app).post('/events/12/change-requests/mock-12-description/accept')).status, 200);
    assert.deepEqual(applied[0].outstanding, []);
    assert.deepEqual(applied[0].changes, { description: 'An evening showcase. (updated agenda)' });
  });

  test('[CONFLICT] [SG2-66:AC4] an event in a status that cannot change is refused with 409', async () => {
    for (const status of ['draft', 'under_review', 'rejected', 'safety_rejected', 'completed', 'cancelled']) {
      const { app, applied } = harness({ event: { status } });
      const res = await request(app).post('/events/12/change-requests/mock-12-attendance/accept');
      assert.deepEqual([res.status, res.body], [409, { error: 'A change can only be accepted while the event is returned for clarification, '
        + 'Approved, in Planning, Awaiting Safety Check, in Preparation or Confirmed.' }], status);
      assert.equal(applied.length, 0);
    }
  });

  test('[FAILURE] [SG2-66:AC3] a date change that breaks the planning schedule is refused with 400', async () => {
    const { app, applied } = harness({ now: () => Date.parse('2031-01-01T00:00:00.000Z') });
    const res = await request(app).post('/events/12/change-requests/mock-12-date/accept');
    assert.deepEqual([res.status, res.body], [400, { error: 'Invalid change', details: ['proposed_date must be in the future.'] }]);
    assert.equal(applied.length, 0);
  });

  test('[CONFLICT] [SG2-66:AC4] a status or assignment that changed concurrently is reported as stale', async () => {
    const { app } = harness({ applyChange: async () => ({ outcome: 'stale' }) });
    const res = await request(app).post('/events/12/change-requests/mock-12-attendance/accept');
    assert.deepEqual([res.status, res.body], [409, { error: 'This event changed while you were deciding. Refresh and try again.' }]);
    assert.equal((await request(app).get('/events/12/change-requests')).body.change_requests.length, 3);
  });

  test('[FAILURE] [SG2-66:AC4] an unknown request is 404 and store, read or database failures are 503', async () => {
    const unknown = await request(harness().app).post('/events/12/change-requests/mock-13-attendance/accept');
    assert.deepEqual([unknown.status, unknown.body], [404, { error: 'Change request not found.' }]);
    for (const deps of [
      { source: failing('get') },
      { fetchFacts: async () => ({ ok: false as const, reason: 'unavailable' as const }) },
      { applyChange: async () => ({ outcome: 'unavailable' as const }) },
      { source: failing('decide') }
    ]) {
      const res = await request(harness(deps).app).post('/events/12/change-requests/mock-12-attendance/accept');
      assert.deepEqual([res.status, res.body], [503, UNAVAILABLE]);
    }
  });
});

describe('POST /api/event-requests/:eventId/rechecks/:key/settle (SG2-66 AC4)', () => {
  const outstanding = { outstanding_arrangements: ['venue_recheck', 'registration_recheck'], arrangements_recheck_needed: true };

  test('[NORMAL] [SG2-66:AC4] a passing outstanding recheck is settled', async () => {
    const { app, settled } = harness({ event: outstanding });
    const res = await request(app).post('/events/12/rechecks/registration_recheck/settle');
    assert.deepEqual([res.status, res.body], [200, { event_id: 12, arrangements_recheck_needed: false, outstanding_arrangements: [] }]);
    assert.deepEqual(settled, [[12, COORDINATOR, 'registration_recheck']]);
  });

  test('[FAILURE] [SG2-66:AC4] an unknown key is 400 and a key that is not outstanding is 409', async () => {
    const bad = await request(harness({ event: outstanding }).app).post('/events/12/rechecks/safety_recheck/settle');
    assert.deepEqual([bad.status, bad.body], [400, { error: 'key must be one of venue_recheck, equipment_recheck, registration_recheck, '
      + 'safety_venue_recheck, safety_equipment_recheck, safety_other_recheck.' }]);
    const { app, settled } = harness({ event: outstanding });
    const absent = await request(app).post('/events/12/rechecks/equipment_recheck/settle');
    assert.deepEqual([absent.status, absent.body], [409, { error: 'That arrangement is not waiting for a recheck.' }]);
    assert.equal(settled.length, 0);
  });

  test('[CONFLICT] [SG2-66:AC2] [SG2-66:AC4] a venue still too small blocks settling and lists why', async () => {
    const { app, settled } = harness({ event: { ...outstanding, expected_attendance: 151 } });
    const res = await request(app).post('/events/12/rechecks/venue_recheck/settle');
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'This arrangement still needs attention before it can be marked rechecked.', blockers: [
      "The revised attendance of 151 is above The Kelp Room's capacity of 150. A new capacity check is needed: "
      + 'only Venue Staff can approve a capacity exception for the revised attendance.'
    ] });
    assert.equal(settled.length, 0);
  });

  test('[CONFLICT] [SG2-66:AC4] concurrent settling or reassignment is refused, and failures are 503', async () => {
    const cases: [SettleArrangementRecheckResult, number, unknown][] = [
      [{ outcome: 'not_outstanding' }, 409, { error: 'That arrangement is not waiting for a recheck.' }],
      [{ outcome: 'stale' }, 409, { error: 'This event changed while you were deciding. Refresh and try again.' }],
      [{ outcome: 'unavailable' }, 503, UNAVAILABLE]
    ];
    for (const [result, status, body] of cases) {
      const res = await request(harness({ event: outstanding, settleRecheck: async () => result }).app)
        .post('/events/12/rechecks/venue_recheck/settle');
      assert.deepEqual([res.status, res.body], [status, body], result.outcome);
    }
    const facts = await request(harness({ event: outstanding, fetchFacts: async () => ({ ok: false, reason: 'unavailable' }) }).app)
      .post('/events/12/rechecks/venue_recheck/settle');
    assert.deepEqual([facts.status, facts.body], [503, UNAVAILABLE]);
  });

  // SG2-93 AC4: a change the Safety Officer asked for is checked by the
  // database, which knows which flagged requests staff have not confirmed.
  const safety = { outstanding_arrangements: ['safety_venue_recheck', 'safety_equipment_recheck', 'safety_other_recheck'],
    arrangements_recheck_needed: true, expected_attendance: 151, registration_needed: true, registration_closes_at: null };

  test('[CONFLICT] [SG2-93:AC4] a venue or equipment change is refused while staff have not confirmed the flagged requests again, naming each', async () => {
    const result: SettleArrangementRecheckResult = { outcome: 'flagged', waiting: [
      { arrangement: 'venue', label: 'The Kelp Room (20 Jun 2030 10:00 – 14:00 SGT)' },
      { arrangement: 'equipment', label: '4 × Wireless microphones' }
    ] };
    const res = await request(harness({ event: safety, settleRecheck: async () => result }).app)
      .post('/events/12/rechecks/safety_venue_recheck/settle');
    assert.deepEqual([res.status, res.body], [409, { error: 'This arrangement still needs attention before it can be marked rechecked.', blockers: [
      'The Kelp Room (20 Jun 2030 10:00 – 14:00 SGT) is waiting for Venue Staff to confirm it again.',
      '4 × Wireless microphones is waiting for Technical Support to confirm it again.'
    ] }]);
  });

  test('[NORMAL] [SG2-93:AC4] a safety change is settled by the database alone, whatever SG2-66 would say about the venue or registration', async () => {
    for (const key of ['safety_venue_recheck', 'safety_equipment_recheck', 'safety_other_recheck']) {
      const { app, settled } = harness({ event: safety });
      const res = await request(app).post(`/events/12/rechecks/${key}/settle`);
      assert.equal(res.status, 200, key);
      assert.deepEqual(settled, [[12, COORDINATOR, key]], key);
    }
  });
});
