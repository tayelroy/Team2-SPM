import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, Principal } from '../auth';
import { createEventRequestsRouter } from './routes';

const organiserId = '10000000-0000-4000-8000-000000000001';
const requestId = 'aaaaaaaa-0000-4000-8000-000000000001';

const PERMISSIONS = {
  'event_requests.create': ['event_organiser'],
  'event_requests.view': ['event_organiser'],
  'event_requests.update': ['event_organiser'],
  'event_requests.submit': ['event_organiser']
} as const;

function buildApp(options: {
  principal?: Principal;
  getAdminClient?: () => SupabaseClient | null;
}) {
  const access = createAuthorization({
    resolvePrincipal: async () => options.principal ?? { userId: organiserId, role: 'event_organiser' },
    permissions: PERMISSIONS
  });
  const app = express();
  app.use(express.json());
  app.use('/api/event-requests', createEventRequestsRouter(access, options.getAdminClient ?? (() => null)));
  return app;
}

function fakeAdmin(options: {
  insert?: (row: any) => Promise<{ data: any; error: any }>;
  select?: (filters: Record<string, string>) => Promise<{ data: any; error: any }>;
  update?: (patch: any, filters: Record<string, string>) => Promise<{ data: any; error: any }>;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'event_requests') throw new Error(`Unexpected table: ${table}`);
      return {
        insert(row: any) {
          return { select: () => ({ single: () => options.insert!(row) }) };
        },
        select() {
          const filters: Record<string, string> = {};
          const builder = {
            eq(column: string, value: string) {
              filters[column] = value;
              return builder;
            },
            maybeSingle: () => options.select!(filters)
          };
          return builder;
        },
        update(patch: any) {
          const filters: Record<string, string> = {};
          const builder = {
            eq(column: string, value: string) {
              filters[column] = value;
              return builder;
            },
            select: () => ({ maybeSingle: () => options.update!(patch, filters) })
          };
          return builder;
        }
      };
    }
  } as unknown as SupabaseClient;
}

const draftRow = {
  id: requestId,
  organiser_id: organiserId,
  status: 'draft',
  event_name: null,
  purpose: null,
  description: null,
  proposed_date_time: null,
  expected_attendance: null,
  venue_requirements: null,
  equipment_requirements: null,
  registration_needed: null,
  accessibility_needs: null,
  submitted_at: null
};

/** Bodyless, independent of express.json(), which normalises a missing body to {}. */
function buildAppWithoutJson(admin: SupabaseClient) {
  const access = createAuthorization({
    resolvePrincipal: async () => ({ userId: organiserId, role: 'event_organiser' }),
    permissions: PERMISSIONS
  });
  const app = express();
  app.use('/api/event-requests', createEventRequestsRouter(access, () => admin));
  return app;
}

