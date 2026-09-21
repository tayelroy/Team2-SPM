import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { getEventRequestsHandler, getEventRequestDetailHandler } from './events/list';
import {
  fetchOrganisationEventRequests, fetchOrganisationEventRequest,
  fetchOwnEventRequest
} from './db/eventRequests';
import { createEventDraftHandler } from './events/createDraft';
import { createUpdateEventDraftHandler } from './events/updateDraft';
import { createDeleteEventDraftHandler } from './events/deleteDraft';
import { submitEventRequestHandler } from './events/submit';
import type { EventRequestRecord } from './db/eventRequests';
import type { Principal } from './auth/policy';

type Row = Record<string, unknown>;
const EVENTS: Row[] = [
  { event_id: 1, organiser_id: 'alice', organisation: 'Acme', name: 'Alice draft', status: 'draft' },
  { event_id: 2, organiser_id: 'bob', organisation: 'Acme', name: 'Bob submitted', status: 'submitted' },
  { event_id: 3, organiser_id: 'carol', organisation: 'Other', name: 'Other event', status: 'draft' },
  { event_id: 4, organiser_id: 'alice', organisation: 'Former', name: 'Former organisation', status: 'draft' },
  { event_id: 5, organiser_id: 'unset', organisation: null, name: 'Unassigned', status: 'draft' }
];

/** Exercise the real Supabase query builder against an isolated dataset. */
function database(options: { users?: Row[]; events?: Row[]; fail?: string; throw?: boolean; nullEvents?: boolean } = {}) {
  const queries: URL[] = [];
  const users = options.users ?? [{ user_id: 'alice', organisation: 'Acme' }, { user_id: 'bob', organisation: 'Acme' }];
  const client = createClient('https://sg2-26.test.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      queries.push(url);
      const table = url.pathname.split('/').pop();
      if (options.throw) throw new Error('Database transport failed');
      if (options.fail === table) return new Response(JSON.stringify({ message: 'internal database details' }), { status: 500 });
      let rows = table === 'users' ? users : options.events ?? EVENTS;
      for (const [column, filter] of url.searchParams) {
        if (!filter.startsWith('eq.')) continue;
        rows = rows.filter(row => String(row[column]) === filter.slice(3));
      }
      if (url.searchParams.get('order') === 'event_id.desc') rows = [...rows].sort((a, b) => Number(b.event_id) - Number(a.event_id));
      return new Response(JSON.stringify(table === 'events' && options.nullEvents ? null : rows), { headers: { 'content-type': 'application/json' } });
    } }
  });
  return { client, queries, users };
}

function appFor(db: ReturnType<typeof database>, userId = 'alice', role: Principal['role'] = 'event_organiser') {
  const app = express();
  const dependencies = { getPrincipal: () => ({ userId, role }), getAdminClient: () => db.client };
  app.get('/api/event-requests', getEventRequestsHandler(dependencies));
  app.get('/api/event-requests/:eventId', getEventRequestDetailHandler(dependencies));
  return app;
}

