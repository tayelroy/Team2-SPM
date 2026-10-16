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
import express from 'express';
import { createVenueBookingRequestsRouter } from '../server/src/venues/bookingRequests';
import { createGetEventHistoryHandler } from '../server/src/events/getHistory';
import { createGetEventArrangementsHandler } from '../server/src/events/getArrangements';
import { createBookingRequestSuitabilityRouter } from '../server/src/venues/suitabilityRoutes';

const rest = new URL(process.env.INTEGRATION_REST_URL!);
assert.equal(rest.protocol, 'http:');
assert.equal(rest.hostname, '127.0.0.1', 'Integration DB transport must be loopback.');
assert.ok(rest.port);
const secret = process.env.INTEGRATION_JWT_SECRET!;
assert.equal(secret, 'isolated-integration-jwt-secret-at-least-32-characters');
const jwt = (role: string, sub?: string) => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, ...(sub ? { sub } : {}), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
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
args[20] = createGetEventHistoryHandler(dependencies);
args[21] = createListClarificationsHandler(dependencies);
args[22] = createAddClarificationHandler(dependencies);
args[27] = createAssignmentQueueRouter(access, dependencies);
args[28] = createGetEventArrangementsHandler(dependencies);
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

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-37:AC2] [SG2-30:AC1] a rejected request refuses direct edits and reservations while resubmission returns to coordinator review and preserves its rejection history', async () => {
  const id = await draft();
  assert.equal((await api.patch(`/api/event-requests/${id}/submit`).set(auth('organiser')).send({})).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/coordinator`).set(auth('lead')).send({ coordinatorId: ids.coordinator })).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/review`).set(auth('coordinator')).send({})).status, 200);
  const decision = await api.patch(`/api/event-requests/${id}/decision`).set(auth('coordinator')).send({ decision: 'rejected', reason: 'This event cannot be accommodated.' });
  assert.equal(decision.status, 200, JSON.stringify(decision.body));
  const original = await stored(id);
  const history = await database.from('event_audit_logs').select('*').eq('event_id', id).order('log_id');
  assert.equal(history.error, null);
  assert.ok(history.data!.some(row => row.field_name === 'status' && row.new_value === 'rejected'));
  assert.equal((await api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send({ name: 'Overwrite rejected event' })).status, 409);
  const venueApi = request(express().use(express.json()).use('/api/venue-booking-requests',
    createVenueBookingRequestsRouter(access, { getAdminClient: () => database })));
  const venue = await venueApi.post('/api/venue-booking-requests').set(auth('coordinator')).send({
    event_id: id, venue_id: 1, layout: 'theatre', starts_at: '2090-06-15T02:00:00Z', ends_at: '2090-06-15T04:00:00Z'
  });
  assert.equal(venue.status, 409, JSON.stringify(venue.body));
  assert.match(venue.body.error, /rejected/);
  const reservation = await fetch(new URL('/rpc/manage_equipment_reservations', rest), {
    method: 'POST', headers: { Authorization: `Bearer ${jwt('authenticated', ids.support)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_action: 'reserve', p_event_id: id, p_request_id: 1, p_version: 1,
      p_starts_at: '2090-06-15T02:00:00Z', p_ends_at: '2090-06-15T04:00:00Z' })
  });
  assert.equal(reservation.status, 200);
  assert.equal((await reservation.json()).outcome, 'closed');
  for (const table of ['venue_booking_requests', 'venue_bookings', 'equipment_reservations']) {
    const result = await database.from(table).select('*').eq('event_id', id);
    assert.equal(result.error, null);
    assert.deepEqual(result.data, []);
  }
  assert.deepEqual(await stored(id), original);
  const after = await database.from('event_audit_logs').select('*').eq('event_id', id).order('log_id');
  assert.equal(after.error, null);
  assert.deepEqual(after.data, history.data);
  // Rejection is not final under the customer answers. Submitting the unchanged
  // request returns it to its coordinator; it never auto-approves or reserves.
  const resubmit = await api.patch(`/api/event-requests/${id}/submit`).set(auth('organiser')).send({});
  assert.equal(resubmit.status, 200, JSON.stringify(resubmit.body));
  assert.equal(resubmit.body.request.status, 'submitted');
  const resubmitted = await stored(id);
  assert.equal(resubmitted.coordinator_id, ids.coordinator);
  assert.equal(resubmitted.name, original.name);
  assert.equal(resubmitted.decision_reason, original.decision_reason);
  const resubmissionHistory = await database.from('event_audit_logs').select('*').eq('event_id', id).order('log_id');
  assert.equal(resubmissionHistory.error, null);
  assert.deepEqual(resubmissionHistory.data!.slice(0, history.data!.length), history.data);
  assert.ok(resubmissionHistory.data!.some(row => row.field_name === 'status' && row.old_value === 'rejected' && row.new_value === 'submitted'));
  const replacement = await draft({ ...values, name: 'New replacement request' });
  assert.notEqual(replacement, id);
  assert.equal((await stored(replacement)).status, 'draft');
  assert.equal((await api.patch(`/api/event-requests/${replacement}/submit`).set(auth('organiser')).send({})).status, 200);
  assert.equal((await stored(replacement)).status, 'unassigned');
  assert.equal((await stored(id)).status, 'submitted');
});

test('[BOUNDARY] [NORMAL] [SG2-36:AC2] clarification-needed requests remain editable and resubmit to the existing coordinator with their history', async () => {
  const id = await draft();
  assert.equal((await api.patch(`/api/event-requests/${id}/submit`).set(auth('organiser')).send({})).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/coordinator`).set(auth('lead')).send({ coordinatorId: ids.coordinator })).status, 200);
  assert.equal((await api.patch(`/api/event-requests/${id}/review`).set(auth('coordinator')).send({})).status, 200);
  const question = await api.post(`/api/event-requests/${id}/clarifications`).set(auth('coordinator')).send({ message: 'Please amend the seating requirement.' });
  assert.equal(question.status, 201);
  assert.equal((await api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send({ ...values, venue_requirements: 'Theatre seating' })).status, 200);
  const resubmit = await api.patch(`/api/event-requests/${id}/submit`).set(auth('organiser')).send({});
  assert.equal(resubmit.status, 200, JSON.stringify(resubmit.body));
  assert.equal(resubmit.body.request.status, 'submitted');
  const row = await stored(id);
  assert.equal(row.coordinator_id, ids.coordinator);
  assert.equal(row.venue_requirements, 'Theatre seating');
  const history = await database.from('event_audit_logs').select('field_name,old_value,new_value').eq('event_id', id);
  assert.equal(history.error, null);
  assert.ok(history.data!.some(entry => entry.field_name === 'status' && entry.old_value === 'needs_clarification' && entry.new_value === 'submitted'));
});

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

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-39:AC2] [SG2-57:AC2] [SG2-81:AC2] confirmed planning impacts mark ready arrangements outstanding without changing bookings or equipment receipts', async () => {
  const id = await planned();
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({
    registration_capacity: 136, registration_opens_at: '2089-10-01T13:30:00Z', registration_closes_at: '2089-10-02T13:30:00Z'
  })).status, 200);
  const venue = await database.from('venues').insert({ name: 'Integration Hall', capacity: 200 }).select('venue_id').single();
  assert.equal(venue.error, null);
  const equipment = await database.from('equipment').insert({ name: 'Integration projector', quantity_total: 10 }).select('equipment_id').single();
  assert.equal(equipment.error, null);
  const period = { event_id: id, starts_at: '2090-06-15T02:00:00Z', ends_at: '2090-06-15T04:00:00Z' };
  const booking = await database.from('venue_bookings').insert({ ...period, venue_id: venue.data!.venue_id, status: 'confirmed' }).select('*').single();
  assert.equal(booking.error, null);
  const venueRequest = await database.from('venue_booking_requests').insert({ ...period, venue_id: venue.data!.venue_id, status: 'approved', venue_booking_id: booking.data!.booking_id }).select('request_id').single();
  assert.equal(venueRequest.error, null);
  const demand = await database.from('equipment_requests').insert({ ...period, equipment_id: equipment.data!.equipment_id, quantity: 1, status: 'approved', shortfall: 0,
    placement_venue_id: venue.data!.venue_id, placement_position: 'Stage left' }).select('request_id').single();
  assert.equal(demand.error, null);
  const receipt = await database.from('equipment_reservations').insert({ ...period, equipment_id: equipment.data!.equipment_id, quantity_reserved: 1,
    request_id: demand.data!.request_id, reserved_at: '2089-10-01T00:00:00Z' }).select('*').single();
  assert.equal(receipt.error, null);
  const initial = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.equal(initial.status, 200);
  assert.equal(initial.body.ready_for_confirmation, true);
  const warned = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ expected_attendance: 137 });
  assert.equal(warned.status, 409);
  assert.deepEqual(warned.body.affected_arrangements, ['venue_recheck', 'equipment_recheck']);
  assert.equal((await stored(id)).expected_attendance, 136);
  assert.equal((await stored(id)).arrangements_recheck_needed, false);
  const saved = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ expected_attendance: 137, confirm_impact: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.outstanding, ['venue', 'equipment']);
  assert.equal(after.body.ready_for_confirmation, false);
  assert.deepEqual(after.body.arrangements.map((item: { state: string }) => item.state), ['outstanding', 'outstanding', 'ready']);
  assert.match(after.body.arrangements[0].detail, /recheck.*planning/i);
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ registration_capacity: 137, confirm_impact: true })).status, 200);
  const all = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.deepEqual(all.body.outstanding, ['venue', 'equipment', 'registration']);
  const persisted = await stored(id);
  assert.equal(persisted.arrangements_recheck_needed, true);
  assert.deepEqual(persisted.outstanding_arrangements, ['venue_recheck', 'equipment_recheck', 'registration_recheck']);
  assert.deepEqual((await database.from('venue_bookings').select('*').eq('booking_id', booking.data!.booking_id).single()).data, booking.data);
  assert.deepEqual((await database.from('equipment_reservations').select('*').eq('reservation_id', receipt.data!.reservation_id).single()).data, receipt.data);
  const disruption = await database.from('venue_unavailability').insert({ venue_id: venue.data!.venue_id,
    starts_at: period.starts_at, ends_at: period.ends_at, category: 'maintenance', reason: 'Integration combined readiness' });
  assert.equal(disruption.error, null);
  const combined = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.equal(combined.status, 200);
  assert.deepEqual(combined.body.outstanding, ['venue', 'equipment', 'registration']);
  assert.match(combined.body.arrangements[0].detail, /affected by venue unavailability/);
  assert.match(combined.body.arrangements[0].detail, /recheck.*planning/i);
  assert.deepEqual((await database.from('equipment_reservations').select('*').eq('reservation_id', receipt.data!.reservation_id).single()).data, receipt.data);
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