describe('POST /api/event-requests', () => {
  test('creates a draft for the authenticated organiser', async () => {
    const admin = fakeAdmin({ insert: async () => ({ data: draftRow, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .post('/api/event-requests')
      .set('Authorization', 'Bearer token')
      .send({ eventName: 'Partner Forum' });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'draft');
    assert.equal(res.body.organiserId, organiserId);
  });

  test('is denied to a role without the permission', async () => {
    const res = await request(buildApp({ principal: { userId: organiserId, role: 'attendee' } }))
      .post('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 403);
  });

  test('returns 503 without a configured admin client', async () => {
    const res = await request(buildApp({ getAdminClient: () => null }))
      .post('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
  });

  test('returns 503 when the insert fails', async () => {
    const admin = fakeAdmin({ insert: async () => ({ data: null, error: { message: 'boom' } }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .post('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
  });

  test('treats an absent request body as an empty draft', async () => {
    const admin = fakeAdmin({
      insert: async (row) => {
        assert.deepEqual(row, { organiser_id: organiserId, status: 'draft' });
        return { data: draftRow, error: null };
      }
    });
    const res = await request(buildAppWithoutJson(admin))
      .post('/api/event-requests')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 201);
  });
});

describe('GET /api/event-requests/:id', () => {
  test('returns the organiser\'s own request', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: draftRow, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .get(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, requestId);
  });

  test('returns 404 for a request the organiser does not own', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .get(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 404);
  });

  test('returns 503 on a database error', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: { message: 'boom' } }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .get(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
  });

  test('returns 503 without a configured admin client', async () => {
    const res = await request(buildApp({ getAdminClient: () => null }))
      .get(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
  });
});

describe('PATCH /api/event-requests/:id', () => {
  test('updates a draft field', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: draftRow, error: null }),
      update: async () => ({ data: { ...draftRow, event_name: 'New name' }, error: null })
    });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .patch(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token')
      .send({ eventName: 'New name' });
    assert.equal(res.status, 200);
    assert.equal(res.body.eventName, 'New name');
  });

  test('returns 404 for a request the organiser does not own', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .patch(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token')
      .send({});
    assert.equal(res.status, 404);
  });

  test('refuses to edit an already submitted request (SG2-30 AC3)', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: { ...draftRow, status: 'submitted' }, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .patch(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token')
      .send({ eventName: 'New name' });
    assert.equal(res.status, 409);
  });

  test('returns 503 on a database error', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: draftRow, error: null }),
      update: async () => ({ data: null, error: { message: 'boom' } })
    });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .patch(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token')
      .send({});
    assert.equal(res.status, 503);
  });

  test('returns 503 without a configured admin client', async () => {
    const res = await request(buildApp({ getAdminClient: () => null }))
      .patch(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token')
      .send({});
    assert.equal(res.status, 503);
  });

  test('treats an absent request body as no field changes', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: draftRow, error: null }),
      update: async (patch) => {
        assert.deepEqual(patch, {});
        return { data: draftRow, error: null };
      }
    });
    const res = await request(buildAppWithoutJson(admin))
      .patch(`/api/event-requests/${requestId}`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
  });
});

describe('POST /api/event-requests/:id/submit', () => {
  const completeRow = {
    ...draftRow,
    event_name: 'Partner Forum',
    purpose: 'Strengthen institutional partnerships',
    description: 'A half-day forum with keynotes and a panel.',
    proposed_date_time: '2026-10-12T09:00:00Z',
    expected_attendance: 180,
    venue_requirements: 'Stage, step-free access, hearing loop',
    equipment_requirements: 'Lectern and PA system',
    registration_needed: true
  };

  test('submits a complete draft (SG2-30 AC1)', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: completeRow, error: null }),
      update: async (patch) => ({ data: { ...completeRow, status: 'submitted', submitted_at: patch.submitted_at }, error: null })
    });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .post(`/api/event-requests/${requestId}/submit`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'submitted');
  });

  test('refuses an incomplete draft and lists the outstanding fields (SG2-30 AC2)', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: draftRow, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .post(`/api/event-requests/${requestId}/submit`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 400);
    assert.ok(Array.isArray(res.body.missingFields));
    assert.ok(res.body.missingFields.includes('Event name'));
  });

  test('returns 404 for a request the organiser does not own', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .post(`/api/event-requests/${requestId}/submit`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 404);
  });

  test('refuses to resubmit an already submitted request (SG2-30 AC3)', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: { ...completeRow, status: 'submitted' }, error: null }) });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .post(`/api/event-requests/${requestId}/submit`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 409);
  });

  test('returns 503 on a database error', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: completeRow, error: null }),
      update: async () => ({ data: null, error: { message: 'boom' } })
    });
    const res = await request(buildApp({ getAdminClient: () => admin }))
      .post(`/api/event-requests/${requestId}/submit`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
  });

  test('returns 503 without a configured admin client', async () => {
    const res = await request(buildApp({ getAdminClient: () => null }))
      .post(`/api/event-requests/${requestId}/submit`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
  });

  test('is denied to a role without the permission', async () => {
    const res = await request(buildApp({ principal: { userId: organiserId, role: 'attendee' } }))
      .post(`/api/event-requests/${requestId}/submit`)
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 403);
  });
});
