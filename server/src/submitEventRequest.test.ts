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
import type { InsertAuditLogInput, InsertAuditLogsResult } from './db/auditLogs';
import type { EventNotice, FetchLeadIdsResult, NotifyEventResult } from './db/eventNotifications';
import type { Principal } from './auth/policy';

const ORGANISER: Principal = { userId: 'user-1', role: 'event_organiser' };

const COMPLETE_DRAFT = {
  event_id: 7,
  organiser_id: 'user-1',
  organisation: 'ConnectSphere Test',
  status: 'draft',
  name: 'Partner Forum',
  purpose: 'Client relationship building',
  description: 'Quarterly partner networking session.',
  proposed_date: '2026-11-04T09:00:00.000Z',
  expected_attendance: 120,
  venue_requirements: 'Stage, PA, step-free access',
  preferred_layout: 'Theatre',
  accessibility_needs: 'Hearing loop',
  equipment_requirements: 'None',
  registration_needed: true
};

interface HarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventRequestResult;
  submitResult?: SubmitEventRequestResult;
  captureFetch?: (eventId: number, organiserId: string) => void;
  captureSubmit?: (eventId: number) => void;
  historyResult?: InsertAuditLogsResult;
  leadsResult?: FetchLeadIdsResult;
  notifyResult?: NotifyEventResult;
}

function buildApp(options: HarnessOptions = {}) {
  const app = express();
  const history: InsertAuditLogInput[][] = [];
  const notices: EventNotice[][] = [];
  const leadReads: number[] = [];
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
      },
      writeHistory: async (_admin, entries) => {
        history.push(entries);
        return options.historyResult ?? { ok: true, logs: [] };
      },
      fetchLeads: async () => {
        leadReads.push(history.length);
        return options.leadsResult ?? { ok: true, ids: ['lead-1', 'lead-2'] };
      },
      notify: async (_admin, batch) => {
        notices.push(batch);
        return options.notifyResult ?? { ok: true };
      }
    })
  );
  return Object.assign(app, { history, notices, leadReads });
}

