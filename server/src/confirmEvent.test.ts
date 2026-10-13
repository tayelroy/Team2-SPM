import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createConfirmEventHandler } from './events/confirm';
import { AccessError, type Principal } from './auth/policy';
import type { ConfirmEventResult } from './db/eventConfirmation';

const COORDINATOR: Principal = { userId: '20000000-0000-4000-8000-000000000002', role: 'event_coordinator' };

function buildApp(
  confirm: (token: string, eventId: number) => Promise<ConfirmEventResult>,
  principal: Principal | null = COORDINATOR
) {
  const app = express();
  app.patch('/api/event-requests/:eventId/confirm', createConfirmEventHandler({ getPrincipal: () => principal ?? undefined, confirm }));
  return app;
}

const patch = (app: express.Express, id = '7') =>
  request(app).patch(`/api/event-requests/${id}/confirm`).set('Authorization', 'Bearer coordinator-token');

describe('PATCH /api/event-requests/:eventId/confirm (SG2-58)', () => {
  test('[NORMAL] [SG2-58:AC1] a ready event in Preparation is confirmed and the organiser notice is reported', async () => {
    const calls: unknown[] = [];
    const res = await patch(buildApp(async (token, eventId) => {
      calls.push([token, eventId]);
      return { outcome: 'ok', event_id: 7, status: 'confirmed', confirmed_at: '2026-10-11T08:00:00.123456+00:00', organiser_notified: true };
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      event_id: 7, status: 'confirmed', confirmed_at: '2026-10-11T08:00:00.123456+00:00', organiser_notified: true
    });
    assert.deepEqual(calls, [['coordinator-token', 7]]);
  });

  test('[NORMAL] [SG2-58:AC2] outstanding arrangements refuse confirmation with 409 and the exact list', async () => {
    const res = await patch(buildApp(async () => ({ outcome: 'outstanding', outstanding: ['venue', 'registration'] })));
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: 'Confirmation refused: arrangements are still outstanding.', code: 'outstanding', outstanding: ['venue', 'registration']
    });
  });

  test('[CONFLICT] [SG2-58:AC1] an event no longer in Preparation (e.g. already confirmed) is refused with 409 closed', async () => {
    const res = await patch(buildApp(async () => ({ outcome: 'closed', status: 'confirmed' })));
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'Only an event in Preparation can be confirmed.', code: 'closed' });
  });

  test('[FAILURE] [SG2-58:AC1] another coordinator\'s or a missing event is a 404 that reveals nothing', async () => {
    const res = await patch(buildApp(async () => ({ outcome: 'missing' })));
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'No event in preparation is assigned to this account.' });
  });

  test('[BOUNDARY] [SG2-58:AC1] only canonical ids from 1 to 2147483647 reach the database', async () => {
    let calls = 0;
    const app = buildApp(async () => { calls++; return { outcome: 'missing' }; });
    for (const id of ['0', '-1', '1.5', 'abc', '01', '2147483648', '1e3']) {
      const res = await patch(app, id);
      assert.equal(res.status, 400, id);
      assert.deepEqual(res.body, { error: 'eventId must be a positive integer.' });
    }
    assert.equal(calls, 0);
    assert.equal((await patch(app, '2147483647')).status, 404);
    assert.equal((await patch(app, '1')).status, 404);
    assert.equal(calls, 2);
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-58:AC1] role, session and service failures map to safe statuses', async () => {
    for (const [thrown, status, error] of [
      [new AccessError(403), 403, 'Access denied'],
      [new AccessError(401), 401, 'Authentication required'],
      [new AccessError(503), 503, 'Access service unavailable'],
      [new Error('PRIVATE_DATABASE_DETAIL'), 503, 'Access service unavailable']
    ] as const) {
      const res = await patch(buildApp(async () => { throw thrown; }));
      assert.equal(res.status, status);
      assert.deepEqual(res.body, { error });
    }
  });

  test('[FAILURE] [SG2-58:AC1] a request without a verified caller is refused before any write', async () => {
    let calls = 0;
    const res = await patch(buildApp(async () => { calls++; return { outcome: 'missing' }; }, null));
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'Authentication required' });
    assert.equal(calls, 0);
  });
});
