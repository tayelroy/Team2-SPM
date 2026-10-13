import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createGetEventConfirmationHandler } from './events/getConfirmation';
import type { Principal } from './auth/policy';
import type {
  EventConfirmationRecord,
  FetchConfirmedArrangementsResult,
  FetchEventConfirmationRecordResult
} from './db/eventConfirmation';

const ORGANISER: Principal = { userId: '10000000-0000-4000-8000-000000000001', role: 'event_organiser' };
const COORDINATOR: Principal = { userId: '20000000-0000-4000-8000-000000000002', role: 'event_coordinator' };

const EVENT: EventConfirmationRecord = {
  event_id: 7, status: 'confirmed', organiser_id: ORGANISER.userId, coordinator_id: COORDINATOR.userId,
  confirmed_at: '2026-10-11T08:00:00.000Z', registration_needed: true, registration_capacity: 120,
  registration_opens_at: '2030-06-01T00:00:00.000Z', registration_closes_at: '2030-06-19T16:00:00.000Z'
};
const ARRANGEMENTS: FetchConfirmedArrangementsResult = {
  ok: true,
  arrangements: {
    venues: [{ venue_name: 'Regression Hall', starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' }],
    equipment: [{ equipment_type: 'Wireless microphones', quantity_reserved: 12 }]
  }
};

interface Options {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  record?: FetchEventConfirmationRecordResult;
  arrangements?: FetchConfirmedArrangementsResult;
  now?: string;
}

function buildApp(options: Options = {}, calls: string[] = []) {
  const app = express();
  app.get('/api/event-requests/:eventId/confirmation', createGetEventConfirmationHandler({
    getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
    getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
    fetchRecord: async (_client, eventId) => { calls.push(`record ${eventId}`); return options.record ?? { ok: true, event: EVENT }; },
    fetchArrangements: async (_client, eventId) => { calls.push(`arrangements ${eventId}`); return options.arrangements ?? ARRANGEMENTS; },
    now: () => new Date(options.now ?? '2030-06-10T00:00:00.000Z')
  }));
  return app;
}

const get = (app: express.Express, id = '7') => request(app).get(`/api/event-requests/${id}/confirmation`);

describe('GET /api/event-requests/:eventId/confirmation (SG2-58)', () => {
  test('[NORMAL] [SG2-58:AC1] [SG2-58:AC3] the creating organiser sees venues, equipment and an open registration window', async () => {
    const calls: string[] = [];
    const res = await get(buildApp({}, calls));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      event_id: 7,
      status: 'confirmed',
      confirmed_at: '2026-10-11T08:00:00.000Z',
      venues: [{ venue_name: 'Regression Hall', starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' }],
      equipment: [{ equipment_type: 'Wireless microphones', quantity_reserved: 12 }],
      registration: {
        needed: true, capacity: 120, opens_at: '2030-06-01T00:00:00.000Z', closes_at: '2030-06-19T16:00:00.000Z', window: 'open'
      }
    });
    assert.deepEqual(calls, ['record 7', 'arrangements 7']);
  });

  test('[NORMAL] [SG2-58:AC1] the assigned coordinator sees a completed event, whose registration is closed', async () => {
    const res = await get(buildApp({ principal: COORDINATOR, record: { ok: true, event: { ...EVENT, status: 'completed' } } }));
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'completed');
    assert.equal(res.body.registration.window, 'closed');
  });

  test('[BOUNDARY] [SG2-58:AC3] before opens_at the window is not yet open; registration not needed hides its fields', async () => {
    const early = await get(buildApp({ now: '2030-05-31T23:59:59.999Z' }));
    assert.equal(early.body.registration.window, 'not_yet_open');
    const none = await get(buildApp({ record: { ok: true, event: { ...EVENT, registration_needed: false } } }));
    assert.deepEqual(none.body.registration, { needed: false, capacity: null, opens_at: null, closes_at: null, window: 'not_required' });
  });

  test('[BOUNDARY] [SG2-58:AC3] without an injected clock the window is judged against the real current time', async () => {
    const app = express();
    app.get('/api/event-requests/:eventId/confirmation', createGetEventConfirmationHandler({
      getPrincipal: () => ORGANISER,
      getAdminClient: () => ({} as SupabaseClient),
      fetchRecord: async () => ({ ok: true, event: {
        ...EVENT, registration_opens_at: '2000-01-01T00:00:00.000Z', registration_closes_at: '2001-01-01T00:00:00.000Z'
      } }),
      fetchArrangements: async () => ARRANGEMENTS
    }));
    const res = await get(app);
    assert.equal(res.status, 200);
    assert.equal(res.body.registration.window, 'closed');
  });

  test('[FAILURE] [SG2-58:AC1] other organisers, other coordinators and other roles get the same 404', async () => {
    for (const principal of [
      { userId: 'someone-else', role: 'event_organiser' },
      { userId: 'someone-else', role: 'event_coordinator' },
      { userId: ORGANISER.userId, role: 'event_coordinator' },
      { userId: COORDINATOR.userId, role: 'technical_support_staff' }
    ] as Principal[]) {
      const calls: string[] = [];
      const res = await get(buildApp({ principal }, calls));
      assert.equal(res.status, 404, `${principal.role} ${principal.userId}`);
      assert.deepEqual(res.body, { error: 'No confirmed event was found for this account.' });
      assert.deepEqual(calls, ['record 7']);
    }
  });

  test('[CONFLICT] [SG2-58:AC1] an event not yet confirmed is 404 even for its own organiser', async () => {
    for (const status of ['preparation', 'planning', 'cancelled']) {
      const res = await get(buildApp({ record: { ok: true, event: { ...EVENT, status } } }));
      assert.equal(res.status, 404, status);
    }
    const missing = await get(buildApp({ record: { ok: false, reason: 'not_found' } }));
    assert.equal(missing.status, 404);
  });

  test('[FAILURE] [SG2-58:AC1] invalid ids, no caller and storage failures are refused safely', async () => {
    for (const id of ['0', 'abc', '2147483648']) {
      const res = await get(buildApp(), id);
      assert.equal(res.status, 400, id);
      assert.deepEqual(res.body, { error: 'eventId must be a positive integer.' });
    }
    assert.equal((await get(buildApp({ principal: undefined }))).status, 401);
    const unavailable = { error: 'Confirmed arrangements are temporarily unavailable. Please try again later.' };
    for (const options of [
      { admin: null },
      { record: { ok: false, reason: 'unavailable' } },
      { arrangements: { ok: false, reason: 'unavailable' } }
    ] as Options[]) {
      const res = await get(buildApp(options));
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, unavailable);
    }
  });
});
