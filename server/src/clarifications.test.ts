import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization } from './auth';
import type { Role } from './auth/policy';
import { dbConfig } from './db/config';
import { createAddClarificationHandler, createListClarificationsHandler } from './events/clarifications';
import type { FetchEventRequestResult } from './db/eventRequests';
import type { FetchClarificationsResult, InsertClarificationResult } from './db/clarifications';
import type { Principal } from './auth/policy';

const COORDINATOR: Principal = { userId: 'coordinator-1', role: 'event_coordinator' };
const ORGANISER: Principal = { userId: 'organiser-1', role: 'event_organiser' };

const REQUEST_UNDER_REVIEW = {
  event_id: 7,
  organiser_id: 'organiser-1',
  organisation: 'ConnectSphere Test',
  status: 'under_review',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Half-day forum with keynotes and a reception.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  accessibility_needs: null,
  equipment_requirements: null,
  registration_needed: true,
  coordinator_id: 'coordinator-1',
  coordinator_name: 'Casey Coordinator'
};

const MESSAGE = {
  clarification_id: 5,
  event_id: 7,
  sender_id: 'coordinator-1',
  sender_name: 'Casey Coordinator',
  message: 'Which room layout do you need?',
  created_at: '2026-09-30T02:00:00.000Z'
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventRequestResult;
  threadResult?: FetchClarificationsResult;
  addResult?: InsertClarificationResult;
  returnResult?: Awaited<ReturnType<typeof import('./db/eventRequests').requestClarification>>;
  auditOk?: boolean;
  captureAdd?: (eventId: number, senderId: string, message: string) => void;
  captureReturn?: (eventId: number, coordinatorId: string) => void;
  captureAudit?: (entries: unknown[]) => void;
}

function deps(options: HarnessOptions) {
  return {
    getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
    getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
    fetchRequest: async () => options.fetchResult ?? { ok: true as const, request: REQUEST_UNDER_REVIEW },
    fetchThread: async () => options.threadResult ?? { ok: true as const, clarifications: [MESSAGE] },
    addMessage: async (_a: SupabaseClient, eventId: number, senderId: string, message: string) => {
      options.captureAdd?.(eventId, senderId, message);
      return options.addResult ?? { ok: true as const, clarification: MESSAGE };
    },
    returnForClarification: async (_a: SupabaseClient, eventId: number, coordinatorId: string) => {
      options.captureReturn?.(eventId, coordinatorId);
      return (
        options.returnResult ?? {
          ok: true as const,
          request: { ...REQUEST_UNDER_REVIEW, status: 'needs_clarification' }
        }
      );
    },
    writeAuditLogs: async (_a: SupabaseClient, entries: unknown[]) => {
      options.captureAudit?.(entries);
      return options.auditOk === false
        ? { ok: false as const, reason: 'unavailable' as const, message: 'audit down' }
        : { ok: true as const, logs: [] };
    }
  };
}

function postApp(options: HarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.post('/api/event-requests/:eventId/clarifications', createAddClarificationHandler(deps(options) as never));
  return app;
}

function getApp(options: HarnessOptions = {}) {
  const app = express();
  app.get('/api/event-requests/:eventId/clarifications', createListClarificationsHandler(deps(options) as never));
  return app;
}