describe('PATCH /api/event-requests/:eventId/submit (SG2-30)', () => {
  test('[BOUNDARY] [SG2-30:AC1] event id zero is refused and the first positive id reaches submission', async () => {
    const reads: number[] = [];
    const writes: number[] = [];
    const app = buildApp({
      fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, event_id: 1 } },
      submitResult: { ok: true, request: { ...COMPLETE_DRAFT, event_id: 1, status: 'submitted' } },
      captureFetch: eventId => { reads.push(eventId); }, captureSubmit: eventId => { writes.push(eventId); }
    });
    const refused = await request(app).patch('/api/event-requests/0/submit');
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body, { error: 'eventId must be a positive integer.' });
    assert.deepEqual(reads, []);
    assert.deepEqual(writes, []);
    const accepted = await request(app).patch('/api/event-requests/1/submit');
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.request.event_id, 1);
    assert.deepEqual(reads, [1]);
    assert.deepEqual(writes, [1]);
  });

  test('[NORMAL] [SG2-30:AC1] [SG2-40:AC1] [SG2-40:AC2] submits a complete draft owned by the caller and records draft → unassigned with the organiser as actor', async () => {
    let fetched: { eventId: number; organiserId: string } | undefined;
    let submitted: number | undefined;
    const app = buildApp({
      submitResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'unassigned' } },
      captureFetch: (eventId, organiserId) => (fetched = { eventId, organiserId }),
      captureSubmit: (eventId) => (submitted = eventId)
    });
    const response = await request(app).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 200);
    assert.deepEqual(response.body.request, { ...COMPLETE_DRAFT, status: 'unassigned' });
    assert.deepEqual(fetched, { eventId: 7, organiserId: 'user-1' });
    assert.equal(submitted, 7);
    assert.deepEqual(app.history, [[{
      event_id: 7, actor_id: 'user-1', field_name: 'status', old_value: 'draft', new_value: 'unassigned'
    }]]);
  });

  test('[FAILURE] [SG2-30:AC1] returns 400 for a non-numeric eventId', async () => {
    const response = await request(buildApp()).patch('/api/event-requests/not-a-number/submit');
    assert.equal(response.status, 400);
  });

  test('[FAILURE] [SG2-30:AC1] returns 401 when no verified principal is present', async () => {
    const response = await request(buildApp({ principal: undefined })).patch(
      '/api/event-requests/7/submit'
    );
    assert.equal(response.status, 401);
  });

  test('[FAILURE] [SG2-30:AC1] returns 503 when the database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 503);
  });

  test('[FAILURE] [SG2-30:AC1] returns 404 when the request does not exist or belongs to someone else', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'missing' } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 404);
  });

  test('[FAILURE] [SG2-30:AC1] returns 503 without leaking the database error when the lookup fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
  });

  test('[CONFLICT] [SG2-30:AC3] returns 409 when the request is already submitted', async () => {
    let writes = 0;
    const response = await request(
      buildApp({
        fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'submitted' } },
        captureSubmit: () => { writes++; }
      })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 409);
    assert.equal(writes, 0);
  });

  test('[CONFLICT] [SG2-30:AC3] returns 409 for a status that is neither draft nor rejected', async () => {
    let writes = 0;
    const response = await request(
      buildApp({
        fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'under_review' } },
        captureSubmit: () => { writes++; }
      })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 409);
    assert.equal(writes, 0);
  });

  test('[NORMAL] [SG2-30:AC1] [SG2-40:AC2] resubmits a rejected request owned by the caller and records rejected → submitted', async () => {
    let submitted: number | undefined;
    const app = buildApp({
      fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'rejected' } },
      captureSubmit: (eventId) => (submitted = eventId)
    });
    const response = await request(app).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'submitted');
    assert.equal(submitted, 7);
    assert.deepEqual(app.history, [[{
      event_id: 7, actor_id: 'user-1', field_name: 'status', old_value: 'rejected', new_value: 'submitted'
    }]]);
  });

  test('[NORMAL] [SG2-36:AC2] [SG2-40:AC2] resubmits a request returned for clarification, sending it back for review and recording needs_clarification → submitted', async () => {
    let submitted: number | undefined;
    const app = buildApp({
      fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'needs_clarification' } },
      captureSubmit: (eventId) => (submitted = eventId)
    });
    const response = await request(app).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 200);
    assert.equal(response.body.request.status, 'submitted');
    assert.equal(submitted, 7);
    assert.deepEqual(app.history, [[{
      event_id: 7, actor_id: 'user-1', field_name: 'status', old_value: 'needs_clarification', new_value: 'submitted'
    }]]);
  });

  test('[FAILURE] [SG2-36:AC2] a returned request emptied while amending cannot be resubmitted', async () => {
    let writes = 0;
    const response = await request(
      buildApp({
        captureSubmit: () => { writes++; },
        fetchResult: {
          ok: true,
          request: { ...COMPLETE_DRAFT, status: 'needs_clarification', expected_attendance: null }
        }
      })
    ).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.missing, ['expected_attendance']);
    assert.equal(writes, 0);
  });

  test('[FAILURE] [SG2-105:AC3] [SG2-36:AC2] a returned request whose accessibility and equipment answers were cleared cannot be resubmitted', async () => {
    let writes = 0;
    const app = buildApp({
      captureSubmit: () => { writes++; },
      fetchResult: {
        ok: true,
        request: {
          ...COMPLETE_DRAFT, status: 'needs_clarification',
          accessibility_needs: null, equipment_requirements: null
        }
      }
    });
    const response = await request(app).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.missing, ['accessibility_needs', 'equipment_requirements']);
    assert.equal(writes, 0);
    assert.deepEqual(app.history, []);
  });

  test('[FAILURE] [SG2-30:AC2] returns 400 and lists outstanding fields for an incomplete draft', async () => {
    let writes = 0;
    const response = await request(
      buildApp({
        captureSubmit: () => { writes++; },
        fetchResult: {
          ok: true,
          request: { ...COMPLETE_DRAFT, name: null, purpose: '' }
        }
      })
    ).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.missing, ['name', 'purpose']);
    assert.equal(writes, 0);
  });

  test('[FAILURE] [SG2-30:AC2] returns 400 and lists description when it is blank', async () => {
    let writes = 0;
    const response = await request(
      buildApp({
        captureSubmit: () => { writes++; },
        fetchResult: {
          ok: true,
          request: { ...COMPLETE_DRAFT, description: null }
        }
      })
    ).patch('/api/event-requests/7/submit');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body.missing, ['description']);
    assert.equal(writes, 0);
  });

  test('[NORMAL] [SG2-105:AC2] [SG2-30:AC1] accessibility needs and equipment requirements answered "None" can be submitted', async () => {
    let submitted: number | undefined;
    const response = await request(
      buildApp({
        fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, accessibility_needs: 'None', equipment_requirements: 'None' } },
        captureSubmit: (eventId) => (submitted = eventId)
      })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 200);
    assert.equal(submitted, 7);
  });

  test('[FAILURE] [SG2-105:AC2] [SG2-105:AC3] blank accessibility needs is refused and listed (replaces SG2-28 AC2)', async () => {
    let writes = 0;
    const response = await request(
      buildApp({
        captureSubmit: () => { writes++; },
        fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, accessibility_needs: null } }
      })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Event request is missing required fields.', missing: ['accessibility_needs'] });
    assert.equal(writes, 0);
  });

  test('[FAILURE] [SG2-105:AC3] a draft missing every field the customer added lists each one and stays a draft', async () => {
    let writes = 0;
    const app = buildApp({
      captureSubmit: () => { writes++; },
      fetchResult: {
        ok: true,
        request: {
          ...COMPLETE_DRAFT, preferred_layout: null, accessibility_needs: null,
          equipment_requirements: null, registration_needed: null
        }
      }
    });
    const response = await request(app).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 400);
    assert.deepEqual(response.body.missing,
      ['preferred_layout', 'accessibility_needs', 'equipment_requirements', 'registration_needed']);
    // No status write, history row or notice: the request is still the draft it was.
    assert.equal(writes, 0);
    assert.deepEqual(app.history, []);
    assert.deepEqual(app.notices, []);
  });

  test('[BOUNDARY] [SG2-105:AC1] a request saying registration is not needed has answered the question and can be submitted', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, registration_needed: false } } })
    ).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 200);
  });

  test('[FAILURE] [SG2-30:AC1] [SG2-40:AC1] returns 503 without leaking the database error when the update fails, recording nothing', async () => {
    const app = buildApp({ submitResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } });
    const response = await request(app).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 503);
    assert.doesNotMatch(response.text, /SENTINEL/);
    assert.deepEqual(app.history, []);
  });

  test('[FAILURE] [SG2-40:AC1] answers 503 without provider details when the submission cannot be recorded in history', async () => {
    const app = buildApp({ historyResult: { ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' } });
    const response = await request(app).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Event requests are temporarily unavailable. Please try again later.' });
    assert.equal(app.history.length, 1);
    assert.deepEqual(app.notices, []);
  });
});

describe('PATCH /api/event-requests/:eventId/submit notices (SG2-68)', () => {
  const UNAVAILABLE = { error: 'Event requests are temporarily unavailable. Please try again later.' };

  test('[NORMAL] [SG2-68:AC1] [SG2-68:AC2] a submission waiting for a coordinator tells every Event Coordinator Lead, after the history row', async () => {
    const app = buildApp({ submitResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'unassigned' } } });
    const response = await request(app).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 200);
    assert.deepEqual(app.leadReads, [1]);
    assert.deepEqual(app.notices, [[
      { recipient_id: 'lead-1', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was submitted and is waiting for a coordinator.' },
      { recipient_id: 'lead-2', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was submitted and is waiting for a coordinator.' }
    ]]);
  });

  test('[NORMAL] [SG2-68:AC1] [SG2-68:AC3] a resubmission that goes back to its coordinator tells only that coordinator, not the Leads', async () => {
    const app = buildApp({
      fetchResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'needs_clarification', coordinator_id: 'coord-1' } }
    });
    const response = await request(app).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 200);
    assert.deepEqual(app.leadReads, []);
    assert.deepEqual(app.notices, [[
      { recipient_id: 'coord-1', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was resubmitted for your review.' }
    ]]);
  });

  test('[BOUNDARY] [SG2-68:AC2] an unnamed event is named "Untitled event", and an empty Lead list sends nothing', async () => {
    const app = buildApp({
      submitResult: { ok: true, request: { ...COMPLETE_DRAFT, name: null, status: 'unassigned' } },
      leadsResult: { ok: true, ids: ['lead-1'] }
    });
    await request(app).patch('/api/event-requests/7/submit');
    assert.deepEqual(app.notices, [[
      { recipient_id: 'lead-1', event_id: 7, kind: 'event_submitted', message: 'Untitled event was submitted and is waiting for a coordinator.' }
    ]]);
    const none = buildApp({
      submitResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'unassigned' } },
      leadsResult: { ok: true, ids: [] }
    });
    assert.equal((await request(none).patch('/api/event-requests/7/submit')).status, 200);
    assert.deepEqual(none.notices, [[]]);
  });

  test('[CONFLICT] [SG2-68:AC3] the organiser is never told about their own submission, even if they also hold a recipient part', async () => {
    const app = buildApp({
      submitResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'unassigned' } },
      leadsResult: { ok: true, ids: ['user-1', 'lead-2'] }
    });
    await request(app).patch('/api/event-requests/7/submit');
    assert.deepEqual(app.notices[0].map(notice => notice.recipient_id), ['lead-2']);
  });

  test('[FAILURE] [SG2-68:AC1] an unreadable Lead list or a notice that cannot be stored answers 503 after the history row, without provider details', async () => {
    const unread = buildApp({
      submitResult: { ok: true, request: { ...COMPLETE_DRAFT, status: 'unassigned' } },
      leadsResult: { ok: false }
    });
    const first = await request(unread).patch('/api/event-requests/7/submit');
    assert.deepEqual([first.status, first.body], [503, UNAVAILABLE]);
    assert.equal(unread.history.length, 1);
    assert.deepEqual(unread.notices, []);

    const unstored = buildApp({ notifyResult: { ok: false } });
    const second = await request(unstored).patch('/api/event-requests/7/submit');
    assert.deepEqual([second.status, second.body], [503, UNAVAILABLE]);
    assert.equal(unstored.history.length, 1);
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
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('[FAILURE] [SG2-25:AC3] [SG2-30:AC1] rejects an unauthenticated request', async () => {
    const response = await request(appForRole('event_organiser')).patch('/api/event-requests/7/submit');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-30:AC1] denies a role without the submit permission', async () => {
    const response = await request(appForRole('attendee'))
      .patch('/api/event-requests/7/submit')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 403);
  });

  test('[NORMAL] [SG2-30:AC1] lets an Event Organiser reach the submit handler', async () => {
    const response = await request(appForRole('event_organiser'))
      .patch('/api/event-requests/7/submit')
      .set('Authorization', 'Bearer token');
    assert.equal(response.status, 200);
    assert.equal(response.body.reached, true);
  });
});
