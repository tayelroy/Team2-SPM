import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createEventDraftHandler } from './events/createDraft';
import {
  SUBMISSION_REQUIRED_FIELDS,
  missingForSubmission,
  validateDraftInput,
  type DraftValues
} from './events/fields';
import type { CreateDraftResult, OrganiserLookupResult } from './db/eventRequests';
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

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  lookup?: OrganiserLookupResult;
  insert?: CreateDraftResult;
  captureInsert?: (draft: {
    organiserId: string;
    organisation: string | null;
    values: DraftValues;
  }) => void;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.post(
    '/api/event-requests',
    createEventDraftHandler({
      getPrincipal: () => ('principal' in options ? options.principal : ORGANISER),
      getAdminClient: () =>
        options.admin === undefined ? ({} as SupabaseClient) : options.admin,
      lookupOrganisation: async () =>
        options.lookup ?? { ok: true, organisation: 'ConnectSphere Test' },
      insertDraft: async (_admin, draft) => {
        options.captureInsert?.(draft);
        return (
          options.insert ?? {
            ok: true,
            request: {
              event_id: 1,
              organiser_id: draft.organiserId,
              organisation: draft.organisation,
              status: 'draft',
              ...draft.values
            }
          }
        );
      }
    })
  );
  return app;
}

describe('POST /api/event-requests (SG2-28)', () => {
  test('creates a draft owned by the caller and their organisation', async () => {
    let captured: { organiserId: string; organisation: string | null } | undefined;
    const response = await request(buildApp({ captureInsert: (d) => (captured = d) }))
      .post('/api/event-requests')
      .send(COMPLETE_BODY);

    assert.equal(response.status, 201);
    assert.equal(response.body.request.status, 'draft');
    assert.equal(response.body.request.organiser_id, 'user-1');
    assert.equal(response.body.request.organisation, 'ConnectSphere Test');
    assert.equal(response.body.request.name, 'Partner Forum');
    assert.equal(captured?.organiserId, 'user-1');
    assert.equal(captured?.organisation, 'ConnectSphere Test');
  });

  test('a complete draft reports nothing outstanding for submission', async () => {
    const response = await request(buildApp()).post('/api/event-requests').send(COMPLETE_BODY);
    assert.deepEqual(response.body.missingForSubmission, []);
  });

  test('an empty draft is accepted and names what is still needed to submit', async () => {
    const response = await request(buildApp()).post('/api/event-requests').send({});

    // SG2-28: incompleteness must not block creating a draft.
    assert.equal(response.status, 201);
    assert.equal(response.body.request.status, 'draft');
    assert.deepEqual(response.body.missingForSubmission, [...SUBMISSION_REQUIRED_FIELDS]);
  });

  test('a draft omitting only accessibility needs is submission-ready', async () => {
    const { accessibility_needs, ...withoutAccessibility } = COMPLETE_BODY;
    const response = await request(buildApp())
      .post('/api/event-requests')
      .send(withoutAccessibility);

    assert.equal(response.status, 201);
    assert.deepEqual(response.body.missingForSubmission, []);
  });

  test('ownership fields in the body are ignored, not trusted', async () => {
    let captured: { organiserId: string; organisation: string | null; values: DraftValues } | undefined;
    const response = await request(buildApp({ captureInsert: (d) => (captured = d) }))
      .post('/api/event-requests')
      .send({
        ...COMPLETE_BODY,
        organiser_id: 'someone-else',
        organisation: 'Rival Org',
        status: 'approved',
        event_id: 999,
        coordinator_id: 'coordinator-x'
      });

    assert.equal(response.status, 201);
    assert.equal(captured?.organiserId, 'user-1');
    assert.equal(captured?.organisation, 'ConnectSphere Test');
    for (const forbidden of ['organiser_id', 'organisation', 'status', 'event_id', 'coordinator_id']) {
      assert.equal(forbidden in (captured?.values ?? {}), false, `${forbidden} must not be client-settable`);
    }
    assert.equal(response.body.request.status, 'draft');
  });

  test('rejects malformed values with a message naming the field', async () => {
    const response = await request(buildApp())
      .post('/api/event-requests')
      .send({ name: 42, expected_attendance: -5, proposed_date: 'not-a-date', registration_needed: 'yes' });

    assert.equal(response.status, 400);
    assert.equal(response.body.details.length, 4);
    assert.ok(response.body.details.some((d: string) => d.includes('name')));
    assert.ok(response.body.details.some((d: string) => d.includes('expected_attendance')));
    assert.ok(response.body.details.some((d: string) => d.includes('proposed_date')));
    assert.ok(response.body.details.some((d: string) => d.includes('registration_needed')));
  });

  test('treats an absent request body as an empty draft', async () => {
    // No express.json() here, so req.body is undefined rather than {}.
    const bare = express();
    bare.post(
      '/api/event-requests',
      createEventDraftHandler({
        getPrincipal: () => ORGANISER,
        getAdminClient: () => ({}) as SupabaseClient,
        lookupOrganisation: async () => ({ ok: true, organisation: 'ConnectSphere Test' }),
        insertDraft: async (_admin, draft) => ({
          ok: true,
          request: {
            event_id: 2,
            organiser_id: draft.organiserId,
            organisation: draft.organisation,
            status: 'draft',
            ...draft.values
          }
        })
      })
    );

    const response = await request(bare).post('/api/event-requests');
    assert.equal(response.status, 201);
    assert.deepEqual(response.body.missingForSubmission, [...SUBMISSION_REQUIRED_FIELDS]);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined }))
      .post('/api/event-requests')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null }))
      .post('/api/event-requests')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 503);
  });

  test('returns 409 when the account has no user record to own the draft', async () => {
    const response = await request(
      buildApp({ lookup: { ok: false, reason: 'not_found', message: 'missing' } })
    )
      .post('/api/event-requests')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 409);
  });

  test('returns 503 when the organisation lookup fails', async () => {
    const response = await request(
      buildApp({ lookup: { ok: false, reason: 'unavailable', message: 'boom' } })
    )
      .post('/api/event-requests')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 503);
  });

  test('returns 503 without leaking the database error when the insert fails', async () => {
    const response = await request(
      buildApp({ insert: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .post('/api/event-requests')
      .send(COMPLETE_BODY);
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('POST /api/event-requests authorisation wiring', () => {
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
   * draft handler is stubbed so reaching it is unambiguous and the test does
   * not wait on a Supabase client that cannot connect.
   */
  const appForRole = (role: Role) =>
    createApp(
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      (_req, res) => { res.status(201).json({ reached: true }); }
    );

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_organiser')).post('/api/event-requests').send({});
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('denies a role without the create permission', async () => {
    const response = await request(appForRole('attendee'))
      .post('/api/event-requests')
      .set('Authorization', 'Bearer token')
      .send({});
    assert.equal(response.status, 403);
  });

  test('lets an Event Organiser reach the draft handler', async () => {
    const response = await request(appForRole('event_organiser'))
      .post('/api/event-requests')
      .set('Authorization', 'Bearer token')
      .send({});
    assert.equal(response.status, 201);
    assert.equal(response.body.reached, true);
  });
});

describe('validateDraftInput', () => {
  test('trims text and normalises blanks to null', () => {
    const result = validateDraftInput({ name: '  Forum  ', purpose: '   ' });
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.values.name, 'Forum');
      assert.equal(result.values.purpose, null);
    }
  });

  test('normalises a valid date to ISO 8601', () => {
    const result = validateDraftInput({ proposed_date: '2026-11-04T09:00:00Z' });
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.values.proposed_date, '2026-11-04T09:00:00.000Z');
  });

  test('accepts explicit nulls as "not provided"', () => {
    const result = validateDraftInput({
      name: null,
      expected_attendance: null,
      proposed_date: null,
      registration_needed: null
    });
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.values.name, null);
      assert.equal(result.values.expected_attendance, null);
      assert.equal(result.values.registration_needed, null);
    }
  });

  test('accepts registration_needed set to false', () => {
    const result = validateDraftInput({ registration_needed: false });
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.values.registration_needed, false);
  });

  test('rejects a non-integer attendance', () => {
    const result = validateDraftInput({ expected_attendance: 12.5 });
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.errors[0], /whole number/);
  });

  test('rejects an empty proposed_date string', () => {
    const result = validateDraftInput({ proposed_date: '   ' });
    assert.equal(result.valid, false);
  });

  test('rejects free text beyond the length limit', () => {
    const result = validateDraftInput({ description: 'x'.repeat(5001) });
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.errors[0], /5000 characters/);
  });

  test('accepts free text at exactly the length limit', () => {
    const result = validateDraftInput({ description: 'x'.repeat(5000) });
    assert.equal(result.valid, true);
  });

  for (const body of [null, 'a string', ['an', 'array'], 42]) {
    test(`rejects a non-object body: ${JSON.stringify(body)}`, () => {
      const result = validateDraftInput(body);
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.errors[0], /JSON object/);
    });
  }
});

describe('missingForSubmission', () => {
  test('treats null, undefined and empty string as missing', () => {
    const missing = missingForSubmission({
      name: null,
      purpose: '',
      proposed_date: '2026-11-04T09:00:00.000Z',
      expected_attendance: 10,
      venue_requirements: 'Stage'
    });
    assert.deepEqual(missing, ['name', 'purpose']);
  });

  test('does not require accessibility needs', () => {
    assert.equal(SUBMISSION_REQUIRED_FIELDS.includes('accessibility_needs'), false);
  });
});
