/** Real API handlers and DB adapters over PostgREST/PostgreSQL. Only identity
 * verification is a synthetic token map; authorisation and role reads are real.
 * Run only through test-api-integration.mjs, which owns disposable containers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../server/src/app';
import { createAuthorization, AccessError, type Role } from '../server/src/auth';
import { getAccountRole } from '../server/src/db/accountRoles';
import { createEventDraftHandler } from '../server/src/events/createDraft';
import { createUpdateEventDraftHandler } from '../server/src/events/updateDraft';
import { submitEventRequestHandler } from '../server/src/events/submit';
import { getEventRequestsHandler, getEventRequestDetailHandler } from '../server/src/events/list';
import { createAssignCoordinatorHandler } from '../server/src/events/assignCoordinator';
import { createStartEventReviewHandler } from '../server/src/events/review';
import { createDecideEventRequestHandler } from '../server/src/events/decide';
import { createUpdateEventPlanningHandler } from '../server/src/events/updatePlanning';
import { createWorkQueueRouter } from '../server/src/workQueue';
import { createAssignmentQueueRouter } from '../server/src/assignmentQueue';
import { createAddClarificationHandler, createListClarificationsHandler } from '../server/src/events/clarifications';

const rest = new URL(process.env.INTEGRATION_REST_URL!);
assert.equal(rest.protocol, 'http:');
assert.equal(rest.hostname, '127.0.0.1', 'Integration DB transport must be loopback.');
assert.ok(rest.port);
const secret = process.env.INTEGRATION_JWT_SECRET!;
assert.equal(secret, 'isolated-integration-jwt-secret-at-least-32-characters');
const jwt = (role: string) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
};
// Supabase's gateway uses /rest/v1; this isolated PostgREST serves the same
// protocol at /. Rewrite only that loopback prefix, never any query or body.
const database = createClient(rest.origin, jwt('service_role'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const original = new Request(input, init);
    const url = new URL(original.url);
    assert.equal(url.origin, rest.origin);
    assert.ok(url.pathname.startsWith('/rest/v1/'));
    url.pathname = url.pathname.slice('/rest/v1'.length);
    const response = await fetch(new Request(url, original));
    if (!response.ok) console.error('Integration database response', url.pathname, await response.clone().text());
    return response;
  } },
});
const ids = Object.fromEntries(['organiser', 'coordinator', 'lead', 'venue', 'support', 'other'].map((name, index) =>
  [name, `ee000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const access = createAuthorization({ resolvePrincipal: async token => {
  const userId = ids[token];
  if (!userId) throw new AccessError(401);
  const role = await getAccountRole(database, userId);
  if (!role.ok) throw new AccessError(403);
  return { userId, role: role.role as Role };
} });
let available = true;
const dependencies = { getPrincipal: access.getPrincipal, getAdminClient: () => available ? database : null };
const args: Parameters<typeof createApp> = [];
args[1] = access;
args[2] = createEventDraftHandler(dependencies);
args[7] = submitEventRequestHandler(dependencies);
args[8] = getEventRequestsHandler(dependencies);
args[10] = createUpdateEventDraftHandler(dependencies);
args[11] = getEventRequestDetailHandler(dependencies);
args[13] = createWorkQueueRouter(access, dependencies);
args[15] = createStartEventReviewHandler(dependencies);
args[16] = createAssignCoordinatorHandler(dependencies);
args[17] = createDecideEventRequestHandler(dependencies);
args[19] = createUpdateEventPlanningHandler(dependencies);
args[21] = createListClarificationsHandler(dependencies);
args[22] = createAddClarificationHandler(dependencies);
args[27] = createAssignmentQueueRouter(access, dependencies);
const api = request(createApp(...args));
const auth = (who: string) => ({ Authorization: `Bearer ${who}` });
const values = { name: 'Integration workshop', purpose: 'Exercise actual storage', description: 'Synthetic test event',
  proposed_date: '2090-06-15T02:00:00.000Z', expected_attendance: 136,
  venue_requirements: 'A room with seating', equipment_requirements: '1 projector', registration_needed: true };
async function draft(body = values) {
  const result = await api.post('/api/event-requests').set(auth('organiser')).send(body);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.request.event_id as number;
}
async function planned() {
  const id = await draft();
  assert.equal((await api.patch(`/api/event-requests/${id}/submit`).set(auth('organiser')).send({})).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/coordinator`).set(auth('lead')).send({ coordinatorId: ids.coordinator })).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/review`).set(auth('coordinator')).send({})).status, 200);
  const decision = await api.patch(`/api/event-requests/${id}/decision`).set(auth('coordinator')).send({ decision: 'approved' });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
  return id;
}
async function stored(id: number) {
  const result = await database.from('events').select('*').eq('event_id', id).single();
  assert.equal(result.error, null);
  return result.data;
}

test('[NORMAL] [SG2-36:AC1] [SG2-36:AC3] clarification POST immediately returns the stored sender name and matches the reloaded thread', async () => {
  const id = await draft();
  assert.equal((await api.patch(`/api/event-requests/${id}/submit`).set(auth('organiser')).send({})).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/coordinator`).set(auth('lead')).send({ coordinatorId: ids.coordinator })).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/review`).set(auth('coordinator')).send({})).status, 200);
  const question = await api.post(`/api/event-requests/${id}/clarifications`).set(auth('coordinator')).send({ message: 'Which room layout do you need?' });
  assert.equal(question.status, 201, JSON.stringify(question.body));
  assert.equal(question.body.status, 'needs_clarification');
  assert.equal(question.body.clarification.sender_id, ids.coordinator);
  assert.equal(question.body.clarification.sender_name, 'Integration coordinator');
  assert.equal(question.body.clarification.message, 'Which room layout do you need?');
  const reply = await api.post(`/api/event-requests/${id}/clarifications`).set(auth('organiser')).send({ message: 'Theatre layout, please.' });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.clarification.sender_id, ids.organiser);
  assert.equal(reply.body.clarification.sender_name, 'Integration organiser');
  assert.equal(reply.body.clarification.message, 'Theatre layout, please.');
  for (const who of ['coordinator', 'organiser']) {
    const reloaded = await api.get(`/api/event-requests/${id}/clarifications`).set(auth(who));
    assert.equal(reloaded.status, 200, JSON.stringify(reloaded.body));
    assert.deepEqual(reloaded.body.clarifications, [question.body.clarification, reply.body.clarification]);
  }
  assert.equal((await api.get(`/api/event-requests/${id}/clarifications`).set(auth('other'))).status, 404);
});

test('[NORMAL] [SG2-28:AC1] [SG2-30:AC1] [SG2-87:AC5] [SG2-39:AC1] organiser submission, Lead assignment and planning preserve actual stored values', async () => {
  const id = await planned();
  assert.equal((await api.get('/api/assignment-queue').set(auth('lead'))).body.entries.some((entry: { event_id: number }) => entry.event_id === id), false);
  const registration = { registration_capacity: 136, registration_opens_at: '2089-10-01T13:30:00Z',
    registration_closes_at: '2089-10-01T13:31:00Z', planning_notes: 'Keep the loading bay clear' };
  const saved = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send(registration);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const queue = await api.get(`/api/work-queue/event/${id}`).set(auth('coordinator'));
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  assert.equal(queue.body.items[0].details.registration_capacity, 136);
  assert.equal(queue.body.items[0].details.planning_notes, 'Keep the loading bay clear');
  assert.equal(Date.parse(queue.body.items[0].details.registration_opens_at), Date.parse(registration.registration_opens_at));
  assert.equal(Date.parse(queue.body.items[0].details.registration_closes_at), Date.parse(registration.registration_closes_at));
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ equipment_requirements: '2 projectors' })).status, 200);
  const row = await stored(id);
  assert.equal(row.registration_capacity, 136);
  assert.equal(row.planning_notes, 'Keep the loading bay clear');
  assert.equal(Date.parse(row.registration_opens_at), Date.parse(registration.registration_opens_at));
  assert.equal(Date.parse(row.registration_closes_at), Date.parse(registration.registration_closes_at));
  assert.equal(row.equipment_requirements, '2 projectors');
  const history = await database.from('event_audit_logs').select('field_name,new_value').eq('event_id', id);
  assert.equal(history.error, null);
  assert.ok(history.data!.some(entry => entry.field_name === 'equipment_requirements' && entry.new_value === '2 projectors'));
});

test('[BOUNDARY] [SG2-28:AC1] [SG2-30:AC2] [SG2-39:AC4] incomplete draft cannot submit and capacity one retains explicit null fields', async () => {
  const created = await api.post('/api/event-requests').set(auth('organiser')).send({});
  assert.equal(created.status, 201);
  const refused = await api.patch(`/api/event-requests/${created.body.request.event_id}/submit`).set(auth('organiser')).send({});
  assert.equal(refused.status, 400);
  assert.equal((await stored(created.body.request.event_id)).status, 'draft');
  const id = await planned();
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ registration_capacity: 1, planning_notes: null })).status, 200);
  const details = (await api.get(`/api/work-queue/event/${id}`).set(auth('coordinator'))).body.items[0].details;
  assert.equal(details.registration_capacity, 1);
  assert.equal(details.registration_opens_at, null);
  assert.equal(details.registration_closes_at, null);
  assert.equal(details.planning_notes, null);
});

test('[CONFLICT] [SG2-90:AC3] coordinator reassigned after loading queue cannot write stale planning data', async () => {
  const id = await planned();
  assert.equal((await api.get(`/api/work-queue/event/${id}`).set(auth('coordinator'))).status, 200);
  const moved = await api.patch(`/api/event-requests/${id}/coordinator`).set(auth('lead')).send({ coordinatorId: ids.other });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ planning_notes: 'Stale write' })).status, 403);
  assert.equal((await stored(id)).planning_notes, null);
  assert.equal((await api.get(`/api/work-queue/event/${id}`).set(auth('coordinator'))).status, 404);
  assert.equal((await api.get(`/api/work-queue/event/${id}`).set(auth('other'))).status, 200);
});

test('[FAILURE] [SG2-41:AC4] [SG2-39:AC4] authentication, role and validation failures cannot expose or corrupt stored planning', async () => {
  const id = await planned();
  assert.equal((await api.get('/api/work-queue')).status, 401);
  assert.equal((await api.get('/api/assignment-queue').set(auth('coordinator'))).status, 403);
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('venue')).send({ planning_notes: 'Forbidden' })).status, 403);
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ registration_capacity: 0 })).status, 400);
  const direct = await fetch(new URL('/internal_work_items?select=details', rest), { headers: { Authorization: `Bearer ${jwt('anon')}` } });
  assert.ok([401, 403].includes(direct.status), `Direct client view read returned ${direct.status}`);
  available = false;
  try {
    assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ planning_notes: 'Unavailable write' })).status, 503);
  } finally { available = true; }
  const row = await stored(id);
  assert.equal(row.registration_capacity, null);
  assert.equal(row.planning_notes, null);
});


test('[NORMAL] [SG2-41:AC2] [SG2-41:AC3] native venue and equipment request projections reach only the matching staff queue', async () => {
  const id = await planned();
  const venue = await database.from('venues').insert({ name: 'Integration Hall', capacity: 200 }).select('venue_id').single();
  assert.equal(venue.error, null);
  const equipment = await database.from('equipment').insert({ name: 'Integration projector', quantity_total: 10 }).select('equipment_id').single();
  assert.equal(equipment.error, null);
  const period = { event_id: id, starts_at: '2090-06-15T02:00:00Z', ends_at: '2090-06-15T04:00:00Z', notes: 'Synthetic request' };
  const booking = await database.from('venue_booking_requests').insert({ ...period, venue_id: venue.data!.venue_id, requested_by: ids.coordinator, layout: 'theatre' }).select('request_id').single();
  assert.equal(booking.error, null);
  const requestRow = await database.from('equipment_requests').insert({ ...period, equipment_id: equipment.data!.equipment_id, quantity: 1 }).select('request_id').single();
  assert.equal(requestRow.error, null);
  for (const [who, kind, requestId, title] of [
    ['venue', 'venue', booking.data!.request_id, 'Integration Hall'],
    ['support', 'equipment', requestRow.data!.request_id, 'Integration projector'],
  ] as const) {
    const response = await api.get(`/api/work-queue/${kind}/${requestId}`).set(auth(who));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.items[0].title, title);
    assert.equal(response.body.items[0].event_id, id);
    assert.equal(response.body.items[0].details.notes, 'Synthetic request');
    assert.equal((await api.get(`/api/work-queue/event/${id}`).set(auth(who))).status, 404);
  }
});