describe('SG2-26 organisation access', () => {
  test('colleagues see the same organisation events and only their own rows are manageable', async () => {
    const db = database();
    for (const user of ['alice', 'bob']) {
      const response = await request(appFor(db, user)).get('/api/event-requests');
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.requests.map((row: Row) => row.event_id), [2, 1]);
      assert.deepEqual(response.body.requests.map((row: Row) => row.can_manage), user === 'alice' ? [false, true] : [true, false]);
    }
    const query = db.queries.find(url => url.pathname.endsWith('/events'))!;
    assert.equal(query.searchParams.get('organisation'), 'eq.Acme');
    assert.equal(query.searchParams.has('organiser_id'), false);
    assert.match(query.searchParams.get('select')!, /organiser_id/);
  });

  test('detail reads allow colleagues while creator-only mutation lookups remain restricted', async () => {
    const db = database();
    const colleague = await request(appFor(db)).get('/api/event-requests/2');
    assert.equal(colleague.status, 200);
    assert.equal(colleague.body.request.can_manage, false);
    const owner = await request(appFor(db)).get('/api/event-requests/1');
    assert.equal(owner.body.request.can_manage, true);
    const mutationLookup = await fetchOwnEventRequest(db.client, 2, 'alice');
    assert.equal(mutationLookup.ok, false);
    if (!mutationLookup.ok) assert.equal(mutationLookup.reason, 'not_found');
    for (const eventId of [3, 4, 999]) {
      const denied = await request(appFor(db)).get(`/api/event-requests/${eventId}`);
      assert.equal(denied.status, 404);
      assert.deepEqual(denied.body, { error: 'No event request found for this account.' });
    }
  });

  test('scope=mine and status filtering narrow the organisation query; supplied identity is ignored', async () => {
    const db = database();
    const response = await request(appFor(db)).get('/api/event-requests?scope=mine&status=draft&organisation=Other&userId=carol&organiser_id=carol');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.requests.map((row: Row) => row.event_id), [1]);
    const query = db.queries[1];
    assert.equal(query.searchParams.get('organisation'), 'eq.Acme');
    assert.equal(query.searchParams.get('organiser_id'), 'eq.alice');
    assert.equal(query.searchParams.get('status'), 'eq.draft');
    const filtered = await request(appFor(db)).get('/api/event-requests?scope=organisation&status=submitted');
    assert.deepEqual(filtered.body.requests.map((row: Row) => row.event_id), [2]);
  });

  test('membership is refreshed between reads and exact organisation names are not normalized', async () => {
    const db = database();
    await fetchOrganisationEventRequests(db.client, 'alice');
    db.users[0].organisation = 'Other';
    const changed = await fetchOrganisationEventRequests(db.client, 'alice');
    assert.ok(changed.ok);
    assert.deepEqual(changed.requests.map(row => row.event_id), [3]);
    const previous = await fetchOrganisationEventRequest(db.client, 1, 'alice');
    assert.equal(previous.ok, false);
    db.users[0].organisation = ' Acme ';
    assert.deepEqual(await fetchOrganisationEventRequests(db.client, 'alice'), { ok: true, requests: [] });
    assert.equal(db.queries.at(-1)!.searchParams.get('organisation'), 'eq. Acme ');
  });

  for (const membership of [null, '', '  \t ', undefined, 123, 'missing']) {
    test(`fails closed for absent membership ${JSON.stringify(membership)}`, async () => {
      const db = database({ users: membership === 'missing' ? [] : [{ user_id: 'alice', organisation: membership }] });
      const list = await request(appFor(db)).get('/api/event-requests');
      assert.equal(list.status, 200);
      assert.deepEqual(list.body, { requests: [] });
      const detail = await request(appFor(db)).get('/api/event-requests/1');
      assert.equal(detail.status, 404);
      assert.ok(db.queries.every(url => url.pathname.endsWith('/users')));
    });
  }

  for (const fail of ['users', 'events']) {
    test(`returns generic 503 when ${fail} lookup fails`, async () => {
      const db = database({ fail });
      for (const suffix of ['', '/1']) {
        const response = await request(appFor(db)).get(`/api/event-requests${suffix}`);
        assert.equal(response.status, 503);
        assert.doesNotMatch(JSON.stringify(response.body), /internal database details/);
      }
    });
  }

  test('empty database responses produce empty list and missing detail', async () => {
    const db = database({ nullEvents: true });
    assert.deepEqual(await fetchOrganisationEventRequests(db.client, 'alice'), { ok: true, requests: [] });
    const detail = await fetchOrganisationEventRequest(db.client, 1, 'alice');
    assert.equal(detail.ok, false);
  });

  for (const role of ['event_coordinator', 'attendee', 'venue_staff', 'technical_support_staff'] as const) {
    test(`${role} cannot use list or detail handlers and never reaches the database`, async () => {
      const db = database();
      const app = appFor(db, 'alice', role);
      for (const path of ['/api/event-requests', '/api/event-requests?scope=mine', '/api/event-requests/1', '/api/event-requests/invalid']) {
        const response = await request(app).get(path);
        assert.equal(response.status, 403);
        assert.deepEqual(response.body, { error: 'Access denied' });
      }
      assert.equal(db.queries.length, 0);
    });
  }

  for (const scope of ['all', '', 'mine&scope=organisation', 'mine%20', '[]']) {
    test(`rejects invalid scope ${scope} before a database read`, async () => {
      const db = database();
      const response = await request(appFor(db)).get(`/api/event-requests?scope=${scope}`);
      assert.equal(response.status, 400);
      assert.equal(db.queries.length, 0);
    });
  }

  test('thrown dependencies fail closed with generic 503 responses', async () => {
    const app = express();
    const deps = { getPrincipal: () => ({ userId: 'alice', role: 'event_organiser' as const }), getAdminClient: () => database().client };
    app.get('/list', getEventRequestsHandler({ ...deps, fetchRequests: async () => { throw new Error('internal'); } }));
    app.get('/detail/:eventId', getEventRequestDetailHandler({ ...deps, fetchRequest: async () => { throw new Error('internal'); } }));
    for (const path of ['/list', '/detail/1']) {
      const response = await request(app).get(path);
      assert.equal(response.status, 503);
      assert.doesNotMatch(JSON.stringify(response.body), /internal/);
    }
  });
});


