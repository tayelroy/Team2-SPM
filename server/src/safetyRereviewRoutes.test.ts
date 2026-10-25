import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization, type Principal } from './auth';
import { PERMISSIONS } from './auth/policy';
import { dbConfig } from './db/config';
import type { ConfirmSafetyRereviewResult, SafetyRereviewQueueItem } from './db/safetyRereviews';
import { createSafetyRereviewHandlers, type SafetyRereviewDependencies } from './events/safetyRereviewRoutes';

const STAFF = 'staff-1';
const ADMIN = {} as SupabaseClient;
const UNAVAILABLE = { error: 'Safety checks are temporarily unavailable. Please try again later.' };
const QUEUED: SafetyRereviewQueueItem = {
  review_id: 31, arrangement: 'venue', event_id: 7, event_name: 'Harbour Gala', proposed_date: '2030-06-20T02:00:00.000Z',
  coordinator_name: 'Casey Coordinator', flagged_at: '2030-06-01T00:00:00.000Z', label: 'Harbour Hall (20 Jun 2030 10:00 – 14:00 SGT)',
  reason: 'Move the stage', decided_by_name: 'Sam Safety', layout: 'theatre', placement_venue_name: null, placement_position: null
};

const originalConfig = { ...dbConfig };

describe('safety re-review routes behind the app (SG2-93)', () => {
  beforeEach(() => {
    dbConfig.supabaseUrl = undefined;
    dbConfig.supabaseAnonKey = undefined;
    dbConfig.supabaseServiceRoleKey = undefined;
  });
  afterEach(() => Object.assign(dbConfig, originalConfig));

  const appAs = (role: Principal['role']) => createApp(undefined,
    createAuthorization({ resolvePrincipal: async () => ({ userId: STAFF, role }), permissions: PERMISSIONS }));
  const routes: ['get' | 'post', string][] = [['get', '/api/safety-rereviews'], ['post', '/api/safety-rereviews/31/confirm']];

  test('[FAILURE] [SG2-93:AC2] a request without a session is refused with 401', async () => {
    for (const [method, path] of routes) {
      assert.equal((await request(appAs('venue_staff'))[method](path)).status, 401, path);
    }
  });

  test('[FAILURE] [SG2-93:AC2] every role but Venue Staff and Technical Support is refused with 403 before the handler runs', async () => {
    for (const role of ['event_organiser', 'event_coordinator', 'attendee', 'event_coordinator_lead', 'safety_officer'] as const) {
      for (const [method, path] of routes) {
        const res = await request(appAs(role))[method](path).set('Authorization', 'Bearer token');
        assert.deepEqual([res.status, res.body], [403, { error: 'Access denied' }], `${role} ${path}`);
      }
    }
  });

  test('[BOUNDARY] [SG2-93:AC2] Venue Staff and Technical Support reach each handler, which reports the unconfigured database as 503', async () => {
    for (const role of ['venue_staff', 'technical_support_staff'] as const) {
      for (const [method, path] of routes) {
        const res = await request(appAs(role))[method](path).set('Authorization', 'Bearer token');
        assert.deepEqual([res.status, res.body], [503, UNAVAILABLE], `${role} ${path}`);
      }
    }
  });
});

interface Harness { app: express.Express; listed: string[]; confirmed: [number, string, string][] }

function harness(overrides: Partial<SafetyRereviewDependencies> & { principal?: Principal | null } = {}): Harness {
  const listed: string[] = [];
  const confirmed: [number, string, string][] = [];
  const principal = overrides.principal === undefined ? { userId: STAFF, role: 'venue_staff' as const } : overrides.principal;
  const handlers = createSafetyRereviewHandlers({
    getPrincipal: () => principal ?? undefined,
    getAdminClient: () => ADMIN,
    listQueue: async (_admin, arrangement) => {
      listed.push(arrangement);
      return { ok: true, items: [{ ...QUEUED, arrangement }] };
    },
    confirm: async (_admin, reviewId, actorId, actingRole): Promise<ConfirmSafetyRereviewResult> => {
      confirmed.push([reviewId, actorId, actingRole]);
      return { outcome: 'ok', review_id: reviewId, event_id: 7, status: 'awaiting_safety_check', outstanding_arrangements: [] };
    },
    ...overrides
  });
  const app = express();
  app.get('/rereviews', handlers.queue);
  app.post('/rereviews/:reviewId/confirm', handlers.confirm);
  return { app, listed, confirmed };
}

