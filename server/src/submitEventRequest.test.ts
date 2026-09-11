import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { submitEventRequestHandler } from './events/submit';
import type { FetchEventRequestResult, SubmitEventRequestResult } from './db/eventRequests';
import type { Principal } from './auth/policy';

const ORGANISER: Principal = { userId: 'user-1', role: 'event_organiser' };

const COMPLETE_DRAFT = {
  event_id: 7,
  organiser_id: 'user-1',
  organisation: 'ConnectSphere Test',
  status: 'draft',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: null,
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: true
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventRequestResult;
  submitResult?: SubmitEventRequestResult;
  captureFetch?: (eventId: number, organiserId: string) => void;
  captureSubmit?: (eventId: number) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId/submit',
    submitEventRequestHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchOwnRequest: async (_admin, eventId, organiserId) => {
        options.captureFetch?.(eventId, organiserId);
        return options.fetchResult ?? { ok: true, request: COMPLETE_DRAFT };
      },
      submitRequest: async (_admin, eventId) => {
        options.captureSubmit?.(eventId);
        return options.submitResult ?? { ok: true, request: { ...COMPLETE_DRAFT, status: 'submitted' } };
      }
    })
  );
  return app;
}

describe('PATCH /api/event-requests/:eventId/submit (SG2-30)', () => {
  test('submits a complete draft owned by the caller', async () => {
    let fetched: { eventId: number; organiserId: string } | undefined;
    let submitted: number | undefined;
    const response = await request(
      buildApp({
        captureFetch: (eventId, organiserId) => (fetched = { eventId, organiserId }),
        captureSubmit: (eventId) => (submitted = eventId)
      })
    ).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'submitted');
    assert.deepEqual(fetched, { eventId: 7, organiserId: 'user-1' });
    assert.equal(submitted, 7);
  });

  test('returns 400 for a non-numeric eventId', async () => {
    const response = await request(buildApp()).patch('/api/event-requests/not-a-number/submit');
    assert.equal(response.status, 400);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined })).patch(
      '/api/event-requests/7/submit'
    );
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 503);
  });

  test('returns 404 when the request does not exist or belongs to someone else', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 404);
  });

  test('returns 503 without leaking the database error when the lookup fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('returns 409 when the request is not a draft', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'submitted' } } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 409);
  });

  test('returns 400 and lists outstanding fields for an incomplete draft', async () => {
    const response = await request(
      buildApp({
        fetchResult: {
          ok: true,
          request: { ...COMPLETE_DRAFT, name: null, purpose: '' }
        }
      })
    ).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.missing, ['name', 'purpose']);
  });

  test('a draft omitting only accessibility needs is submission-ready', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, accessibility_needs: null } } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 200);
  });

  test('returns 503 without leaking the database error when the update fails', async () => {
    const response = await request(
      buildApp({ submitResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('PATCH /api/event-requests/:eventId/submit authorisation wiring', () => {
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

  /**
   * Uses the real PERMISSIONS policy, so this exercises the actual grant. The
   * draft-creation handler is left as the default (unused by these routes);
   * the submit handler is stubbed so reaching it is unambiguous.
   */
  const appForRole = (role: Role) =>
    createApp(
      undefined,
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      undefined,
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_organiser')).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('denies a role without the submit permission', async () => {
    const response = await request(appForRole('attendee'))
      .patch('/api/event-requests/7/submit')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('lets an Event Organiser reach the submit handler', async () => {
    const response = await request(appForRole('event_organiser'))
      .patch('/api/event-requests/7/submit')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
