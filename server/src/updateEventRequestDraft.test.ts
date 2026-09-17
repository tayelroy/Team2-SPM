import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createUpdateEventDraftHandler } from './events/updateDraft';
import type { FetchEventRequestResult, UpdateDraftResult } from './db/eventRequests';
import type { Principal } from './auth/policy';

const ORGANISER: Principal = { userId: 'user-1', role: 'event_organiser' };

const COMPLETE_BODY = {
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Half-day forum with keynotes and a reception.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: 'Hearing loop',
  equipment_requirements: 'Lectern, 2 radio mics',
  registration_needed: true
};

const DRAFT_REQUEST = {
  event_id: 7,
  organiser_id: 'user-1',
  organisation: 'ConnectSphere Test',
  status: 'draft',
  name: 'Partner Forum',
  purpose: null,
  description: null,
  proposed_date: null,
  expected_attendance: null,
  venue_requirements: null,
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: null
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventRequestResult;
  updateResult?: UpdateDraftResult;
  captureFetch?: (eventId: number, organiserId: string) => void;
  captureUpdate?: (eventId: number, organiserId: string, values: unknown) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId',
    createUpdateEventDraftHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchOwnRequest: async (_admin, eventId, organiserId) => {
        options.captureFetch?.(eventId, organiserId);
        return options.fetchResult ?? { ok: true, request: DRAFT_REQUEST };
      },
      updateDraft: async (_admin, eventId, organiserId, values) => {
        options.captureUpdate?.(eventId, organiserId, values);
        return (
          options.updateResult ?? {
            ok: true,
            request: { ...DRAFT_REQUEST, ...values }
          }
        );
      }
    })
  );
  return app;
}

describe('PATCH /api/event-requests/:eventId (SG2-29)', () => {
  test('updates a draft owned by the caller, passing the caller id to both the lookup and the update', async () => {
    let fetched: { eventId: number; organiserId: string } | undefined;
    let updated: { eventId: number; organiserId: string; values: unknown } | undefined;
    const response = await request(
      buildApp({
        captureFetch: (eventId, organiserId) => (fetched = { eventId, organiserId }),
        captureUpdate: (eventId, organiserId, values) => (updated = { eventId, organiserId, values })
      })
    )
      .patch('/api/event-requests/7')
      .send(COMPLETE_BODY);

    assert.equal(response.status, 200);
    assert.equal(response.body.request.name, 'Partner Forum');
    assert.deepEqual(response.body.missingForSubmission, []);
    assert.deepEqual(fetched, { eventId: 7, organiserId: 'user-1' });
    assert.equal(updated?.eventId, 7);
    assert.equal(updated?.organiserId, 'user-1');
    assert.equal((updated?.values as { name: string }).name, 'Partner Forum');
  });

  test('an update omitting only accessibility needs is submission-ready', async () => {
    const { accessibility_needs, ...withoutAccessibility } = COMPLETE_BODY;
    const response = await request(buildApp()).patch('/api/event-requests/7').send(withoutAccessibility);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.missingForSubmission, []);
  });

  test('reports what is still outstanding for an incomplete update', async () => {
    const response = await request(buildApp()).patch('/api/event-requests/7').send({ name: 'Partner Forum' });
    assert.equal(response.status, 200);
    assert.ok(response.body.missingForSubmission.includes('purpose'));
  });

  test('ownership fields in the body are ignored, not trusted', async () => {
    let updated: { eventId: number; values: unknown } | undefined;
    const response = await request(
      buildApp({ captureUpdate: (eventId, _organiserId, values) => (updated = { eventId, values }) })
    )
      .patch('/api/event-requests/7')
      .send({ ...COMPLETE_BODY, organiser_id: 'someone-else', status: 'approved', event_id: 999 });

    assert.equal(response.status, 200);
    for (const forbidden of ['organiser_id', 'status', 'event_id']) {
      assert.equal(forbidden in (updated?.values as object), false, `${forbidden} must not be client-settable`);
    }
  });

  test('rejects malformed values with a message naming the field', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/7')
      .send({ name: 42, expected_attendance: -5 });
    assert.equal(response.status, 400);
    assert.ok(response.body.details.some((d: string) => d.includes('name')));
    assert.ok(response.body.details.some((d: string) => d.includes('expected_attendance')));
  });

  test('treats an absent request body as an empty update', async () => {
    // No express.json() here, so req.body is undefined rather than {}.
    const bare = express();
    bare.patch(
      '/api/event-requests/:eventId',
      createUpdateEventDraftHandler({
        getPrincipal: () => ORGANISER,
        getAdminClient: () => ({}) as SupabaseClient,
        fetchOwnRequest: async () => ({ ok: true, request: DRAFT_REQUEST }),
        updateDraft: async (_admin, _eventId, _organiserId, values) => ({ ok: true, request: { ...DRAFT_REQUEST, ...values } })
      })
    );
    const response = await request(bare).patch('/api/event-requests/7');
    assert.equal(response.status, 200);
  });

  test('returns 400 for a non-numeric eventId, without querying the database', async () => {
    let called = false;
    const response = await request(buildApp({ captureFetch: () => (called = true) }))
      .patch('/api/event-requests/not-a-number')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined }))
      .patch('/api/event-requests/7')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).patch('/api/event-requests/7').send(COMPLETE_BODY);
    assert.equal(response.status, 503);
  });

  test('returns 404 when the request does not exist or belongs to someone else', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    )
      .patch('/api/event-requests/7')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 404);
  });

  test('returns 503 without leaking the database error when the lookup fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('returns 409 when the request has already been submitted', async () => {
    let updateCalled = false;
    const response = await request(
      buildApp({
        fetchResult: { ok: true, request: { ...DRAFT_REQUEST, status: 'submitted' } },
        captureUpdate: () => (updateCalled = true)
      })
    )
      .patch('/api/event-requests/7')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 409);
    assert.equal(updateCalled, false);
  });

  test('returns 503 without leaking the database error when the update fails', async () => {
    const response = await request(
      buildApp({ updateResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .patch('/api/event-requests/7')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('PATCH /api/event-requests/:eventId authorisation wiring', () => {
  const userId = '10000000-0000-4000-8000-000000000001';
  const originalConfig = { ...dbConfig };

  beforeEach(() => {
    dbConfig.supabaseUrl = 'https://auth-test.supabase.co';
    dbConfig.supabaseAnonKey = 'sb_publishable_test';
    dbConfig.supabaseServiceRoleKey = 'test-service-role';
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('Unexpected network request');
    });
  });

  afterEach(() => {
    mock.restoreAll();
    Object.assign(dbConfig, originalConfig);
  });

  /** Uses the real PERMISSIONS policy; the update handler itself is stubbed. */
  const appForRole = (role: Role) =>
    createApp(
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_organiser')).patch('/api/event-requests/7').send({});
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('denies a role without the update permission', async () => {
    const response = await request(appForRole('attendee'))
      .patch('/api/event-requests/7')
      .set('Authorization', 'Bearer token')
      .send({});
    assert.equal(response.status, 403);
  });

  test('lets an Event Organiser reach the update handler', async () => {
    const response = await request(appForRole('event_organiser'))
      .patch('/api/event-requests/7')
      .set('Authorization', 'Bearer token')
      .send({});
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