test('[NORMAL] [FAILURE] [SG2-47:AC3] [SG2-47:AC5] native capacity discovery enforces ownership, resolves real joins and records approval without deciding the booking', async () => {
  const ownEvent = await planned();
  const otherEvent = await planned();
  try {
    const changed = await database.from('events').update({ expected_attendance: 14, venue_requirements: 'Projector' }).in('event_id', [ownEvent, otherEvent]);
    assert.equal(changed.error, null);
    const otherOwner = await database.from('events').update({ organiser_id: ids.other }).eq('event_id', otherEvent);
    assert.equal(otherOwner.error, null);
    const venue = await database.from('venues').insert({ name: 'Integration Hall', capacity: 10, facilities: 'Projection' }).select('venue_id').single();
    assert.equal(venue.error, null);
    const inserted = await database.from('venue_booking_requests').insert([ownEvent, otherEvent].map(event_id => ({
      event_id, venue_id: venue.data!.venue_id, starts_at: '2090-06-20T02:00:00Z', ends_at: '2090-06-20T04:00:00Z',
      requested_by: ids.coordinator, layout: 'theatre'
    }))).select('request_id,event_id');
    assert.equal(inserted.error, null);
    const ownRequest = inserted.data!.find(row => row.event_id === ownEvent)!.request_id as number;
    const otherRequest = inserted.data!.find(row => row.event_id === otherEvent)!.request_id as number;
    const approvals = request(express().use(express.json()).use('/api/venue-booking-requests',
      createBookingRequestSuitabilityRouter(access, { getAdminClient: () => database })));
    const path = '/api/venue-booking-requests/capacity-exceptions';
    assert.equal((await approvals.get(path)).status, 401);
    for (const who of ['coordinator', 'lead', 'other']) {
      assert.equal((await approvals.get(path).set(auth(who))).status, 403, who);
    }
    const ownList = await approvals.get(`${path}?organiser_id=${ids.other}&event_id=${otherEvent}`).set(auth('organiser'));
    assert.equal(ownList.status, 200, JSON.stringify(ownList.body));
    assert.deepEqual(ownList.body.requests.map((row: { request_id: number }) => row.request_id), [ownRequest]);
    assert.deepEqual(Object.keys(ownList.body.requests[0]).sort(), [
      'request_id', 'event_id', 'event_name', 'venue_name', 'starts_at', 'ends_at', 'expected_attendance', 'venue_capacity'
    ].sort());
    assert.equal(ownList.body.requests[0].expected_attendance, 14);
    assert.equal(ownList.body.requests[0].venue_capacity, 10);
    for (const who of ['support', 'venue']) {
      const all = await approvals.get(path).set(auth(who));
      assert.equal(all.status, 200, JSON.stringify(all.body));
      assert.deepEqual(all.body.requests.map((row: { request_id: number }) => row.request_id), [ownRequest, otherRequest]);
    }
    assert.equal((await approvals.get(`/api/venue-booking-requests/${otherRequest}/suitability`).set(auth('organiser'))).status, 404);
    assert.equal((await approvals.post(`/api/venue-booking-requests/${otherRequest}/capacity-exception`).set(auth('organiser'))).status, 404);
    for (const [who, requestId] of [['organiser', ownRequest], ['support', otherRequest]] as const) {
      const approved = await approvals.post(`/api/venue-booking-requests/${requestId}/capacity-exception`).set(auth(who))
        .send({ approved_by: ids.coordinator, expected_attendance: 1 });
      assert.equal(approved.status, 201, JSON.stringify(approved.body));
      assert.equal(approved.body.exception.approved_by, ids[who]);
      assert.equal(approved.body.exception.expected_attendance, 14);
      assert.equal(approved.body.exception.venue_capacity, 10);
      assert.equal(approved.body.booking, 'allowed');
      const receipt = await approvals.get(`/api/venue-booking-requests/${requestId}/suitability`).set(auth(who));
      assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
      assert.deepEqual(receipt.body.exceptions, [approved.body.exception]);
      const pending = await database.from('venue_booking_requests').select('status,venue_booking_id').eq('request_id', requestId).single();
      assert.equal(pending.error, null);
      assert.deepEqual(pending.data, { status: 'pending', venue_booking_id: null });
      assert.deepEqual((await approvals.get(path).set(auth('organiser'))).body, { requests: [] });
    }
    assert.deepEqual((await approvals.get(path).set(auth('support'))).body, { requests: [] });
    const bookings = await database.from('venue_bookings').select('booking_id').in('event_id', [ownEvent, otherEvent]);
    assert.equal(bookings.error, null);
    assert.deepEqual(bookings.data, []);
  } finally {
    // Restore cleanup ownership even when an assertion fails in a reused CI DB.
    const restored = await database.from('events').update({ organiser_id: ids.organiser }).eq('event_id', otherEvent);
    assert.equal(restored.error, null);
  }
});


