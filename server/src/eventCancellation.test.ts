import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createEventCancellationHandlers } from './events/cancellation';
import { AccessError, type Principal } from './auth/policy';
import type { CancelEventResult, RequestCancellationResult } from './db/eventCancellation';

const ORGANISER: Principal = { userId: '20000000-0000-4000-8000-000000000001', role: 'event_organiser' };
const COORDINATOR: Principal = { userId: '20000000-0000-4000-8000-000000000002', role: 'event_coordinator' };

function buildApp(deps: {
  ask?: (token: string, eventId: number, reason: string) => Promise<RequestCancellationResult>;
  cancel?: (token: string, eventId: number) => Promise<CancelEventResult>;
  principal?: Principal | null;
}) {
  const app = express();
  app.use(express.json());
  const handlers = createEventCancellationHandlers({
    getPrincipal: () => (deps.principal === undefined ? ORGANISER : deps.principal ?? undefined),
    request: deps.ask ?? (async () => { throw new Error('request not expected'); }),
    cancel: deps.cancel ?? (async () => { throw new Error('cancel not expected'); })
  });
  app.post('/api/event-requests/:eventId/cancellation-request', handlers.request);
  app.patch('/api/event-requests/:eventId/cancel', handlers.cancel);
  return app;
}

const ask = (app: express.Express, body: unknown, id = '7') =>
  request(app).post(`/api/event-requests/${id}/cancellation-request`).set('Authorization', 'Bearer organiser-token').send(body as object);
const cancel = (app: express.Express, id = '7') =>
  request(app).patch(`/api/event-requests/${id}/cancel`).set('Authorization', 'Bearer coordinator-token');

const CANCELLED: CancelEventResult = {
  outcome: 'ok', event_id: 7, status: 'cancelled', cancelled_at: '2026-10-21T08:00:00.000Z', bookings_released: 2, attendees_notified: 3
};

describe('POST /api/event-requests/:eventId/cancellation-request (SG2-67)', () => {
  test('[NORMAL] [SG2-67:AC1] the organiser asks with a reason; the caller token, id and reason reach the database', async () => {
    const calls: unknown[] = [];
    const res = await ask(buildApp({ ask: async (token, eventId, reason) => {
      calls.push([token, eventId, reason]);
      return { outcome: 'ok', event_id: 7, cancellation_requested_at: '2026-10-21T07:00:00.000Z', coordinator_notified: true };
    } }), { reason: 'The keynote speaker withdrew' });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { event_id: 7, cancellation_requested_at: '2026-10-21T07:00:00.000Z', coordinator_notified: true });
    assert.deepEqual(calls, [['organiser-token', 7, 'The keynote speaker withdrew']]);
  });

  test('[BOUNDARY] [SG2-67:AC1] a missing or non-text reason never reaches the database, and the database refuses an empty or over-long one', async () => {
    let calls = 0;
    const app = buildApp({ ask: async () => { calls++; return { outcome: 'invalid' }; } });
    for (const body of [{}, { reason: 5 }, { reason: null }, []]) {
      const res = await ask(app, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(res.body, { error: 'Give a reason for the cancellation, up to 500 characters.' });
    }
    assert.equal(calls, 0);
    const res = await ask(app, { reason: 'x'.repeat(501) });
    assert.equal(res.status, 400);
    assert.equal(calls, 1);
  });

  test('[CONFLICT] [SG2-67:AC1] a second request, or one for a draft, completed or cancelled event, is refused with 409', async () => {
    let res = await ask(buildApp({ ask: async () => ({ outcome: 'requested', cancellation_requested_at: '2026-10-21T07:00:00.000Z' }) }),
      { reason: 'Again' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'A cancellation has already been requested for this event.', code: 'requested' });
    res = await ask(buildApp({ ask: async () => ({ outcome: 'closed', status: 'completed' }) }), { reason: 'Too late' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, {
      error: 'A completed or cancelled event cannot be cancelled, and a draft is deleted instead.', code: 'closed'
    });
  });

  test('[FAILURE] [SG2-67:AC1] an event the caller did not create is a 404 that reveals nothing', async () => {
    const res = await ask(buildApp({ ask: async () => ({ outcome: 'missing' }) }), { reason: 'Not mine' });
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Event not found.' });
  });
});

describe('PATCH /api/event-requests/:eventId/cancel (SG2-67)', () => {
  test('[NORMAL] [SG2-67:AC1] [SG2-67:AC2] [SG2-67:AC3] the assigned coordinator cancels; released venues and notified attendees are reported', async () => {
    const calls: unknown[] = [];
    const res = await cancel(buildApp({ principal: COORDINATOR, cancel: async (token, eventId) => {
      calls.push([token, eventId]);
      return CANCELLED;
    } }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      event_id: 7, status: 'cancelled', cancelled_at: '2026-10-21T08:00:00.000Z', bookings_released: 2, attendees_notified: 3
    });
    assert.deepEqual(calls, [['coordinator-token', 7]]);
  });

  test('[CONFLICT] [SG2-67:AC1] [SG2-67:AC5] no outstanding request, or an event already cancelled or completed, is refused with 409', async () => {
    let res = await cancel(buildApp({ principal: COORDINATOR, cancel: async () => ({ outcome: 'not_requested' }) }));
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: 'The organiser has not asked for this event to be cancelled.', code: 'not_requested' });
    res = await cancel(buildApp({ principal: COORDINATOR, cancel: async () => ({ outcome: 'closed', status: 'cancelled' }) }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'closed');
  });

  test('[FAILURE] [SG2-67:AC1] another coordinator\'s event, or an id the database rejects, is a 404 that reveals nothing', async () => {
    for (const outcome of ['missing', 'invalid'] as const) {
      const res = await cancel(buildApp({ principal: COORDINATOR, cancel: async () => ({ outcome }) }));
      assert.equal(res.status, 404, outcome);
      assert.deepEqual(res.body, { error: 'Event not found.' });
    }
  });
});