describe('SG2-26 organisation membership on writes', () => {
  const completeEvent = {
    ...EVENTS[0], purpose: 'Planning', description: 'Annual meeting',
    proposed_date: '2026-11-15T09:00:00.000Z', expected_attendance: 10,
    venue_requirements: 'Meeting room'
  } as unknown as EventRequestRecord;

  function mutationApp(db: ReturnType<typeof database>) {
    const app = express();
    app.use(express.json());
    let writes = 0;
    const deps = { getPrincipal: () => ({ userId: 'alice', role: 'event_organiser' as const }), getAdminClient: () => db.client };
    app.post('/events', createEventDraftHandler({ ...deps, insertDraft: async (_admin, draft) => {
      writes++;
      return { ok: true, request: { ...completeEvent, ...draft.values, organisation: draft.organisation } };
    } }));
    app.patch('/events/:eventId', createUpdateEventDraftHandler({ ...deps, updateDraft: async () => {
      writes++;
      return { ok: true, request: completeEvent };
    } }));
    app.delete('/events/:eventId', createDeleteEventDraftHandler({ ...deps, deleteDraft: async () => {
      writes++;
      return { ok: true };
    } }));
    app.patch('/events/:eventId/submit', submitEventRequestHandler({ ...deps, submitRequest: async () => {
      writes++;
      return { ok: true, request: { ...completeEvent, status: 'submitted' } };
    } }));
    return { app, writes: () => writes };
  }

  for (const organisation of [null, '', '  \t ', undefined, 'missing']) {
    test(`missing membership ${JSON.stringify(organisation)} cannot create or mutate`, async () => {
      const db = database({ users: organisation === 'missing' ? [] : [{ user_id: 'alice', organisation }] });
      const harness = mutationApp(db);
      const create = await request(harness.app).post('/events').send({ name: 'New', organisation: 'Acme' });
      assert.equal(create.status, 403);
      assert.match(create.body.error, /client organisation/);
      assert.equal((await request(harness.app).patch('/events/1').send({ name: 'Changed' })).status, 404);
      assert.equal((await request(harness.app).delete('/events/1')).status, 404);
      assert.equal((await request(harness.app).patch('/events/1/submit')).status, 404);
      assert.equal(harness.writes(), 0);
      assert.ok(db.queries.every(url => url.pathname.endsWith('/users')));
    });
  }

  test('a moved creator, a colleague and unrelated organisations cannot mutate events', async () => {
    const db = database();
    const harness = mutationApp(db);
    for (const eventId of [2, 3, 4]) {
      assert.equal((await request(harness.app).patch(`/events/${eventId}`).send({ name: 'Changed' })).status, 404);
      assert.equal((await request(harness.app).delete(`/events/${eventId}`)).status, 404);
      assert.equal((await request(harness.app).patch(`/events/${eventId}/submit`)).status, 404);
    }
    db.users[0].organisation = 'Other';
    assert.equal((await request(harness.app).patch('/events/1').send({ name: 'Changed' })).status, 404);
    assert.equal((await request(harness.app).delete('/events/1')).status, 404);
    assert.equal((await request(harness.app).patch('/events/1/submit')).status, 404);
    assert.equal(harness.writes(), 0);
  });

  test('current member creators can still create, update, delete and submit', async () => {
    const db = database({ events: [completeEvent as unknown as Row] });
    const harness = mutationApp(db);
    assert.equal((await request(harness.app).post('/events').send({ name: 'New' })).status, 201);
    assert.equal((await request(harness.app).patch('/events/1').send({ name: 'Changed' })).status, 200);
    assert.equal((await request(harness.app).delete('/events/1')).status, 200);
    assert.equal((await request(harness.app).patch('/events/1/submit')).status, 200);
    assert.equal(harness.writes(), 4);
  });

  test('membership service failures stop writes with a generic 503', async () => {
    const harness = mutationApp(database({ fail: 'users' }));
    assert.equal((await request(harness.app).post('/events').send({ name: 'New' })).status, 503);
    assert.equal((await request(harness.app).patch('/events/1').send({ name: 'Changed' })).status, 503);
    assert.equal((await request(harness.app).delete('/events/1')).status, 503);
    assert.equal((await request(harness.app).patch('/events/1/submit')).status, 503);
    assert.equal(harness.writes(), 0);
  });
});