describe('GET /api/safety-rereviews (SG2-93 AC2)', () => {
  test('[NORMAL] [SG2-93:AC2] Venue Staff read the flagged bookings and Technical Support the flagged equipment', async () => {
    for (const [role, arrangement] of [['venue_staff', 'venue'], ['technical_support_staff', 'equipment']] as const) {
      const { app, listed } = harness({ principal: { userId: STAFF, role } });
      const res = await request(app).get('/rereviews');
      assert.deepEqual([res.status, res.body], [200, { arrangement, rereviews: [{ ...QUEUED, arrangement }] }], role);
      assert.deepEqual(listed, [arrangement]);
    }
  });

  test('[FAILURE] [SG2-93:AC2] any other caller is refused, and an unreadable list or database is 503', async () => {
    for (const principal of [null, { userId: STAFF, role: 'safety_officer' as const }]) {
      const { app, listed } = harness({ principal });
      assert.deepEqual([(await request(app).get('/rereviews')).status, listed], [403, []]);
    }
    const failed = await request(harness({ listQueue: async () => ({ ok: false }) }).app).get('/rereviews');
    assert.deepEqual([failed.status, failed.body], [503, UNAVAILABLE]);
    const down = await request(harness({ getAdminClient: () => null }).app).get('/rereviews');
    assert.deepEqual([down.status, down.body], [503, UNAVAILABLE]);
  });
});

describe('POST /api/safety-rereviews/:reviewId/confirm (SG2-93 AC2, AC4)', () => {
  test('[NORMAL] [SG2-93:AC4] confirms as the signed-in staff member and their acting role, and says where the event now stands', async () => {
    const { app, confirmed } = harness({ principal: { userId: STAFF, role: 'technical_support_staff' } });
    const res = await request(app).post('/rereviews/31/confirm');
    assert.deepEqual([res.status, res.body], [200, { review_id: 31, event_id: 7, status: 'awaiting_safety_check', outstanding_arrangements: [] }]);
    assert.deepEqual(confirmed, [[31, STAFF, 'technical_support_staff']]);
  });

  test('[BOUNDARY] [SG2-93:AC2] review ids must be positive whole numbers that fit exactly', async () => {
    for (const id of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
      const { app, confirmed } = harness();
      const res = await request(app).post(`/rereviews/${id}/confirm`);
      assert.deepEqual([res.status, res.body, confirmed], [400, { error: 'reviewId must be a positive integer.' }, []], id);
    }
    const { app, confirmed } = harness();
    assert.equal((await request(app).post('/rereviews/9007199254740991/confirm')).status, 200);
    assert.deepEqual(confirmed, [[9007199254740991, STAFF, 'venue_staff']]);
  });

  test('[CONFLICT] [SG2-93:AC2] each database refusal is answered with its own status', async () => {
    const cases: [ConfirmSafetyRereviewResult, number, unknown][] = [
      [{ outcome: 'closed', resolution: 'withdrawn' }, 409, { error: 'This booking or equipment request has already been dealt with.', resolution: 'withdrawn' }],
      [{ outcome: 'missing' }, 404, { error: 'That safety re-review was not found.' }],
      [{ outcome: 'forbidden' }, 403, { error: 'Access denied' }],
      [{ outcome: 'unavailable' }, 503, UNAVAILABLE]
    ];
    for (const [result, status, body] of cases) {
      const res = await request(harness({ confirm: async () => result }).app).post('/rereviews/31/confirm');
      assert.deepEqual([res.status, res.body], [status, body], result.outcome);
    }
  });

  test('[FAILURE] [SG2-93:AC2] without a principal or a database nothing is confirmed', async () => {
    const anonymous = harness({ principal: null });
    const res = await request(anonymous.app).post('/rereviews/31/confirm');
    assert.deepEqual([res.status, res.body, anonymous.confirmed], [401, { error: 'Authentication required' }, []]);
    const down = await request(harness({ getAdminClient: () => null }).app).post('/rereviews/31/confirm');
    assert.deepEqual([down.status, down.body], [503, UNAVAILABLE]);
  });
});
