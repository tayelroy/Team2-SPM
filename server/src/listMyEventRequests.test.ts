import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createListMyEventRequestsHandler } from './events/listMine';
import type { ListOwnEventRequestsResult } from './db/eventRequests';
import type { Principal } from './auth/policy';

const ORGANISER: Principal = { userId: 'user-1', role: 'event_organiser' };

const SOME_REQUEST = {
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
  listResult?: ListOwnEventRequestsResult;
  captureOrganiserId?: (organiserId: string) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.get(
    '/api/event-requests',
    createListMyEventRequestsHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      listOwnRequests: async (_admin, organiserId) => {
        options.captureOrganiserId?.(organiserId);
        return options.listResult ?? { ok: true, requests: [SOME_REQUEST] };
      }
    })
  );
  return app;
}

describe('GET /api/event-requests (SG2-32)', () => {
  test('lists the requests scoped to the caller', async () => {
    let capturedId: string | undefined;
    const response = await request(buildApp({ captureOrganiserId: (id) => (capturedId = id) })).get(
      '/api/event-requests'
    );

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.requests, [SOME_REQUEST]);
    assert.equal(capturedId, 'user-1');
  });

  test('returns an empty list rather than an error when the caller has no requests', async () => {
    const response = await request(buildApp({ listResult: { ok: true, requests: [] } })).get(
      '/api/event-requests'
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.requests, []);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined })).get('/api/event-requests');
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).get('/api/event-requests');
    assert.equal(response.status, 503);
  });

  test('returns 503 without leaking the database error when the query fails', async () => {
    const response = await request(
      buildApp({ listResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).get('/api/event-requests');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('GET /api/event-requests authorisation wiring', () => {
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

  /** Uses the real PERMISSIONS policy; the list handler itself is stubbed. */
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
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_organiser')).get('/api/event-requests');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('denies a role without the read permission', async () => {
    const response = await request(appForRole('attendee'))
      .get('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('lets an Event Organiser reach the list handler', async () => {
    const response = await request(appForRole('event_organiser'))
      .get('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