test('[NORMAL] [BOUNDARY] [FAILURE] [SG2-29:AC1] [SG2-36:AC2] [SG2-40:AC1] [SG2-40:AC2] [SG2-40:AC3] native draft saves commit exact field history and preserve owner-only access', async () => {
  const id = await draft({} as typeof values);
  const edited = { ...values, name: 'Audited draft', accessibility_needs: 'Step-free access' };
  const result = await api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send({ ...edited, actor_id: ids.other });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.request.organiser_id, ids.organiser);
  assert.deepEqual(result.body.missingForSubmission, []);
  const history = await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'));
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.equal(history.body.history.length, 9);
  const names = history.body.history.map((row: { field_name: string }) => row.field_name).sort();
  assert.deepEqual(names, Object.keys(edited).sort());
  for (const row of history.body.history) {
    assert.equal(row.actor_id, ids.organiser);
    assert.equal(row.actor_name, 'Integration organiser');
    assert.equal(row.actor_role, 'Event Organiser');
    assert.equal(row.old_value, null);
    assert.ok(Number.isFinite(Date.parse(row.created_at)));
    const expected = edited[row.field_name as keyof typeof edited];
    if (row.field_name === 'proposed_date') assert.equal(Date.parse(row.new_value), Date.parse(String(expected)));
    else assert.equal(row.new_value, String(expected));
  }
  assert.equal((await api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send(edited)).status, 200);
  assert.equal((await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'))).body.history.length, 9);
  assert.equal((await database.from('events').update({ status: 'needs_clarification' }).eq('event_id', id)).error, null);
  const cleared = { ...edited, description: null, registration_needed: false };
  assert.equal((await api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send(cleared)).status, 200);
  const changed = (await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'))).body.history;
  assert.equal(changed.length, 11);
  assert.deepEqual(changed.filter((row: { old_value: unknown }) => row.old_value !== null).map((row: { field_name: string; new_value: string | null }) => [row.field_name, row.new_value]).sort(), [['description', null], ['registration_needed', 'false']]);
  assert.equal((await database.from('account_roles').update({ role: 'event_organiser' }).eq('user_id', ids.other)).error, null);
  assert.equal((await database.from('users').update({ organisation: 'Integration organisation' }).eq('user_id', ids.other)).error, null);
  try {
    assert.equal((await api.patch(`/api/event-requests/${id}`).set(auth('other')).send(edited)).status, 404);
    assert.equal((await api.get(`/api/event-requests/${id}/history`).set(auth('other'))).status, 403);
  } finally {
    assert.equal((await database.from('account_roles').update({ role: 'event_coordinator' }).eq('user_id', ids.other)).error, null);
    assert.equal((await database.from('users').update({ organisation: null }).eq('user_id', ids.other)).error, null);
  }
  const direct = await fetch(new URL('/rpc/update_event_request_draft', rest), {
    method: 'POST', headers: { Authorization: `Bearer ${jwt('authenticated', ids.organiser)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_event_id: id, p_actor_id: ids.organiser, p_values: edited })
  });
  assert.equal(direct.status, 403);
  assert.equal((await api.patch(`/api/event-requests/${id}`).set(auth('coordinator')).send(edited)).status, 403);
  assert.equal((await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'))).body.history.length, 11);
});

test('[CONFLICT] [SG2-29:AC1] [SG2-30:AC3] [SG2-40:AC2] native concurrent draft saves serialize their old/new chain and submission closes the write path', async () => {
  const id = await draft();
  const saved = await Promise.all(['Concurrent A', 'Concurrent B'].map(name => api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send({ ...values, name })));
  assert.deepEqual(saved.map(result => result.status), [200, 200]);
  const history = await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'));
  assert.equal(history.status, 200);
  const chain = history.body.history.filter((row: { field_name: string }) => row.field_name === 'name').reverse();
  assert.equal(chain.length, 2);
  assert.equal(chain[0].old_value, values.name);
  assert.equal(chain[0].new_value, chain[1].old_value);
  assert.equal(chain[1].new_value, (await stored(id)).name);
  assert.equal((await api.patch(`/api/event-requests/${id}/submit`).set(auth('organiser')).send({})).status, 200);
  const before = await stored(id);
  const refused = await api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send({ ...values, name: 'After submission' });
  assert.equal(refused.status, 409);
  assert.deepEqual(await stored(id), before);
  const after = await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'));
  assert.equal(after.body.history.filter((row: { field_name: string }) => row.field_name === 'name').length, 2);
});