describe('shared guards (SG2-67)', () => {
  test('[BOUNDARY] [SG2-67:AC1] only canonical ids from 1 to 2147483647 reach the database', async () => {
    let calls = 0;
    const app = buildApp({ principal: COORDINATOR, ask: async () => { calls++; return { outcome: 'missing' }; },
      cancel: async () => { calls++; return { outcome: 'missing' }; } });
    for (const id of ['0', '-1', '1.5', 'abc', '01', '2147483648']) {
      assert.equal((await cancel(app, id)).status, 400, id);
      const res = await ask(app, { reason: 'Why' }, id);
      assert.equal(res.status, 400, id);
      assert.deepEqual(res.body, { error: 'eventId must be a positive integer.' });
    }
    assert.equal(calls, 0);
    assert.equal((await cancel(app, '2147483647')).status, 404);
    assert.equal((await ask(app, { reason: 'Why' }, '1')).status, 404);
    assert.equal(calls, 2);
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-67:AC1] role, session and service failures map to safe statuses on both routes', async () => {
    for (const [thrown, status, error] of [
      [new AccessError(403), 403, 'Access denied'],
      [new AccessError(401), 401, 'Authentication required'],
      [new Error('PRIVATE_DATABASE_DETAIL'), 503, 'Access service unavailable']
    ] as const) {
      const app = buildApp({ ask: async () => { throw thrown; }, cancel: async () => { throw thrown; } });
      for (const res of [await ask(app, { reason: 'Why' }), await cancel(app)]) {
        assert.equal(res.status, status);
        assert.deepEqual(res.body, { error });
      }
    }
  });

  test('[FAILURE] [SG2-67:AC1] a request with no verified caller is refused before anything else', async () => {
    const app = buildApp({ principal: null });
    for (const res of [await ask(app, { reason: 'Why' }), await cancel(app)]) {
      assert.equal(res.status, 401);
      assert.deepEqual(res.body, { error: 'Authentication required' });
    }
  });
});
