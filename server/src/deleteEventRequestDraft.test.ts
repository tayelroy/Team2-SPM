import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createDeleteEventDraftHandler } from './events/deleteDraft';
import type { DeleteDraftResult, FetchEventRequestResult } from './db/eventRequests';
import type { Principal } from './auth/policy';

const ORGANISER: Principal = { userId: 'user-1', role: 'event_organiser' };

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
  deleteResult?: DeleteDraftResult;
  captureFetch?: (eventId: number, organiserId: string) => void;
  captureDelete?: (eventId: number, organiserId: string) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.delete(
    '/api/event-requests/:eventId',
    createDeleteEventDraftHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchOwnRequest: async (_admin, eventId, organiserId) => {
        options.captureFetch?.(eventId, organiserId);
        return options.fetchResult ?? { ok: true, request: DRAFT_REQUEST };
      },
      deleteDraft: async (_admin, eventId, organiserId) => {
        options.captureDelete?.(eventId, organiserId);
        return options.deleteResult ?? { ok: true };
      }
    })
  );
  return app;
}

describe('DELETE /api/event-requests/:eventId (SG2-32)', () => {
  test('deletes a draft owned by the caller, passing the caller id to both the lookup and the delete', async () => {
    let fetched: { eventId: number; organiserId: string } | undefined;
    let deleted: { eventId: number; organiserId: string } | undefined;
    const response = await request(
      buildApp({
        captureFetch: (eventId, organiserId) => (fetched = { eventId, organiserId }),
        captureDelete: (eventId, organiserId) => (deleted = { eventId, organiserId })
      })
    ).delete('/api/event-requests/7');

    assert.equal(response.status, 200);
    assert.deepEqual(fetched, { eventId: 7, organiserId: 'user-1' });
    assert.deepEqual(deleted, { eventId: 7, organiserId: 'user-1' });
  });

  test('returns 400 for a non-numeric eventId, without querying the database', async () => {
    let called = false;
    const response = await request(buildApp({ captureFetch: () => (called = true) })).delete(
      '/api/event-requests/not-a-number'
    );
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined })).delete('/api/event-requests/7');
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).delete('/api/event-requests/7');
    assert.equal(response.status, 503);
  });

  test('returns 404 when the request does not exist or belongs to someone else', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    ).delete('/api/event-requests/7');
    assert.equal(response.status, 404);
  });

  test('returns 503 without leaking the database error when the lookup fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).delete('/api/event-requests/7');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('returns 409 when the request has already been submitted', async () => {
    let deleteCalled = false;
    const response = await request(
      buildApp({
        fetchResult: { ok: true, request: { ...DRAFT_REQUEST, status: 'submitted' } },
        captureDelete: () => (deleteCalled = true)
      })
    ).delete('/api/event-requests/7');
    assert.equal(response.status, 409);
    assert.equal(deleteCalled, false);
  });

  test('returns 503 without leaking the database error when the delete fails', async () => {
    const response = await request(
      buildApp({ deleteResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).delete('/api/event-requests/7');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('DELETE /api/event-requests/:eventId authorisation wiring', () => {
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

  /** Uses the real PERMISSIONS policy; the delete handler itself is stubbed. */
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
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_organiser')).delete('/api/event-requests/7');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('denies a role without the delete permission', async () => {
    const response = await request(appForRole('attendee'))
      .delete('/api/event-requests/7')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('lets an Event Organiser reach the delete handler', async () => {
    const response = await request(appForRole('event_organiser'))
      .delete('/api/event-requests/7')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