describe('POST /api/event-requests/:eventId/clarifications (SG2-36)', () => {
  test('the assigned coordinator returns the request with a question', async () => {
    let returned: { eventId: number; coordinatorId: string } | undefined;
    let added: { eventId: number; senderId: string; message: string } | undefined;
    let audited: unknown[] | undefined;
    const response = await request(
      postApp({
        captureReturn: (eventId, coordinatorId) => (returned = { eventId, coordinatorId }),
        captureAdd: (eventId, senderId, message) => (added = { eventId, senderId, message }),
        captureAudit: (entries) => (audited = entries)
      })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: '  Which room layout do you need?  ' });

    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'needs_clarification');
    assert.deepEqual(returned, { eventId: 7, coordinatorId: 'coordinator-1' });
    // The message is trimmed before it is stored.
    assert.deepEqual(added, { eventId: 7, senderId: 'coordinator-1', message: 'Which room layout do you need?' });
    // The status change is recorded in the shared audit history (SG2-39).
    assert.deepEqual(audited, [
      {
        event_id: 7,
        actor_id: 'coordinator-1',
        field_name: 'status',
        old_value: 'under_review',
        new_value: 'needs_clarification'
      }
    ]);
  });

  test('the organiser answers without changing the status', async () => {
    let returned = false;
    let audited = false;
    const response = await request(
      postApp({
        principal: ORGANISER,
        fetchResult: { ok: true, request: { ...REQUEST_UNDER_REVIEW, status: 'needs_clarification' } },
        captureReturn: () => (returned = true),
        captureAudit: () => (audited = true)
      })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'Theatre layout, 120 seats.' });

    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'needs_clarification');
    assert.equal(returned, false);
    assert.equal(audited, false);
  });

  test('a coordinator follow-up after returning it only appends', async () => {
    let returned = false;
    const response = await request(
      postApp({
        fetchResult: { ok: true, request: { ...REQUEST_UNDER_REVIEW, status: 'needs_clarification' } },
        captureReturn: () => (returned = true)
      })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'Also, how many breakout rooms?' });

    assert.equal(response.status, 201);
    assert.equal(returned, false);
  });

  for (const [label, principal, fetchResult] of [
    [
      'a coordinator the request is not assigned to',
      { userId: 'coordinator-2', role: 'event_coordinator' } as Principal,
      undefined
    ],
    [
      'an organiser who does not own the request',
      { userId: 'organiser-2', role: 'event_organiser' } as Principal,
      undefined
    ],
    [
      'a role with no part in the exchange',
      { userId: 'staff-1', role: 'venue_staff' } as Principal,
      undefined
    ]
  ] as const) {
    test(`returns 404 for ${label}`, async () => {
      let added = false;
      const response = await request(
        postApp({ principal, fetchResult, captureAdd: () => (added = true) })
      )
        .post('/api/event-requests/7/clarifications')
        .send({ message: 'hello' });
      assert.equal(response.status, 404);
      assert.equal(added, false);
    });
  }

  for (const [label, body] of [
    ['an empty message', { message: '' }],
    ['a whitespace-only message', { message: '   ' }],
    ['no message at all', {}]
  ] as const) {
    test(`returns 400 for ${label}`, async () => {
      const response = await request(postApp()).post('/api/event-requests/7/clarifications').send(body);
      assert.equal(response.status, 400);
      assert.match(response.body.error, /message is required/i);
    });
  }

  test('returns 400 when the message is not text', async () => {
    const response = await request(postApp())
      .post('/api/event-requests/7/clarifications')
      .send({ message: 42 });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /must be text/);
  });

  test('returns 400 when the message is longer than the field allows', async () => {
    const response = await request(postApp())
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'x'.repeat(5001) });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /5000 characters or fewer/);
  });

  test('treats an absent body as a missing message', async () => {
    // No express.json() here, so req.body is undefined rather than {}.
    const bare = express();
    bare.post('/api/event-requests/:eventId/clarifications', createAddClarificationHandler(deps({}) as never));
    const response = await request(bare).post('/api/event-requests/7/clarifications');
    assert.equal(response.status, 400);
  });

  test('returns 400 for a non-numeric eventId', async () => {
    const response = await request(postApp())
      .post('/api/event-requests/not-a-number/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 400);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(postApp({ principal: undefined }))
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 401);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(postApp({ admin: null }))
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 503);
  });

  test('returns 404 when the request does not exist', async () => {
    const response = await request(
      postApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 404);
  });

  test('returns 503 without leaking the error when the lookup fails', async () => {
    const response = await request(
      postApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('returns 404 when the request was decided between the read and the write', async () => {
    const response = await request(
      postApp({ returnResult: { ok: false, reason: 'not_found', message: 'gone' } })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 404);
  });

  test('returns 503 when the status change itself fails', async () => {
    const response = await request(
      postApp({ returnResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('returns 503 when the history cannot be recorded', async () => {
    // A decision nobody can trace is worse than a refused one.
    const response = await request(postApp({ auditOk: false }))
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 503);
  });

  test('returns 503 when the message cannot be stored', async () => {
    const response = await request(
      postApp({ addResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    )
      .post('/api/event-requests/7/clarifications')
      .send({ message: 'hello' });
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('GET /api/event-requests/:eventId/clarifications (SG2-36)', () => {
  test('both participants read the same thread', async () => {
    for (const principal of [COORDINATOR, ORGANISER]) {
      const response = await request(getApp({ principal })).get('/api/event-requests/7/clarifications');
      assert.equal(response.status, 200);
      assert.equal(response.body.clarifications.length, 1);
      assert.equal(response.body.status, 'under_review');
    }
  });

  test('returns 404 for someone outside the exchange', async () => {
    const response = await request(
      getApp({ principal: { userId: 'coordinator-2', role: 'event_coordinator' } })
    ).get('/api/event-requests/7/clarifications');
    assert.equal(response.status, 404);
  });

  test('returns 401 when no verified principal is present', async () => {
    const response = await request(getApp({ principal: undefined })).get('/api/event-requests/7/clarifications');
    assert.equal(response.status, 401);
  });

  test('returns 400 for a non-numeric eventId', async () => {
    const response = await request(getApp()).get('/api/event-requests/not-a-number/clarifications');
    assert.equal(response.status, 400);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const response = await request(getApp({ admin: null })).get('/api/event-requests/7/clarifications');
    assert.equal(response.status, 503);
  });

  test('returns 503 without leaking the error when the lookup fails', async () => {
    const response = await request(
      getApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).get('/api/event-requests/7/clarifications');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('returns 404 when the request does not exist', async () => {
    const response = await request(
      getApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    ).get('/api/event-requests/7/clarifications');
    assert.equal(response.status, 404);
  });

  test('returns 503 when the thread cannot be read', async () => {
    const response = await request(
      getApp({ threadResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).get('/api/event-requests/7/clarifications');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });
});

describe('clarification authorisation wiring', () => {
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

  /** Uses the real PERMISSIONS policy; the handlers themselves are stubbed.
   * They are createApp's 21st and 22nd parameters. */
  const appForRole = (role: Role) => {
    const reached: express.RequestHandler = (_req, res) => {
      res.status(200).json({ reached: true });
    };
    return createApp(
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined,
      reached,
      reached
    );
  };

  test('rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_coordinator')).get('/api/event-requests/7/clarifications');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  for (const role of ['event_coordinator', 'event_organiser'] as const) {
    test(`lets ${role} reach the clarification handlers`, async () => {
      for (const call of [
        request(appForRole(role)).get('/api/event-requests/7/clarifications'),
        request(appForRole(role)).post('/api/event-requests/7/clarifications')
      ]) {
        const response = await call.set('Authorization', 'Bearer token');
        assert.equal(response.status, 200);
        assert.equal(response.body.reached, true);
      }
    });
  }

  for (const role of ['venue_staff', 'technical_support_staff', 'attendee'] as const) {
    test(`denies ${role}, who takes no part in the exchange`, async () => {
      const response = await request(appForRole(role))
        .get('/api/event-requests/7/clarifications')
        .set('Authorization', 'Bearer token');
      assert.equal(response.status, 403);
    });
  }
});
