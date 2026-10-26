/** Real API handlers and DB adapters over PostgREST/PostgreSQL. Only identity
 * verification is a synthetic token map; authorisation and role reads are real.
 * Run only through test-api-integration.mjs, which owns disposable containers. */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createClient } from '@supabase/supabase-js';
import { createApp } from '../server/src/app';
import { createAuthorization, AccessError, type Role } from '../server/src/auth';
import { getHeldRoles } from '../server/src/db/accountRoles';
import { dbConfig } from '../server/src/db/config';
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
import { createChangeRequestHandlers } from '../server/src/events/changeRequests';
import { createMockChangeRequestSource } from '../server/src/changeRequests/mockChangeRequests';
import { createSafetyDecisionHandlers } from '../server/src/events/safetyDecisionRoutes';
import { createSafetyChecksRouter } from '../server/src/safetyChecks';
import { createSafetyChecksStore } from '../server/src/db/safetyChecks';
import { createNotificationsRouter } from '../server/src/notifications';
import { createSafetyRereviewHandlers } from '../server/src/events/safetyRereviewRoutes';
import { createRegistrationHandlers } from '../server/src/events/registrationRoutes';
import { createRegistrableEventsRouter } from '../server/src/registrableEvents';
import { createRegistrableEventsStore } from '../server/src/db/registrableEvents';

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
const loopbackFetch: typeof fetch = async (input, init) => {
  const original = new Request(input, init);
  const url = new URL(original.url);
  assert.equal(url.origin, rest.origin);
  assert.ok(url.pathname.startsWith('/rest/v1/'));
  url.pathname = url.pathname.slice('/rest/v1'.length);
  const response = await fetch(new Request(url, original));
  if (!response.ok) console.error('Integration database response', url.pathname, await response.clone().text());
  return response;
};
const database = createClient(rest.origin, jwt('service_role'), {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: loopbackFetch },
});
const ids = Object.fromEntries(['organiser', 'coordinator', 'lead', 'venue', 'support', 'other', 'safety'].map((name, index) =>
  [name, `ee000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]));
const access = createAuthorization({ resolvePrincipal: async token => {
  const userId = ids[token];
  if (!userId) throw new AccessError(401);
  const role = await getHeldRoles(database, userId);
  if (!role.ok) throw new AccessError(403);
  return { userId, roles: role.roles as Role[] };
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
// SG2-63: the registration picture and the organiser's settings.
args[39] = createRegistrationHandlers(dependencies);
const api = request(createApp(...args));
/** SG2-63: the organiser, not the coordinator, sets registration capacity and times. */
async function setRegistration(id: number, settings: object = {
  registration_capacity: 136, registration_opens_at: '2089-10-01T13:30:00Z', registration_closes_at: '2089-10-02T13:30:00Z'
}) {
  const saved = await api.patch(`/api/event-requests/${id}/registration-settings`).set(auth('organiser')).send(settings);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return saved;
}
const auth = (who: string) => ({ Authorization: `Bearer ${who}` });
const values = { name: 'Integration workshop', purpose: 'Exercise actual storage', description: 'Synthetic test event',
  proposed_date: '2090-06-15T02:00:00.000Z', expected_attendance: 136,
  venue_requirements: 'A room with seating', equipment_requirements: '1 projector', registration_needed: true,
  // SG2-105: the rest of the customer's minimum for submission.
  preferred_layout: 'Classroom', accessibility_needs: 'None',
  // SG2-70: and the event's category.
  category: 'workshop' };
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

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-39:AC2] [SG2-57:AC2] [SG2-81:AC2] [SG2-94:AC4] confirmed planning impacts mark ready arrangements outstanding without changing bookings or equipment receipts', async () => {
  const id = await planned();
  await setRegistration(id);
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
  // SG2-91 moved the event into its check; SG2-94: the safety check is the one item left.
  assert.equal((await stored(id)).status, 'awaiting_safety_check');
  assert.deepEqual(initial.body.outstanding, ['safety']);
  assert.equal(initial.body.arrangements[3].detail, 'Awaiting the Safety Officer\'s operational safety check.');
  const warned = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ expected_attendance: 137 });
  assert.equal(warned.status, 409);
  assert.deepEqual(warned.body.affected_arrangements, ['venue_recheck', 'equipment_recheck']);
  assert.equal((await stored(id)).expected_attendance, 136);
  assert.equal((await stored(id)).arrangements_recheck_needed, false);
  const saved = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ expected_attendance: 137, confirm_impact: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const after = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.outstanding, ['venue', 'equipment', 'safety']);
  assert.equal(after.body.ready_for_confirmation, false);
  assert.deepEqual(after.body.arrangements.map((item: { state: string }) => item.state), ['outstanding', 'outstanding', 'ready', 'outstanding']);
  assert.match(after.body.arrangements[0].detail, /recheck.*planning/i);
  // SG2-63 AC8: registration capacity is the organiser's, so the coordinator's change is refused and adds no recheck.
  const capacity = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ registration_capacity: 137, confirm_impact: true });
  assert.equal(capacity.status, 403, JSON.stringify(capacity.body));
  const all = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.deepEqual(all.body.outstanding, ['venue', 'equipment', 'safety']);
  const persisted = await stored(id);
  assert.equal(persisted.arrangements_recheck_needed, true);
  assert.equal(persisted.registration_capacity, 136);
  assert.deepEqual(persisted.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
  assert.deepEqual((await database.from('venue_bookings').select('*').eq('booking_id', booking.data!.booking_id).single()).data, booking.data);
  assert.deepEqual((await database.from('equipment_reservations').select('*').eq('reservation_id', receipt.data!.reservation_id).single()).data, receipt.data);
  const disruption = await database.from('venue_unavailability').insert({ venue_id: venue.data!.venue_id,
    starts_at: period.starts_at, ends_at: period.ends_at, category: 'maintenance', reason: 'Integration combined readiness' });
  assert.equal(disruption.error, null);
  const combined = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.equal(combined.status, 200);
  assert.deepEqual(combined.body.outstanding, ['venue', 'equipment', 'safety']);
  assert.match(combined.body.arrangements[0].detail, /affected by venue unavailability/);
  assert.match(combined.body.arrangements[0].detail, /recheck.*planning/i);
  assert.deepEqual((await database.from('equipment_reservations').select('*').eq('reservation_id', receipt.data!.reservation_id).single()).data, receipt.data);
});

test('[CONFLICT] [NORMAL] [SG2-66:AC6] [SG2-66:AC7] confirmed and preparation events refuse direct detail edits, keep registration edits, and a later-stage impact returns to Planning with notices and history', async () => {
  const id = await planned();
  await setRegistration(id);
  // SG2-94: the event reaches Preparation on the Safety Officer's approval of its current check.
  assert.equal((await database.from('events').update({ status: 'awaiting_safety_check' }).eq('event_id', id)).error, null);
  assert.equal((await database.from('event_safety_decisions').insert({ event_id: id, decision: 'approve', decided_by: ids.safety })).error, null);
  for (const status of ['preparation', 'confirmed']) {
    assert.equal((await database.from('events').update({ status }).eq('event_id', id)).error, null);
    const before = await stored(id);
    const refused = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ expected_attendance: 137, confirm_impact: true });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.equal(refused.body.code, 'change_request_required');
    assert.deepEqual(refused.body.fields, ['expected_attendance']);
    assert.match(refused.body.error, /change request/);
    assert.deepEqual(await stored(id), before);
    // SG2-63 AC5: the organiser still changes registration once confirmed; the coordinator keeps their notes.
    await setRegistration(id, { registration_capacity: 130 });
    const notes = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ planning_notes: `Seats trimmed while ${status}` });
    assert.equal(notes.status, 200, JSON.stringify(notes.body));
    assert.equal((await stored(id)).status, status);
    assert.equal((await stored(id)).registration_capacity, 130);
    assert.equal((await database.from('events').update({ registration_capacity: 136 }).eq('event_id', id)).error, null);
  }

  // AC6 names only Confirmed and Preparation: an Awaiting Safety Check event still takes the edit.
  // SG2-91: an event only awaits its check while its venue is booked, so book
  // one and let the trigger move the event there (a pending request would
  // return it to Planning straight away).
  assert.equal((await database.from('events').update({ status: 'planning' }).eq('event_id', id)).error, null);
  const venue = await database.from('venues').insert({ name: 'Integration Return Hall', capacity: 200 }).select('venue_id').single();
  assert.equal(venue.error, null);
  const period = { event_id: id, venue_id: venue.data!.venue_id, starts_at: '2090-06-15T02:00:00Z', ends_at: '2090-06-15T04:00:00Z' };
  const booking = await database.from('venue_bookings').insert({ ...period, status: 'confirmed' }).select('booking_id').single();
  assert.equal(booking.error, null);
  assert.equal((await database.from('venue_booking_requests').insert({ ...period, status: 'approved',
    venue_booking_id: booking.data!.booking_id })).error, null);
  assert.equal((await stored(id)).status, 'awaiting_safety_check');
  const saved = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ expected_attendance: 137, confirm_impact: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await stored(id)).status, 'planning');
  const history = await database.from('event_audit_logs').select('field_name,old_value,new_value').eq('event_id', id).eq('field_name', 'status');
  assert.equal(history.error, null);
  assert.ok(history.data!.some(entry => entry.old_value === 'awaiting_safety_check' && entry.new_value === 'planning'));
  const notices = await database.from('notifications').select('recipient_id,message').eq('event_id', id).eq('kind', 'event_returned_to_planning');
  assert.equal(notices.error, null);
  assert.deepEqual(notices.data!.map(row => [row.recipient_id, row.message]).sort(), [
    [ids.organiser, 'Integration workshop has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.'],
    [ids.coordinator, 'Integration workshop is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.']
  ].sort());
});

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-66:AC1] [SG2-66:AC2] [SG2-66:AC3] [SG2-66:AC4] [SG2-66:AC5] [SG2-66:AC7] [SG2-94:AC3] native change impact lists what a change breaks, accepting it returns a Confirmed event to Planning and withdraws its safety approval, and each recheck settles only once it passes', async () => {
  const id = await planned();
  await setRegistration(id);
  const venue = await database.from('venues').insert({ name: 'Integration Change Hall', capacity: 150 }).select('venue_id').single();
  assert.equal(venue.error, null);
  const equipment = await database.from('equipment').insert({ name: 'Integration change microphone', quantity_total: 10 }).select('equipment_id').single();
  assert.equal(equipment.error, null);
  const period = { event_id: id, starts_at: '2090-06-15T01:00:00Z', ends_at: '2090-06-15T05:00:00Z' };
  const booking = await database.from('venue_bookings').insert({ ...period, venue_id: venue.data!.venue_id, status: 'confirmed' }).select('*').single();
  assert.equal(booking.error, null);
  const demand = await database.from('equipment_requests').insert({ ...period, equipment_id: equipment.data!.equipment_id, quantity: 2, status: 'approved',
    shortfall: 0, placement_venue_id: venue.data!.venue_id, placement_position: 'Lectern' }).select('request_id').single();
  assert.equal(demand.error, null);
  assert.equal((await database.from('equipment_reservations').insert({ ...period, equipment_id: equipment.data!.equipment_id, quantity_reserved: 2,
    request_id: demand.data!.request_id, reserved_at: '2089-10-01T00:00:00Z' })).error, null);
  // SG2-91: approved last, so the event enters the safety check once and never
  // bounces back to Planning (with notices) while the fixture is built.
  const venueRequest = await database.from('venue_booking_requests').insert({ ...period, venue_id: venue.data!.venue_id, status: 'approved',
    venue_booking_id: booking.data!.booking_id }).select('request_id').single();
  assert.equal(venueRequest.error, null);
  assert.equal((await database.from('registrations').insert([
    { event_id: id, attendee_id: ids.other, status: 'registered' }, { event_id: id, attendee_id: ids.support, status: 'registered' },
    { event_id: id, attendee_id: ids.lead, status: 'cancelled' }
  ])).error, null);
  // SG2-94: the event is confirmed on the Safety Officer's approval of the check SG2-91 put it in.
  assert.equal((await stored(id)).status, 'awaiting_safety_check');
  assert.equal((await database.from('event_safety_decisions').insert({ event_id: id, decision: 'approve', decided_by: ids.safety })).error, null);
  assert.equal((await database.from('events').update({ status: 'preparation' }).eq('event_id', id)).error, null);
  assert.equal((await database.from('events').update({ status: 'confirmed', confirmed_by: ids.coordinator, confirmed_at: '2089-10-03T00:00:00Z' })
    .eq('event_id', id)).error, null);

  const changeArgs = [...args] as Parameters<typeof createApp>;
  changeArgs[35] = createChangeRequestHandlers({ ...dependencies, source: createMockChangeRequestSource(() => new Date('2089-10-04T00:00:00Z')) });
  const changes = request(createApp(...changeArgs));
  const approvals = request(express().use(express.json()).use('/api/venue-booking-requests',
    createBookingRequestSuitabilityRouter(access, { getAdminClient: () => database })));
  const list = `/api/event-requests/${id}/change-requests`;
  const settle = (key: string) => changes.post(`/api/event-requests/${id}/rechecks/${key}/settle`).set(auth('coordinator'));

  // Only the assigned coordinator opens the requests; anyone else learns nothing.
  assert.equal((await changes.get(list).set(auth('organiser'))).status, 403);
  assert.equal((await changes.get(list).set(auth('other'))).status, 404);
  const opened = await changes.get(list).set(auth('coordinator'));
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.can_accept, true);
  const [attendance, date, wording] = opened.body.change_requests;
  assert.deepEqual([attendance.id, date.id, wording.id], [`mock-${id}-attendance`, `mock-${id}-date`, `mock-${id}-description`]);
  // AC1: a significant change lists every live arrangement for revalidation; registrations count only live rows.
  assert.deepEqual(attendance.changes, [{ field: 'expected_attendance', label: 'Expected attendance', from: 136, to: 204 }]);
  assert.deepEqual(attendance.impact.outstanding_arrangements, ['venue_recheck', 'equipment_recheck', 'registration_recheck']);
  assert.deepEqual(attendance.impact.arrangements.map((item: { kind: string }) => item.kind), ['venue_booking', 'equipment_reservation', 'registrations']);
  assert.match(attendance.impact.arrangements[2].label, /\b2\b/);
  // AC2: 204 guests no longer fit the 150-seat hall. AC3: a date change rechecks the venue and equipment
  // against the new period, not registrations.
  const [attendanceReasons, dateReasons] = [attendance, date].map(change => change.impact.arrangements
    .map((item: { reasons: { code: string }[] }) => item.reasons.map(reason => reason.code).sort()));
  assert.deepEqual(attendanceReasons, [['capacity_check', 'revalidate'], ['revalidate'], ['revalidate']]);
  assert.match(attendance.impact.arrangements[0].reasons.find((reason: { code: string }) => reason.code === 'capacity_check').message, /Venue Staff/);
  assert.deepEqual(dateReasons, [['period_recheck', 'revalidate'], ['period_recheck', 'revalidate'], ['revalidate']]);
  // A wording change is not significant.
  assert.deepEqual([wording.significant, wording.impact.arrangements, wording.impact.outstanding_arrangements], [false, [], []]);

  // AC4/AC7: accepting the attendance change returns the Confirmed event to Planning in one transaction.
  const accepted = await changes.post(`${list}/${attendance.id}/accept`).set(auth('coordinator'));
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual(accepted.body, { event_id: id, previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
    arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck', 'equipment_recheck', 'registration_recheck'] });
  const row = await stored(id);
  assert.deepEqual([row.status, row.expected_attendance, row.confirmed_by, row.confirmed_at], ['planning', 204, null, null]);
  const history = await database.from('event_audit_logs').select('field_name,old_value,new_value').eq('event_id', id)
    .in('field_name', ['expected_attendance', 'change_request', 'status', 'safety_approval']).order('log_id');
  assert.equal(history.error, null);
  assert.deepEqual(history.data!.slice(-4), [
    { field_name: 'expected_attendance', old_value: '136', new_value: '204' },
    { field_name: 'change_request', old_value: null, new_value: `Accepted change request ${attendance.id}` },
    { field_name: 'status', old_value: 'confirmed', new_value: 'planning' },
    { field_name: 'safety_approval', old_value: 'Approved',
      new_value: `Withdrawn: the accepted change request ${attendance.id} changed what was approved, so the event must pass the safety check again` }
  ]);
  const notices = await database.from('notifications').select('recipient_id,message').eq('event_id', id).eq('kind', 'event_returned_to_planning');
  assert.equal(notices.error, null);
  assert.deepEqual(notices.data!.map(notice => [notice.recipient_id, notice.message]).sort(), [
    [ids.organiser, 'Integration workshop has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.'],
    [ids.coordinator, 'Integration workshop is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.']
  ].sort());
  assert.deepEqual((await database.from('venue_bookings').select('*').eq('booking_id', booking.data!.booking_id).single()).data, booking.data);
  assert.equal((await changes.post(`${list}/${attendance.id}/accept`).set(auth('coordinator'))).status, 404);

  // AC2/AC5: the venue recheck cannot settle until Venue Staff (and only Venue Staff) cover the revised attendance.
  const blocked = await settle('venue_recheck');
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.blockers.join(' '), /Integration Change Hall/);
  const exception = `/api/venue-booking-requests/${venueRequest.data!.request_id}/capacity-exception`;
  for (const who of ['support', 'organiser', 'coordinator']) assert.equal((await approvals.post(exception).set(auth(who))).status, 403, who);
  const covered = await approvals.post(exception).set(auth('venue'));
  assert.equal(covered.status, 201, JSON.stringify(covered.body));
  assert.deepEqual([covered.body.exception.expected_attendance, covered.body.exception.approver_role], [204, 'venue_staff']);
  assert.deepEqual((await settle('venue_recheck')).body.outstanding_arrangements, ['equipment_recheck', 'registration_recheck']);
  assert.equal((await settle('venue_recheck')).status, 409);
  assert.equal((await settle('equipment_recheck')).status, 200);
  const last = await settle('registration_recheck');
  assert.deepEqual([last.status, last.body.arrangements_recheck_needed, last.body.outstanding_arrangements], [200, false, []]);
  const settled = await database.from('event_audit_logs').select('new_value').eq('event_id', id).eq('field_name', 'arrangement_recheck').order('log_id');
  assert.deepEqual(settled.data!.map(entry => entry.new_value), ['venue_recheck settled', 'equipment_recheck settled', 'registration_recheck settled']);
  // SG2-94 AC3: with every recheck settled SG2-91 returns the event to its check; a new approval is needed.
  assert.equal((await stored(id)).status, 'awaiting_safety_check');
  const readiness = await api.get(`/api/event-requests/${id}/arrangements`).set(auth('coordinator'));
  assert.deepEqual([readiness.status, readiness.body.outstanding], [200, ['safety']]);
});

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-92:AC1] [SG2-92:AC2] [SG2-92:AC3] [SG2-92:AC4] [SG2-92:AC5] [SG2-92:AC6] native safety decisions on SG2-91\'s list move each event on, refuse a stale review, notify both people, keep who and why, and let the coordinator rework a rejection', async () => {
  const [approved, rejected, changed] = [await planned(), await planned(), await planned()];
  for (const id of [approved, rejected, changed]) {
    assert.equal((await database.from('events').update({ status: 'awaiting_safety_check' }).eq('event_id', id)).error, null);
  }
  const safetyArgs = [...args] as Parameters<typeof createApp>;
  // SG2-91's list runs safety_check_queue() with the caller's own JWT, as in production.
  safetyArgs[36] = createSafetyChecksRouter(access, token => createSafetyChecksStore(token, () =>
    createClient(rest.origin, jwt('authenticated', ids[token]), { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: loopbackFetch } })));
  safetyArgs[37] = createSafetyDecisionHandlers(dependencies);
  const safety = request(createApp(...safetyArgs));
  const decide = (who: string, id: number, body: object) => safety.post(`/api/event-requests/${id}/safety-decision`).set(auth(who)).send(body);
  // The revision each event shows on SG2-91's list, which the decision carries back.
  const reviewed = async () => {
    const list = await safety.get('/api/safety-checks').set(auth('safety'));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    return new Map<number, number>(list.body.events.map((event: { event_id: number; safety_check_revision: number }) =>
      [event.event_id, event.safety_check_revision]));
  };

  // AC1: only the Safety Officer reads the list and decides.
  for (const who of ['coordinator', 'organiser', 'lead']) {
    assert.equal((await safety.get('/api/safety-checks').set(auth(who))).status, 403, who);
    assert.equal((await decide(who, approved, { decision: 'approve', safety_check_revision: 0 })).status, 403, who);
  }
  let revisions = await reviewed();
  assert.deepEqual([approved, rejected, changed].map(id => Number.isSafeInteger(revisions.get(id))), [true, true, true]);

  // AC2: a reason and, for Request Changes, the arrangements are required; nothing is written otherwise.
  const invalid = await decide('safety', changed, { decision: 'request_changes', reason: ' ', safety_check_revision: revisions.get(changed) });
  assert.deepEqual([invalid.status, invalid.body.details], [400, ['A reason is required to request changes.', 'Name at least one arrangement to change.']]);

  // A reviewed detail changing after the list was read refuses the decision on what was seen, writing nothing.
  assert.equal((await database.from('events').update({ expected_attendance: 450 }).eq('event_id', rejected)).error, null);
  const stale = await decide('safety', rejected, { decision: 'reject', reason: 'Crowd flow blocks the east exit', safety_check_revision: revisions.get(rejected) });
  assert.deepEqual([stale.status, stale.body], [409, { error: 'This event changed after you opened it. Refresh the safety checks and review it again.',
    code: 'stale', revision: revisions.get(rejected)! + 1 }]);
  assert.equal((await stored(rejected)).status, 'awaiting_safety_check');
  assert.equal((await database.from('event_safety_decisions').select('decision_id').eq('event_id', rejected)).data!.length, 0);
  revisions = await reviewed();

  // AC3/AC4/AC6: each decision moves its event on and is stored with who, when and why.
  const outcomes = [
    [approved, { decision: 'approve' }, 'preparation'],
    [rejected, { decision: 'reject', reason: 'Crowd flow blocks the east exit' }, 'safety_rejected'],
    [changed, { decision: 'request_changes', reason: 'Widen the aisles', arrangements: ['equipment', 'venue'] }, 'planning']
  ] as const;
  for (const [id, body, status] of outcomes) {
    const recorded = await decide('safety', id, { ...body, safety_check_revision: revisions.get(id) });
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    assert.deepEqual([recorded.body.previous_status, recorded.body.status], ['awaiting_safety_check', status]);
    assert.equal(recorded.body.decision.decided_by_name, 'Integration safety officer');
    assert.equal((await stored(id)).status, status);
  }
  const again = await decide('safety', approved, { decision: 'reject', reason: 'Second thoughts', safety_check_revision: revisions.get(approved) });
  assert.deepEqual([again.status, again.body], [409, { error: 'This event is no longer awaiting a safety check.', status: 'preparation' }]);
  const history = await safety.get(`/api/event-requests/${changed}/safety-decisions`).set(auth('organiser'));
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.decisions.map((row: { decision: string; reason: string; arrangements: string[]; decided_by: string }) =>
    [row.decision, row.reason, row.arrangements, row.decided_by]), [['request_changes', 'Widen the aisles', ['equipment', 'venue'], ids.safety]]);
  assert.equal((await safety.get(`/api/event-requests/${changed}/safety-decisions`).set(auth('other'))).status, 404);
  const audit = await database.from('event_audit_logs').select('field_name,old_value,new_value').eq('event_id', changed)
    .in('field_name', ['safety_decision', 'status']).order('log_id');
  assert.deepEqual(audit.data!.slice(-2), [
    { field_name: 'safety_decision', old_value: null, new_value: 'Changes requested (Equipment and technical, Venue): Widen the aisles' },
    { field_name: 'status', old_value: 'awaiting_safety_check', new_value: 'planning' }
  ]);

  // AC5: the organiser and the coordinator each get the decision and its reason.
  const notices = await database.from('notifications').select('recipient_id,message').eq('event_id', rejected).eq('kind', 'safety_decision');
  const message = 'Integration workshop did not pass its operational safety check: Crowd flow blocks the east exit. The coordinator will rework the arrangements for a new check.';
  assert.deepEqual(notices.data!.map(row => [row.recipient_id, row.message]).sort(), [[ids.organiser, message], [ids.coordinator, message]].sort());

  // AC4: only the assigned coordinator reworks, and only a Safety Rejected event.
  assert.equal((await safety.post(`/api/event-requests/${rejected}/rework`).set(auth('other'))).status, 404);
  assert.equal((await safety.post(`/api/event-requests/${approved}/rework`).set(auth('coordinator'))).status, 409);
  const reworked = await safety.post(`/api/event-requests/${rejected}/rework`).set(auth('coordinator'));
  assert.deepEqual([reworked.status, reworked.body], [200, { event_id: rejected, status: 'planning' }]);
  assert.equal((await stored(rejected)).status, 'planning');
});

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-93:AC1] [SG2-93:AC2] [SG2-93:AC3] [SG2-93:AC4] [SG2-93:AC5] native Request Changes sends the named venue back to Venue Staff, and the event returns to the check once it is confirmed again and Other is done', async () => {
  const id = await planned();
  const venue = await database.from('venues').insert({ name: 'Integration Hall', capacity: 200 }).select('venue_id').single();
  assert.equal(venue.error, null);
  const period = { event_id: id, venue_id: venue.data!.venue_id, starts_at: '2090-07-10T01:00:00Z', ends_at: '2090-07-10T05:00:00Z' };
  const booking = await database.from('venue_bookings').insert({ ...period, status: 'confirmed' }).select('booking_id').single();
  assert.equal(booking.error, null);
  // The approved request backed by its booking completes the arrangements, so
  // SG2-91's trigger puts the event on the Safety Officer's list.
  assert.equal((await database.from('venue_booking_requests').insert({ ...period, status: 'approved',
    venue_booking_id: booking.data!.booking_id }).select('request_id').single()).error, null);
  const before = await stored(id);
  assert.equal(before.status, 'awaiting_safety_check');

  const changeArgs = [...args] as Parameters<typeof createApp>;
  changeArgs[35] = createChangeRequestHandlers({ ...dependencies, source: createMockChangeRequestSource(() => new Date('2090-07-01T00:00:00Z')) });
  changeArgs[37] = createSafetyDecisionHandlers(dependencies);
  changeArgs[43] = createSafetyRereviewHandlers(dependencies);
  const app = request(createApp(...changeArgs));

  // AC1/AC3: only the named arrangements are outstanding, and the booking is untouched.
  const decided = await app.post(`/api/event-requests/${id}/safety-decision`).set(auth('safety')).send({
    decision: 'request_changes', reason: 'Move the stage away from the fire exit', arrangements: ['venue', 'other'],
    safety_check_revision: before.safety_check_revision });
  assert.equal(decided.status, 201, JSON.stringify(decided.body));
  let event = await stored(id);
  assert.deepEqual([event.status, event.arrangements_recheck_needed, event.outstanding_arrangements],
    ['planning', true, ['safety_venue_recheck', 'safety_other_recheck']]);
  assert.equal((await database.from('venue_bookings').select('status').eq('booking_id', booking.data!.booking_id).single()).data!.status, 'confirmed');

  // AC2: Venue Staff see it with the reason; Technical Support and the coordinator do not.
  const label = 'Integration Hall (10 Jul 2090 09:00 – 13:00 SGT)';
  const queue = await app.get('/api/safety-rereviews').set(auth('venue'));
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  const flag = queue.body.rereviews.find((item: { event_id: number }) => item.event_id === id);
  assert.deepEqual([flag.label, flag.reason, flag.decided_by_name], [label, 'Move the stage away from the fire exit', 'Integration safety officer']);
  assert.equal((await app.get('/api/safety-rereviews').set(auth('support'))).body.rereviews
    .some((item: { event_id: number }) => item.event_id === id), false);
  assert.equal((await app.get('/api/safety-rereviews').set(auth('coordinator'))).status, 403);

  // AC4: the venue cannot be marked done before Venue Staff confirm it again.
  const early = await app.post(`/api/event-requests/${id}/rechecks/safety_venue_recheck/settle`).set(auth('coordinator'));
  assert.deepEqual([early.status, early.body.blockers], [409, [`${label} is waiting for Venue Staff to confirm it again.`]]);
  assert.equal((await app.post(`/api/safety-rereviews/${flag.review_id}/confirm`).set(auth('support'))).status, 403);
  const confirmed = await app.post(`/api/safety-rereviews/${flag.review_id}/confirm`).set(auth('venue'));
  assert.deepEqual([confirmed.status, confirmed.body], [200, { review_id: flag.review_id, event_id: id, status: 'planning',
    outstanding_arrangements: ['safety_other_recheck'] }]);
  assert.equal((await app.post(`/api/safety-rereviews/${flag.review_id}/confirm`).set(auth('venue'))).status, 409);
  const done = await app.post(`/api/event-requests/${id}/rechecks/safety_other_recheck/settle`).set(auth('coordinator'));
  assert.deepEqual([done.status, done.body.outstanding_arrangements], [200, []]);
  event = await stored(id);
  assert.equal(event.status, 'awaiting_safety_check');

  // AC5: the decision and how its flag was resolved are kept for the organiser to read.
  const history = await app.get(`/api/event-requests/${id}/safety-decisions`).set(auth('organiser'));
  assert.deepEqual(history.body.rereviews.map((row: { label: string; resolution: string; resolved_by_name: string }) =>
    [row.label, row.resolution, row.resolved_by_name]), [[label, 'confirmed', 'Integration venue staff']]);
  const audit = await database.from('event_audit_logs').select('field_name,new_value').eq('event_id', id)
    .in('field_name', ['safety_rereview', 'arrangement_recheck']).order('log_id');
  assert.deepEqual(audit.data, [
    { field_name: 'safety_rereview', new_value: `Venue Staff confirmed ${label} again` },
    { field_name: 'arrangement_recheck', new_value: 'safety_venue_recheck settled' },
    { field_name: 'arrangement_recheck', new_value: 'safety_other_recheck settled' }
  ]);
});

test('[NORMAL] [FAILURE] [SG2-59:AC1] [SG2-59:AC2] [SG2-59:AC3] native attendee browsing lists only confirmed events taking registration, with attendee-facing fields, and refuses other roles', async () => {
  const listed = await planned();
  const unconfirmed = await planned();
  await setRegistration(listed);
  await setRegistration(unconfirmed);
  assert.equal((await database.from('events').update({ status: 'confirmed', registration_opens_at: '2026-01-01T00:00:00Z',
    planning_notes: 'Integration internal note' }).eq('event_id', listed)).error, null);
  const attendeeArgs = [...args] as Parameters<typeof createApp>;
  // The reads run registrable_events() with the caller's own JWT, as in production.
  attendeeArgs[40] = createRegistrableEventsRouter(access, token => createRegistrableEventsStore(token, () =>
    createClient(rest.origin, jwt('authenticated', ids[token]), { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: loopbackFetch } })));
  const attendee = request(createApp(...attendeeArgs));
  // Coordinators are refused before and after the account becomes an attendee's.
  assert.equal((await attendee.get('/api/registrable-events').set(auth('other'))).status, 403);
  assert.equal((await database.from('account_roles').update({ role: 'attendee' }).eq('user_id', ids.other)).error, null);
  try {
    const list = await attendee.get('/api/registrable-events').set(auth('other'));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const ours = list.body.events.filter((event: { event_id: number }) => [listed, unconfirmed].includes(event.event_id));
    assert.deepEqual(ours.map((event: { event_id: number }) => event.event_id), [listed]);
    const detail = await attendee.get(`/api/registrable-events/${listed}`).set(auth('other'));
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.deepEqual(Object.keys(detail.body.event).sort(), ['category', 'description', 'event_id', 'name', 'organisation',
      'proposed_date', 'registration_closes_at', 'registration_opens_at', 'venues']);
    assert.equal(detail.body.event.name, 'Integration workshop');
    assert.doesNotMatch(JSON.stringify(detail.body), /Integration internal note|Exercise actual storage|confirmed/);
    assert.equal((await attendee.get(`/api/registrable-events/${unconfirmed}`).set(auth('other'))).status, 404);
  } finally {
    assert.equal((await database.from('account_roles').update({ role: 'event_coordinator' }).eq('user_id', ids.other)).error, null);
  }
  // The database refuses a caller whose stored role is not attendee even if the route let it through.
  const permissive = createAuthorization({ resolvePrincipal: async token => ({ userId: ids[token], roles: ['attendee'] as Role[] }) });
  const forged = request(express().use('/api/registrable-events', createRegistrableEventsRouter(permissive, token =>
    createRegistrableEventsStore(token, () => createClient(rest.origin, jwt('authenticated', ids[token]),
      { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: loopbackFetch } })))));
  assert.equal((await forged.get('/api/registrable-events').set(auth('organiser'))).status, 403);
});

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-63:AC1] [SG2-63:AC2] [SG2-63:AC4] [SG2-63:AC5] [SG2-63:AC6] [SG2-63:AC8] [SG2-63:AC9] [SG2-63:AC10] native registration settings: the organiser changes them with history, closes and reopens with notices, and the coordinator reads the picture', async () => {
  const id = await planned();
  await setRegistration(id);
  // Two active registrations and one cancelled, as SG2-60 and SG2-62 will write them.
  assert.equal((await database.from('registrations').insert([
    { event_id: id, attendee_id: ids.venue, status: 'registered', registered_at: '2089-10-01T14:00:00Z' },
    { event_id: id, attendee_id: ids.support, status: 'registered', registered_at: '2089-10-01T15:00:00Z' },
    { event_id: id, attendee_id: ids.lead, status: 'cancelled', registered_at: '2089-10-01T16:00:00Z' },
  ])).error, null);
  const picture = await api.get(`/api/event-requests/${id}/registrations`).set(auth('coordinator'));
  assert.equal(picture.status, 200, JSON.stringify(picture.body));
  assert.deepEqual([picture.body.registered_count, picture.body.places_remaining, picture.body.can_edit, picture.body.contact_details_visible],
    [2, 134, false, true]);
  assert.deepEqual(picture.body.attendees.map((row: { name: string }) => row.name), ['Integration venue staff', 'Integration support']);
  assert.equal((await api.get(`/api/event-requests/${id}/registrations`).set(auth('other'))).status, 404);
  // AC8: the coordinator cannot change them by either route.
  assert.equal((await api.patch(`/api/event-requests/${id}/registration-settings`).set(auth('coordinator')).send({ registration_capacity: 9 })).status, 403);
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ registration_capacity: 9 })).status, 403);
  // AC9: the organiser's settings are in the history, as them.
  const history = await database.from('event_audit_logs').select('actor_id,field_name,old_value,new_value').eq('event_id', id)
    .in('field_name', ['registration_capacity', 'registration_opens_at', 'registration_closes_at']);
  assert.equal(history.error, null);
  assert.deepEqual(history.data!.map(row => [row.actor_id, row.field_name, row.old_value, row.new_value]).sort(), [
    [ids.organiser, 'registration_capacity', null, '136'],
    [ids.organiser, 'registration_closes_at', null, '2089-10-02T13:30:00.000Z'],
    [ids.organiser, 'registration_opens_at', null, '2089-10-01T13:30:00.000Z'],
  ]);
  // AC6, AC10: once confirmed and open, closing early and reopening each tell the organiser and coordinator.
  assert.equal((await database.from('events').update({ status: 'confirmed', registration_opens_at: '2026-01-01T00:00:00Z' })
    .eq('event_id', id)).error, null);
  const closed = await api.post(`/api/event-requests/${id}/registration-settings/close`).set(auth('organiser'));
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(closed.body.window, 'closed');
  await setRegistration(id, { registration_closes_at: '2089-10-03T13:30:00Z' });
  const notices = await database.from('notifications').select('recipient_id,kind,message').eq('event_id', id)
    .in('kind', ['registration_opened', 'registration_closed']).order('notification_id');
  assert.equal(notices.error, null);
  assert.deepEqual(notices.data!.map(row => [row.recipient_id, row.kind, row.message]), [
    [ids.organiser, 'registration_closed', 'Registration for Integration workshop was closed early by the organiser.'],
    [ids.coordinator, 'registration_closed', 'Registration for Integration workshop was closed early by the organiser.'],
    [ids.organiser, 'registration_opened', 'Registration for Integration workshop is now open.'],
    [ids.coordinator, 'registration_opened', 'Registration for Integration workshop is now open.'],
  ]);
  const again = await api.post(`/api/event-requests/${id}/registration-settings/close`).set(auth('organiser'));
  assert.equal(again.status, 200);
  const twice = await api.post(`/api/event-requests/${id}/registration-settings/close`).set(auth('organiser'));
  assert.deepEqual([twice.status, twice.body.error], [409, 'Registration is not open, so it cannot be closed early.']);
});

test('[NORMAL] [SG2-28:AC1] [SG2-30:AC1] [SG2-87:AC5] [SG2-39:AC1] organiser submission, Lead assignment and planning preserve actual stored values', async () => {
  const id = await planned();
  assert.equal((await api.get('/api/assignment-queue').set(auth('lead'))).body.entries.some((entry: { event_id: number }) => entry.event_id === id), false);
  const registration = { registration_capacity: 136, registration_opens_at: '2089-10-01T13:30:00Z',
    registration_closes_at: '2089-10-01T13:31:00Z' };
  await setRegistration(id, registration);
  const saved = await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ planning_notes: 'Keep the loading bay clear' });
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
  await setRegistration(id, { registration_capacity: 1 });
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ planning_notes: null })).status, 200);
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
  // SG2-63 AC8: registration capacity is refused outright on the coordinator's route.
  assert.equal((await api.patch(`/api/event-requests/${id}/planning`).set(auth('coordinator')).send({ registration_capacity: 0 })).status, 403);
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

test('[CONFLICT] [SG2-69:AC3] [SG2-69:AC7] an organiser notification target follows current organisation while historical read receipts remain owned and idempotent', async () => {
  const originalConfig = { ...dbConfig };
  const originalFetch = globalThis.fetch;
  const organiser = await database.from('users').select('organisation').eq('user_id', ids.organiser).single();
  assert.equal(organiser.error, null);
  const originalOrganisation = organiser.data!.organisation;
  const tokens = Object.fromEntries(['organiser', 'coordinator'].map(who => [who, jwt('authenticated', ids[who])]));
  const callerAccess = createAuthorization({ resolvePrincipal: async token => {
    const who = Object.entries(tokens).find(([, value]) => value === token)?.[0];
    if (!who) throw new AccessError(401);
    const role = await getHeldRoles(database, ids[who]);
    if (!role.ok) throw new AccessError(403);
    return { userId: ids[who], roles: role.roles as Role[] };
  } });
  const callerApi = request(express().use(express.json()).use('/api/notifications', createNotificationsRouter(callerAccess)));
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const eventId = await planned();
  let transport: ReturnType<typeof mock.method> | undefined;
  try {
    const inserted = await database.from('notifications').insert([
      { recipient_id: ids.organiser, event_id: eventId, request_id: null, kind: 'event_approved', message: 'Organisation-scoped organiser approval.', read_at: null },
      { recipient_id: ids.coordinator, event_id: eventId, request_id: null, kind: 'coordinator_assigned', message: 'Separate coordinator receipt.', read_at: null },
    ]).select('notification_id,recipient_id');
    assert.equal(inserted.error, null);
    const ownId = inserted.data!.find(row => row.recipient_id === ids.organiser)!.notification_id;
    const otherId = inserted.data!.find(row => row.recipient_id === ids.coordinator)!.notification_id;
    Object.assign(dbConfig, { supabaseUrl: 'https://notifications-integration.supabase.test', supabaseAnonKey: jwt('anon') });
    transport = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.origin === 'https://notifications-integration.supabase.test') {
        assert.ok(Object.values(tokens).some(token => original.headers.get('authorization') === `Bearer ${token}`), 'Every inbox RPC carries its caller JWT.');
        assert.ok(original.headers.has('x-acting-role'), 'Every inbox RPC carries the validated acting role.');
        url.pathname = url.pathname.slice('/rest/v1'.length); url.protocol = rest.protocol; url.host = rest.host;
      } else assert.equal(url.origin, rest.origin, 'Only disposable loopback database traffic is accepted.');
      return originalFetch(new Request(url, original));
    });
    const target = () => callerApi.get(`/api/notifications/event/${ownId}/event`).set(as('organiser'));
    const initial = await target();
    assert.equal(initial.status, 200, JSON.stringify(initial.body));
    assert.deepEqual(Object.keys(initial.body.event).sort(), ['event_id', 'name', 'proposed_date', 'status']);
    const { proposed_date: proposedDate, ...summary } = initial.body.event;
    assert.deepEqual(summary, { event_id: eventId, name: values.name, status: 'approved' });
    assert.equal(Date.parse(proposedDate), Date.parse(values.proposed_date), 'The minimal target retains the event date instant across PostgreSQL timestamp formatting.');
    assert.equal((await callerApi.get(`/api/notifications/event/${otherId}/event`).set(as('organiser'))).status, 404);
    assert.equal((await callerApi.post(`/api/notifications/event/${otherId}/read`).set(as('organiser'))).status, 404);

    assert.equal((await database.from('users').update({ organisation: 'A different integration organisation' }).eq('user_id', ids.organiser)).error, null);
    assert.equal((await target()).status, 404, 'Current organisation is checked again even when the JWT and historical notice are unchanged.');
    const read = await callerApi.post(`/api/notifications/event/${ownId}/read`).set(as('organiser'));
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.notification.notification_id, ownId);
    assert.equal(read.body.notification.source, 'event');
    assert.ok(Number.isFinite(Date.parse(read.body.notification.read_at)), 'An owned historical notice still receives its read receipt.');
    const repeated = await callerApi.post(`/api/notifications/event/${ownId}/read`).set(as('organiser'));
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.deepEqual(repeated.body, read.body, 'Repeated opening preserves the first read timestamp and unread count.');
    const receipts = await database.from('notifications').select('notification_id,read_at').in('notification_id', [ownId, otherId]);
    assert.equal(receipts.error, null);
    assert.equal(receipts.data!.find(row => row.notification_id === ownId)!.read_at, read.body.notification.read_at);
    assert.equal(receipts.data!.find(row => row.notification_id === otherId)!.read_at, null, 'Denied cross-recipient reads never mark the coordinator notice.');

    assert.equal((await database.from('users').update({ organisation: originalOrganisation }).eq('user_id', ids.organiser)).error, null);
    const restored = await target();
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    assert.deepEqual(restored.body, initial.body, 'Restoring the current organisation restores only the permitted minimal event summary.');
  } finally {
    transport?.mock.restore(); Object.assign(dbConfig, originalConfig);
    const restored = await database.from('users').update({ organisation: originalOrganisation }).eq('user_id', ids.organiser);
    const removed = await database.from('events').delete().eq('event_id', eventId);
    assert.equal(restored.error, null);
    assert.equal(removed.error, null);
  }
});

test('[NORMAL] [FAILURE] [SG2-47:AC3] [SG2-47:AC5] [SG2-66:AC5] native capacity discovery and approval are Venue Staff only, resolve real joins and record approval without deciding the booking', async () => {
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
    // The RPC itself is covered by supabase/tests; here only the API's own capacity check is exercised.
    const decided: number[] = [];
    const venueApi = request(express().use(express.json()).use('/api/venue-booking-requests', createVenueBookingRequestsRouter(access, {
      getAdminClient: () => database,
      decisions: () => ({ decide: async requestId => { decided.push(requestId); return { outcome: 'closed' }; } })
    })));
    const path = '/api/venue-booking-requests/capacity-exceptions';
    assert.equal((await approvals.get(path)).status, 401);
    for (const who of ['coordinator', 'lead', 'other', 'organiser', 'support']) {
      assert.equal((await approvals.get(path).set(auth(who))).status, 403, who);
      const refused = await approvals.post(`/api/venue-booking-requests/${ownRequest}/capacity-exception`).set(auth(who));
      assert.equal(refused.status, 403, who);
    }
    const all = await approvals.get(path).set(auth('venue'));
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.deepEqual(all.body.requests.map((row: { request_id: number }) => row.request_id), [ownRequest, otherRequest]);
    assert.deepEqual(Object.keys(all.body.requests[0]).sort(), [
      'request_id', 'event_id', 'event_name', 'venue_name', 'starts_at', 'ends_at', 'expected_attendance', 'venue_capacity', 'booked'
    ].sort());
    assert.deepEqual([all.body.requests[0].expected_attendance, all.body.requests[0].venue_capacity, all.body.requests[0].booked], [14, 10, false]);

    // The NOT VALID check refuses any new approval not recorded by Venue Staff.
    const legacy = await database.from('venue_capacity_exceptions').insert({ request_id: ownRequest, approved_by: ids.support,
      approver_role: 'technical_support_staff', expected_attendance: 14, venue_capacity: 10 });
    assert.equal(legacy.error?.code, '23514', JSON.stringify(legacy.error));
    const early = await venueApi.post(`/api/venue-booking-requests/${ownRequest}/decision`).set(auth('venue')).send({ decision: 'approve' });
    assert.deepEqual([early.status, early.body], [409, { error: 'Approve a capacity exception for this request before approving the booking.' }]);

    for (const requestId of [ownRequest, otherRequest]) {
      const approved = await approvals.post(`/api/venue-booking-requests/${requestId}/capacity-exception`).set(auth('venue'))
        .send({ approved_by: ids.coordinator, expected_attendance: 1, approver_role: 'event_organiser' });
      assert.equal(approved.status, 201, JSON.stringify(approved.body));
      assert.equal(approved.body.exception.approved_by, ids.venue);
      assert.equal(approved.body.exception.approver_role, 'venue_staff');
      assert.equal(approved.body.exception.expected_attendance, 14);
      assert.equal(approved.body.exception.venue_capacity, 10);
      assert.equal(approved.body.booking, 'allowed');
      const receipt = await approvals.get(`/api/venue-booking-requests/${requestId}/suitability`).set(auth('venue'));
      assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
      assert.deepEqual(receipt.body.exceptions, [approved.body.exception]);
      const pending = await database.from('venue_booking_requests').select('status,venue_booking_id').eq('request_id', requestId).single();
      assert.equal(pending.error, null);
      assert.deepEqual(pending.data, { status: 'pending', venue_booking_id: null });
    }
    assert.deepEqual((await approvals.get(path).set(auth('venue'))).body, { requests: [] });
    // With the Venue Staff exception recorded, the API's capacity check passes and the decision goes on to the RPC step.
    await venueApi.post(`/api/venue-booking-requests/${ownRequest}/decision`).set(auth('venue')).send({ decision: 'approve' });
    assert.deepEqual(decided, [ownRequest]);
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
  assert.equal(history.body.history.length, 11);
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
  assert.equal((await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'))).body.history.length, 11);
  assert.equal((await database.from('events').update({ status: 'needs_clarification' }).eq('event_id', id)).error, null);
  const cleared = { ...edited, description: null, registration_needed: false };
  assert.equal((await api.patch(`/api/event-requests/${id}`).set(auth('organiser')).send(cleared)).status, 200);
  const changed = (await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'))).body.history;
  assert.equal(changed.length, 13);
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
  assert.equal((await api.get(`/api/event-requests/${id}/history`).set(auth('organiser'))).body.history.length, 13);
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


test('[NORMAL] [BOUNDARY] [FAILURE] [SG2-77:AC5] [SG2-77:AC6] [SG2-86:AC2] Safety reads saved venue operations through its actual caller JWT without gaining catalogue, write or history access', async () => {
  const originalConfig = { ...dbConfig };
  const originalFetch = globalThis.fetch;
  const safetyId = ids.other;
  const tokens = { safety: jwt('authenticated', safetyId), venue: jwt('authenticated', ids.venue) };
  const anonKey = jwt('anon');
  const operationAccess = createAuthorization({ resolvePrincipal: async token => {
    const userId = token === tokens.safety ? safetyId : token === tokens.venue ? ids.venue : undefined;
    if (!userId) throw new AccessError(401);
    const role = await getHeldRoles(database, userId);
    if (!role.ok) throw new AccessError(403);
    return { userId, roles: role.roles as Role[] };
  } });
  const operationApi = request(createApp(undefined, operationAccess));
  const venueIds: number[] = [];
  let transport: ReturnType<typeof mock.method> | undefined;
  try {
    assert.equal((await database.from('account_roles').update({ role: 'safety_officer' }).eq('user_id', safetyId)).error, null);
    for (const name of ['Integration operations saved', 'Integration operations default']) {
      const created = await database.from('venues').insert({ name, location: 'Local fixture', capacity: 10,
        facilities: 'Projector', accessibility_features: 'Step-free', operating_information: '09:00-18:00' }).select('venue_id').single();
      assert.equal(created.error, null);
      venueIds.push(created.data!.venue_id);
    }
    const saved = { setup_minutes: 10, turnaround_minutes: 15, emergency_access: 'Integration signed east exit', known_restrictions: 'Integration no open flames' };
    assert.equal((await database.from('venue_operations').insert({ venue_id: venueIds[0], ...saved })).error, null);
    Object.assign(dbConfig, { supabaseUrl: 'https://operations-integration.supabase.test', supabaseAnonKey: anonKey });
    // Keep the production HTTPS-only adapter and caller headers. The sole test
    // transport substitution maps this synthetic gateway to disposable loopback.
    const calls: string[] = [];
    transport = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.origin === 'https://operations-integration.supabase.test') {
        assert.ok(Object.values(tokens).some(token => original.headers.get('authorization') === `Bearer ${token}`));
        assert.equal(original.headers.get('apikey'), anonKey);
        assert.ok(url.pathname.startsWith('/rest/v1/'));
        calls.push(url.pathname);
        url.pathname = url.pathname.slice('/rest/v1'.length);
        url.protocol = rest.protocol;
        url.host = rest.host;
      } else assert.equal(url.origin, rest.origin, 'Only disposable loopback database traffic is accepted.');
      return originalFetch(new Request(url, original));
    });
    const get = (id: number) => operationApi.get(`/api/venues/${id}/operations`).set({ Authorization: `Bearer ${tokens.safety}` });
    const result = await get(venueIds[0]);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.deepEqual(result.body.operations, { ...saved, updated_at: result.body.operations.updated_at });
    assert.ok(Number.isFinite(Date.parse(result.body.operations.updated_at)));
    const defaults = await get(venueIds[1]);
    assert.equal(defaults.status, 200);
    assert.deepEqual(defaults.body.operations, { setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: null, updated_at: null });
    const start = calls.length;
    assert.equal((await get(2147483647)).status, 404);
    assert.deepEqual(calls.slice(start), ['/rest/v1/rpc/venue_exists_for_operations_read']);
    assert.equal((await operationApi.get('/api/venues').set({ Authorization: `Bearer ${tokens.safety}` })).status, 403);
    assert.equal((await operationApi.put(`/api/venues/${venueIds[0]}/operations`).set({ Authorization: `Bearer ${tokens.safety}` }).send({ ...saved, setup_minutes: 1 })).status, 403);
    for (const path of [`/venues?venue_id=eq.${venueIds[0]}&select=venue_id`, `/venue_operation_history?venue_id=eq.${venueIds[0]}&select=history_id`]) {
      const hidden = await fetch(new URL(path, rest), { headers: { Authorization: `Bearer ${tokens.safety}` } });
      assert.equal(hidden.status, 200);
      assert.deepEqual(await hidden.json(), []);
    }
    // Venue Staff still saves through its own base-venue check, and the trigger
    // records its real JWT identity rather than the synthetic fixture owner.
    const beforeSave = calls.length;
    const changed = await operationApi.put(`/api/venues/${venueIds[0]}/operations`).set({ Authorization: `Bearer ${tokens.venue}` }).send({ ...saved, turnaround_minutes: 16 });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.operations.turnaround_minutes, 16);
    assert.deepEqual(calls.slice(beforeSave), ['/rest/v1/venues', '/rest/v1/venue_operations']);
    const history = await database.from('venue_operation_history').select('changed_by,field_name,old_value,new_value').eq('venue_id', venueIds[0]).eq('field_name', 'turnaround_minutes').eq('old_value', '15').eq('new_value', '16');
    assert.equal(history.error, null);
    assert.deepEqual(history.data, [{ changed_by: ids.venue, field_name: 'turnaround_minutes', old_value: '15', new_value: '16' }]);
    assert.equal((await database.from('account_roles').update({ role: 'attendee' }).eq('user_id', safetyId)).error, null);
    assert.equal((await get(venueIds[0])).status, 403, 'A revoked Safety role must lose public API access immediately.');
  } finally {
    transport?.mock.restore();
    Object.assign(dbConfig, originalConfig);
    if (venueIds.length) assert.equal((await database.from('venues').delete().in('venue_id', venueIds)).error, null);
    assert.equal((await database.from('account_roles').update({ role: 'event_coordinator' }).eq('user_id', safetyId)).error, null);
  }
});

test('[NORMAL] [BOUNDARY] [CONFLICT] [FAILURE] [SG2-77:AC6] actual Staff upserts record only persisted venue-operation changes, no-op saves add no history, and concurrent actors retain their exact old/new chain', async () => {
  const originalConfig = { ...dbConfig };
  const originalFetch = globalThis.fetch;
  const tokens = { first: jwt('authenticated', ids.venue), second: jwt('authenticated', ids.other), coordinator: jwt('authenticated', ids.coordinator) };
  const userIds = { first: ids.venue, second: ids.other, coordinator: ids.coordinator };
  const anonKey = jwt('anon');
  const operationAccess = createAuthorization({ resolvePrincipal: async token => {
    const name = (Object.keys(tokens) as (keyof typeof tokens)[]).find(name => tokens[name] === token);
    if (!name) throw new AccessError(401);
    const userId = userIds[name];
    const role = await getHeldRoles(database, userId);
    if (!role.ok) throw new AccessError(403);
    return { userId, roles: role.roles as Role[] };
  } });
  const operationApi = request(createApp(undefined, operationAccess));
  let venueId: number | undefined;
  let transport: ReturnType<typeof mock.method> | undefined;
  try {
    assert.equal((await database.from('account_roles').update({ role: 'venue_staff' }).eq('user_id', ids.other)).error, null);
    const created = await database.from('venues').insert({ name: 'Integration operations exact audit', location: 'Local fixture', capacity: 10,
      facilities: 'Projector', accessibility_features: 'Step-free', operating_information: '09:00-18:00' }).select('venue_id').single();
    assert.equal(created.error, null);
    venueId = created.data!.venue_id;
    Object.assign(dbConfig, { supabaseUrl: 'https://operations-audit-integration.supabase.test', supabaseAnonKey: anonKey });
    transport = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.origin === 'https://operations-audit-integration.supabase.test') {
        assert.ok(Object.values(tokens).some(token => original.headers.get('authorization') === `Bearer ${token}`));
        assert.equal(original.headers.get('apikey'), anonKey);
        assert.ok(url.pathname.startsWith('/rest/v1/'));
        url.pathname = url.pathname.slice('/rest/v1'.length);
        url.protocol = rest.protocol;
        url.host = rest.host;
      } else assert.equal(url.origin, rest.origin, 'Only disposable loopback database traffic is accepted.');
      return originalFetch(new Request(url, original));
    });
    const values = { setup_minutes: 10, turnaround_minutes: 15, emergency_access: null as string | null, known_restrictions: null };
    const save = (who: keyof typeof tokens, body = values) => operationApi.put(`/api/venues/${venueId}/operations`)
      .set({ Authorization: `Bearer ${tokens[who]}` }).send(body);
    const history = async () => {
      const result = await database.from('venue_operation_history').select('history_id,field_name,old_value,new_value,changed_by,changed_at').eq('venue_id', venueId!).order('history_id');
      assert.equal(result.error, null);
      return result.data!;
    };
    const changes = (rows: Awaited<ReturnType<typeof history>>) => rows.map(({ field_name, old_value, new_value, changed_by }) => ({ field_name, old_value, new_value, changed_by }));
    const initial = await save('first');
    assert.equal(initial.status, 200, JSON.stringify(initial.body));
    const firstHistory = await history();
    assert.deepEqual(changes(firstHistory), [
      { field_name: 'setup_minutes', old_value: null, new_value: '10', changed_by: ids.venue },
      { field_name: 'turnaround_minutes', old_value: null, new_value: '15', changed_by: ids.venue }
    ]);
    assert.ok(firstHistory.every(row => Number.isFinite(Date.parse(row.changed_at)) && row.changed_at === initial.body.operations.updated_at));
    values.turnaround_minutes = 16;
    assert.equal((await save('first')).status, 200);
    const afterChange = await history();
    assert.deepEqual(afterChange.slice(0, firstHistory.length), firstHistory, 'Earlier audit rows remain byte-for-byte unchanged.');
    assert.deepEqual(changes(afterChange.slice(firstHistory.length)), [
      { field_name: 'turnaround_minutes', old_value: '15', new_value: '16', changed_by: ids.venue }
    ]);
    assert.equal((await save('first')).status, 200);
    assert.deepEqual(await history(), afterChange, 'An identical public upsert must add zero audit rows.');
    values.emergency_access = 'Use the signed east exit';
    assert.equal((await save('second')).status, 200);
    values.emergency_access = null;
    assert.equal((await save('first')).status, 200);
    const afterClear = await history();
    assert.deepEqual(changes(afterClear.slice(afterChange.length)), [
      { field_name: 'emergency_access', old_value: null, new_value: 'Use the signed east exit', changed_by: ids.other },
      { field_name: 'emergency_access', old_value: 'Use the signed east exit', new_value: null, changed_by: ids.venue }
    ]);
    assert.equal((await save('coordinator', { ...values, turnaround_minutes: 500 })).status, 403);
    assert.equal((await save('first', { ...values, setup_minutes: -1 })).status, 400);
    assert.deepEqual(await history(), afterClear, 'Refused and invalid public saves do not fabricate change history.');
    const parallel = await Promise.all([
      save('first', { ...values, turnaround_minutes: 17 }),
      save('second', { ...values, turnaround_minutes: 18 })
    ]);
    assert.deepEqual(parallel.map(response => response.status), [200, 200]);
    const finalHistory = await history();
    assert.deepEqual(finalHistory.slice(0, afterClear.length), afterClear);
    const chain = finalHistory.slice(afterClear.length);
    assert.equal(chain.length, 2);
    assert.ok(chain.every(row => row.field_name === 'turnaround_minutes' && Number.isFinite(Date.parse(row.changed_at))));
    assert.equal(chain[0].old_value, '16');
    assert.equal(chain[1].old_value, chain[0].new_value);
    assert.deepEqual(chain.map(row => row.new_value).sort(), ['17', '18']);
    for (const row of chain) assert.equal(row.changed_by, row.new_value === '17' ? ids.venue : ids.other);
    const final = await database.from('venue_operations').select('*').eq('venue_id', venueId!).single();
    assert.equal(final.error, null);
    assert.equal(String(final.data!.turnaround_minutes), chain[1].new_value);
    assert.equal(final.data!.updated_by, chain[1].changed_by);
    assert.equal(final.data!.updated_at, chain[1].changed_at);
    assert.equal(final.data!.emergency_access, null);
  } finally {
    transport?.mock.restore();
    Object.assign(dbConfig, originalConfig);
    if (venueId !== undefined) assert.equal((await database.from('venues').delete().eq('venue_id', venueId)).error, null);
    assert.equal((await database.from('account_roles').update({ role: 'event_coordinator' }).eq('user_id', ids.other)).error, null);
  }
});

test('[NORMAL] [CONFLICT] [FAILURE] [SG2-106:AC1] [SG2-106:AC2] [SG2-106:AC3] [SG2-106:AC4] [SG2-106:AC5] native venue delete and hold expiry change go through the caller JWT, refuse live work and record who and when', async () => {
  const originalConfig = { ...dbConfig };
  const originalFetch = globalThis.fetch;
  const tokens = { venue: jwt('authenticated', ids.venue), coordinator: jwt('authenticated', ids.coordinator) };
  const anonKey = jwt('anon');
  const callerAccess = createAuthorization({ resolvePrincipal: async token => {
    const userId = token === tokens.venue ? ids.venue : token === tokens.coordinator ? ids.coordinator : undefined;
    if (!userId) throw new AccessError(401);
    const role = await getHeldRoles(database, userId);
    if (!role.ok) throw new AccessError(403);
    return { userId, roles: role.roles as Role[] };
  } });
  const callerApi = request(createApp(undefined, callerAccess));
  const as = (who: keyof typeof tokens) => ({ Authorization: `Bearer ${tokens[who]}` });
  const venueIds: number[] = [];
  let transport: ReturnType<typeof mock.method> | undefined;
  try {
    for (const name of ['Integration delete unused', 'Integration delete held']) {
      const created = await database.from('venues').insert({ name, location: 'Local fixture', capacity: 500,
        facilities: 'Projector', accessibility_features: 'Step-free', operating_information: '09:00-18:00' }).select('venue_id').single();
      assert.equal(created.error, null);
      venueIds.push(created.data!.venue_id);
    }
    const [unused, held] = venueIds;
    const eventId = await planned();
    Object.assign(dbConfig, { supabaseUrl: 'https://venue-delete-integration.supabase.test', supabaseAnonKey: anonKey });
    // Production HTTPS adapters and caller headers; only this synthetic gateway
    // is mapped to the disposable loopback PostgREST.
    transport = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.origin === 'https://venue-delete-integration.supabase.test') {
        assert.ok(Object.values(tokens).some(token => original.headers.get('authorization') === `Bearer ${token}`));
        url.pathname = url.pathname.slice('/rest/v1'.length);
        url.protocol = rest.protocol;
        url.host = rest.host;
      } else assert.equal(url.origin, rest.origin, 'Only disposable loopback database traffic is accepted.');
      return originalFetch(new Request(url, original));
    });

    const placed = await callerApi.post('/api/venue-holds').set(as('venue')).send({ event_id: eventId, venue_id: held,
      starts_at: '2090-07-01T02:00:00.000Z', ends_at: '2090-07-01T04:00:00.000Z', expires_at: '2090-06-20T02:00:00.000Z' });
    assert.equal(placed.status, 201, JSON.stringify(placed.body));
    const holdId = placed.body.hold.hold_id as number;

    // AC1: live work blocks the delete and is listed.
    const blocked = await callerApi.delete(`/api/venues/${held}`).set(as('venue'));
    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.deepEqual(blocked.body.blockers.map((item: { kind: string; id: number }) => [item.kind, item.id]), [['hold', holdId]]);
    // AC5: only Venue Staff, and deleted_at cannot be written directly.
    assert.equal((await callerApi.delete(`/api/venues/${unused}`).set(as('coordinator'))).status, 403);
    const direct = await originalFetch(new URL(`/venues?venue_id=eq.${unused}`, rest), { method: 'PATCH',
      headers: { Authorization: `Bearer ${tokens.venue}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
    assert.ok([401, 403].includes(direct.status), `direct deleted_at write returned ${direct.status}`);
    // AC1/AC5: an unused venue is deleted with who and when.
    const deleted = await callerApi.delete(`/api/venues/${unused}`).set(as('venue'));
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.venue.deleted_by, ids.venue);
    assert.ok(Number.isFinite(Date.parse(deleted.body.venue.deleted_at)));
    assert.equal((await callerApi.delete(`/api/venues/${unused}`).set(as('venue'))).status, 404);
    // AC2: gone from the catalogue and hold choices, but the row and name stay.
    const listed = await callerApi.get('/api/venues').set(as('venue'));
    assert.equal(listed.status, 200);
    assert.ok(!listed.body.venues.some((venue: { venue_id: number }) => venue.venue_id === unused));
    assert.ok(listed.body.venues.some((venue: { venue_id: number }) => venue.venue_id === held));
    const choices = await callerApi.get('/api/venue-holds/options').set(as('venue'));
    assert.ok(!choices.body.venues.some((venue: { venue_id: number }) => venue.venue_id === unused));
    assert.equal((await callerApi.post('/api/venue-holds').set(as('venue')).send({ event_id: eventId, venue_id: unused,
      starts_at: '2090-08-01T02:00:00.000Z', ends_at: '2090-08-01T04:00:00.000Z', expires_at: '2090-06-20T02:00:00.000Z' })).status, 404);
    assert.equal((await database.from('venues').select('name').eq('venue_id', unused).single()).data!.name, 'Integration delete unused');

    // AC3/AC4/AC5: expiry change, coordinator notice and audit.
    assert.equal((await callerApi.post(`/api/venue-holds/${holdId}/expiry`).set(as('coordinator')).send({ expires_at: '2090-06-25T02:00:00Z' })).status, 403);
    assert.equal((await callerApi.post(`/api/venue-holds/${holdId}/expiry`).set(as('venue')).send({ expires_at: '2020-01-01T00:00:00Z' })).status, 400);
    const moved = await callerApi.post(`/api/venue-holds/${holdId}/expiry`).set(as('venue')).send({ expires_at: '2090-06-25T10:00:00+08:00' });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(Date.parse(moved.body.hold.expires_at), Date.parse('2090-06-25T02:00:00.000Z'));
    assert.equal((await callerApi.post(`/api/venue-holds/${holdId}/expiry`).set(as('venue')).send({ expires_at: '2090-06-25T02:00:00Z' })).status, 400);
    const notices = await callerApi.get('/api/venue-holds/notifications').set(as('coordinator'));
    assert.equal(notices.status, 200);
    const changed = notices.body.notifications.filter((notice: { hold_id: number; kind: string }) => notice.hold_id === holdId && notice.kind === 'expiry_changed');
    assert.equal(changed.length, 1);
    assert.match(changed[0].message, /2090-06-25T02:00:00Z/);
    const audit = await database.from('event_audit_logs').select('actor_id,old_value,new_value').eq('event_id', eventId).eq('field_name', 'venue_hold_expiry');
    assert.equal(audit.error, null);
    assert.deepEqual(audit.data, [{ actor_id: ids.venue, old_value: `Hold ${holdId} expires 2090-06-20T02:00:00Z`, new_value: `Hold ${holdId} expires 2090-06-25T02:00:00Z` }]);
    // AC3: a released hold cannot be changed.
    assert.equal((await callerApi.post(`/api/venue-holds/${holdId}/release`).set(as('venue'))).status, 200);
    assert.equal((await callerApi.post(`/api/venue-holds/${holdId}/expiry`).set(as('venue')).send({ expires_at: '2090-06-26T02:00:00Z' })).status, 409);
  } finally {
    transport?.mock.restore();
    Object.assign(dbConfig, originalConfig);
    if (venueIds.length) {
      assert.equal((await database.from('venue_holds').delete().in('venue_id', venueIds)).error, null);
      assert.equal((await database.from('venue_booking_requests').delete().in('venue_id', venueIds)).error, null);
      assert.equal((await database.from('venues').delete().in('venue_id', venueIds)).error, null);
    }
  }
});

test('[NORMAL] [SG2-69:AC1] [SG2-69:AC2] [SG2-69:AC3] [SG2-69:AC4] [SG2-69:AC5] [SG2-69:AC6] [SG2-69:AC7] native inbox pages both notice sources, counts all unread rows, marks only owned identities and delivers coordinator-only reminders', async () => {
  const originalConfig = { ...dbConfig };
  const originalFetch = globalThis.fetch;
  const tokens = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, jwt('authenticated', id)]));
  const callerAccess = createAuthorization({ resolvePrincipal: async token => {
    const who = Object.entries(tokens).find(([, value]) => value === token)?.[0];
    if (!who) throw new AccessError(401);
    const role = await getHeldRoles(database, ids[who]);
    if (!role.ok) throw new AccessError(403);
    return { userId: ids[who], roles: role.roles as Role[] };
  } });
  // The unmodified production factory builds a fresh user-scoped DB adapter.
  const callerApi = request(express().use(express.json()).use('/api/notifications', createNotificationsRouter(callerAccess)));
  const holdingApi = request(createApp(undefined, callerAccess));
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const eventId = await planned();
  let venueId: number | undefined;
  let transport: ReturnType<typeof mock.method> | undefined;
  try {
    // SQL suites share this disposable DB in CI. Their rolled-back inserts
    // still advance identity sequences, so no global venue ID is a fixture.
    const venue = await database.from('venues').insert({ name: 'Integration SG2-69 inbox venue', capacity: 200 })
      .select('venue_id').single();
    assert.equal(venue.error, null);
    venueId = venue.data!.venue_id;
    Object.assign(dbConfig, { supabaseUrl: 'https://notifications-integration.supabase.test', supabaseAnonKey: jwt('anon') });
    transport = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.origin === 'https://notifications-integration.supabase.test') {
        assert.ok(Object.values(tokens).some(token => original.headers.get('authorization') === `Bearer ${token}`), 'Every inbox RPC carries its caller JWT.');
        assert.ok(original.headers.has('x-acting-role'), 'Every inbox RPC carries the validated acting role.');
        url.pathname = url.pathname.slice('/rest/v1'.length); url.protocol = rest.protocol; url.host = rest.host;
      } else assert.equal(url.origin, rest.origin, 'Only disposable loopback database traffic is accepted.');
      return originalFetch(new Request(url, original));
    });
    const held = await holdingApi.post('/api/venue-holds').set(as('venue')).send({ event_id: eventId, venue_id: venueId,
      starts_at: '2099-07-03T02:00:00Z', ends_at: '2099-07-03T04:00:00Z', expires_at: '2098-06-20T02:00:00Z' });
    assert.equal(held.status, 201, JSON.stringify(held.body));
    const cleared = await callerApi.post('/api/notifications/read-all').set(as('coordinator'));
    assert.deepEqual([cleared.status, cleared.body], [200, { unread_count: 0 }]);
    const sameInstant = '2099-01-01T00:00:00.123456Z';
    const inserted = await database.from('notifications').insert(Array.from({ length: 53 }, (_, i) => ({
      recipient_id: ids.coordinator, event_id: eventId, request_id: null, kind: 'coordinator_assigned',
      message: `Integration SG2-69 page ${i}`, created_at: sameInstant
    }))).select('notification_id');
    assert.equal(inserted.error, null);
    const heldNotice = await database.from('venue_hold_notifications').insert({ recipient_id: ids.coordinator,
      event_id: eventId, hold_id: held.body.hold.hold_id, kind: 'warning', message: 'Integration hold reminder', created_at: sameInstant }).select('notification_id').single();
    assert.equal(heldNotice.error, null);
    const first = await callerApi.get('/api/notifications/inbox').set(as('coordinator'));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.headers['cache-control'], 'no-store');
    assert.equal(first.body.unread_count, 54, 'Unread count includes notices beyond page 50.');
    assert.equal(first.body.notifications.length, 50);
    assert.deepEqual([first.body.notifications[0].source, first.body.notifications[0].notification_id], ['hold', heldNotice.data!.notification_id]);
    const next = first.body.next_cursor;
    assert.ok(next);
    const second = await callerApi.get('/api/notifications/inbox').query({ before_created_at: next.created_at, before_source: next.source, before_id: next.notification_id }).set(as('coordinator'));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.unread_count, 54);
    const combined = [...first.body.notifications, ...second.body.notifications].slice(0, 54);
    assert.equal(new Set(combined.map(n => `${n.source}:${n.notification_id}`)).size, 54, 'Microsecond cursor does not repeat a row.');
    assert.deepEqual(combined.filter(n => n.source === 'event').map(n => n.notification_id), inserted.data!.map(n => n.notification_id).sort((a, b) => b - a));
    assert.ok(combined.every(n => n.read_at === null));
    const selectedId = inserted.data![0].notification_id;
    const opened = await callerApi.post(`/api/notifications/event/${selectedId}/read`).set(as('coordinator'));
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.unread_count, 53);
    assert.ok(Number.isFinite(Date.parse(opened.body.notification.read_at)));
    const repeated = await callerApi.post(`/api/notifications/event/${selectedId}/read`).set(as('coordinator'));
    assert.deepEqual(repeated.body, opened.body, 'Opening twice preserves the original read time and count.');
    const target = await callerApi.get(`/api/notifications/event/${selectedId}/event`).set(as('coordinator'));
    assert.equal(target.status, 200, JSON.stringify(target.body));
    assert.deepEqual(Object.keys(target.body.event).sort(), ['event_id', 'name', 'proposed_date', 'status']);
    assert.equal(target.body.event.event_id, eventId);
    for (const who of ['other', 'organiser', 'support', 'safety']) {
      assert.equal((await callerApi.post(`/api/notifications/event/${selectedId}/read`).set(as(who))).status, 404);
      assert.equal((await callerApi.get(`/api/notifications/event/${selectedId}/event`).set(as(who))).status, 404);
    }
    assert.deepEqual((await callerApi.get('/api/notifications/reminder-preferences').set(as('coordinator'))).body, { frequency_days: 1 });
    assert.deepEqual((await callerApi.put('/api/notifications/reminder-preferences').set(as('coordinator')).send({ frequency_days: 2 })).body, { frequency_days: 2 });
    assert.deepEqual((await callerApi.get('/api/notifications/reminder-preferences').set(as('coordinator'))).body, { frequency_days: 2 });
    assert.equal((await callerApi.put('/api/notifications/reminder-preferences').set(as('support')).send({ frequency_days: 2 })).status, 403);
    const directScheduler = await originalFetch(new URL('/rpc/send_outstanding_arrangement_reminders', rest), { method: 'POST', headers: {
      Authorization: `Bearer ${tokens.coordinator}`, 'Content-Type': 'application/json' }, body: '{}' });
    assert.ok([401, 403].includes(directScheduler.status), `Coordinator scheduler status ${directScheduler.status}`);
    const sent = await database.rpc('send_outstanding_arrangement_reminders');
    assert.equal(sent.error, null);
    const reminders = await database.from('notifications').select('recipient_id,message').eq('event_id', eventId).eq('kind', 'outstanding_arrangements');
    assert.equal(reminders.error, null);
    assert.equal(reminders.data!.length, 1);
    assert.equal(reminders.data![0].recipient_id, ids.coordinator);
    assert.match(reminders.data![0].message, /venue/i);
    assert.match(reminders.data![0].message, /registration/i);
    assert.equal((await database.rpc('send_outstanding_arrangement_reminders')).error, null);
    const duplicate = await database.from('notifications').select('notification_id').eq('event_id', eventId).eq('kind', 'outstanding_arrangements');
    assert.equal(duplicate.data!.length, 1, 'An immediate second sweep cannot duplicate the reminder.');
    assert.deepEqual((await callerApi.post('/api/notifications/read-all').set(as('coordinator'))).body, { unread_count: 0 });
    assert.equal((await callerApi.get('/api/notifications/inbox').set(as('coordinator'))).body.unread_count, 0);
    assert.equal((await database.from('events').update({ coordinator_id: ids.other }).eq('event_id', eventId)).error, null);
    assert.equal((await callerApi.get(`/api/notifications/event/${selectedId}/event`).set(as('coordinator'))).status, 404, 'Reassignment revokes the old coordinator event target.');
    assert.equal((await callerApi.post(`/api/notifications/event/${selectedId}/read`).set(as('coordinator'))).status, 200, 'Historical owned notices remain readable.');
  } finally {
    transport?.mock.restore(); Object.assign(dbConfig, originalConfig);
    assert.equal((await database.from('events').delete().eq('event_id', eventId)).error, null);
    if (venueId !== undefined) assert.equal((await database.from('venues').delete().eq('venue_id', venueId)).error, null);
  }
});

test('[CONFLICT] [SG2-69:AC3] [SG2-69:AC6] [SG2-69:AC7] [SG2-104:AC2] native notification targets and cadence follow the acting role while historical ownership survives a role switch or revocation', async () => {
  const originalConfig = { ...dbConfig };
  const originalFetch = globalThis.fetch;
  const eventId = await planned();
  const token = jwt('authenticated', ids.coordinator);
  const anonKey = jwt('anon');
  const callerAccess = createAuthorization({ resolvePrincipal: async presented => {
    if (presented !== token) throw new AccessError(401);
    const held = await getHeldRoles(database, ids.coordinator);
    if (!held.ok) throw new AccessError(403);
    return { userId: ids.coordinator, roles: held.roles as Role[] };
  } });
  const callerApi = request(express().use(express.json()).use('/api/notifications', createNotificationsRouter(callerAccess)));
  const as = (role?: Role) => ({ Authorization: `Bearer ${token}`, ...(role ? { 'X-Acting-Role': role } : {}) });
  const rpcRoles: { path: string; role: string | null }[] = [];
  let transport: ReturnType<typeof mock.method> | undefined;
  let coordinatorRevoked = false;
  try {
    const inserted = await database.from('notifications').insert({ recipient_id: ids.coordinator, event_id: eventId,
      request_id: null, kind: 'coordinator_assigned', message: 'One identity with separate acting roles.', read_at: null })
      .select('notification_id').single();
    assert.equal(inserted.error, null);
    const noticeId = inserted.data!.notification_id;
    assert.equal((await database.from('account_roles').insert({ user_id: ids.coordinator, role: 'attendee' })).error, null);
    Object.assign(dbConfig, { supabaseUrl: 'https://multi-role-notifications-integration.supabase.test', supabaseAnonKey: anonKey });
    transport = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.origin === 'https://multi-role-notifications-integration.supabase.test') {
        assert.equal(original.headers.get('authorization'), `Bearer ${token}`, 'Notification RPCs keep the authenticated user JWT.');
        assert.equal(original.headers.get('apikey'), anonKey);
        rpcRoles.push({ path: url.pathname, role: original.headers.get('x-acting-role') });
        url.pathname = url.pathname.slice('/rest/v1'.length); url.protocol = rest.protocol; url.host = rest.host;
      } else assert.equal(url.origin, rest.origin, 'Only disposable loopback database traffic is accepted.');
      return originalFetch(new Request(url, original));
    });
    const target = (role?: Role) => callerApi.get(`/api/notifications/event/${noticeId}/event`).set(as(role));
    assert.equal((await callerApi.get('/api/notifications/inbox').set(as())).status, 200);
    assert.equal((await target()).status, 404, 'The least-privileged attendee default cannot borrow its held coordinator relationship.');
    assert.equal((await target('event_coordinator')).status, 200);
    assert.deepEqual(rpcRoles.filter(call => call.path.endsWith('/notification_event')).map(call => call.role), ['attendee', 'event_coordinator']);
    assert.equal((await callerApi.get('/api/notifications/reminder-preferences').set(as())).status, 403);
    assert.equal((await callerApi.get('/api/notifications/reminder-preferences').set(as('event_coordinator'))).status, 200);
    const callsBeforeDenied = rpcRoles.length;
    assert.equal((await callerApi.put('/api/notifications/reminder-preferences').set(as('attendee')).send({ frequency_days: 3 })).status, 403);
    assert.equal((await target('venue_staff')).status, 403, 'An unheld acting role is refused before storage.');
    assert.equal(rpcRoles.length, callsBeforeDenied);
    const directDenied = await originalFetch(new URL('/rpc/set_notification_reminder_preferences', rest), { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-Acting-Role': 'attendee', 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_frequency_days: 3 }) });
    assert.equal(directDenied.status, 403, 'SQL also refuses cadence writes under a held role other than coordinator.');
    const firstRead = await callerApi.post(`/api/notifications/event/${noticeId}/read`).set(as('attendee'));
    assert.equal(firstRead.status, 200);
    assert.ok(Number.isFinite(Date.parse(firstRead.body.notification.read_at)));
    assert.equal((await database.from('account_roles').delete().eq('user_id', ids.coordinator).eq('role', 'event_coordinator')).error, null);
    coordinatorRevoked = true;
    const callsBeforeRevoked = rpcRoles.length;
    assert.equal((await target('event_coordinator')).status, 403, 'A revoked acting role is checked again on the next request.');
    assert.equal(rpcRoles.length, callsBeforeRevoked);
    assert.equal((await target()).status, 404);
    const repeated = await callerApi.post(`/api/notifications/event/${noticeId}/read`).set(as());
    assert.equal(repeated.status, 200, 'Recipient ownership still permits reading a historical notice.');
    assert.deepEqual(repeated.body, firstRead.body, 'A role change does not alter the original receipt or duplicate it.');
    assert.ok(rpcRoles.every(call => call.role === 'attendee' || call.role === 'event_coordinator'));
  } finally {
    transport?.mock.restore(); Object.assign(dbConfig, originalConfig);
    if (coordinatorRevoked) assert.equal((await database.from('account_roles').insert({ user_id: ids.coordinator, role: 'event_coordinator' })).error, null);
    assert.equal((await database.from('account_roles').delete().eq('user_id', ids.coordinator).eq('role', 'attendee')).error, null);
    assert.equal((await database.from('events').delete().eq('event_id', eventId)).error, null);
  }
});

// SG2-96: one event through the whole Week 7 flow on the production wiring.
// Every step is an API call by the role that owns it, with that role's own JWT.
// No status is written directly: the move into Awaiting Safety Check is
// refresh_safety_check_status() reacting to the last arrangement. This test
// stays last in the file because it configures the production Supabase
// clients, which cache at module level.
test('[NORMAL] [FAILURE] [SG2-30:AC1] [SG2-87:AC1] [SG2-88:AC1] [SG2-37:AC1] [SG2-82:AC1] [SG2-49:AC1] [SG2-53:AC6] [SG2-55:AC1] [SG2-91:AC1] [SG2-92:AC3] [SG2-94:AC5] [SG2-58:AC1] [SG2-100:AC1] [SG2-100:AC2] native Week 7 flow: submit, Lead assigns, two venues and equipment confirmed, safety check, Preparation, Confirmed', async () => {
  const originalConfig = { ...dbConfig };
  const originalFetch = globalThis.fetch;
  const gateway = 'https://week7-flow.supabase.test';
  const actors = ['organiser', 'lead', 'coordinator', 'venue', 'support', 'safety'] as const;
  const tokens = Object.fromEntries(actors.map(who => [who, jwt('authenticated', ids[who])])) as Record<typeof actors[number], string>;
  const serviceKey = jwt('service_role');
  const flowAccess = createAuthorization({ resolvePrincipal: async token => {
    const who = actors.find(name => tokens[name] === token);
    if (!who) throw new AccessError(401);
    const held = await getHeldRoles(database, ids[who]);
    if (!held.ok) throw new AccessError(403);
    return { userId: ids[who], roles: held.roles as Role[] };
  } });
  const as = (who: typeof actors[number]) => ({ Authorization: `Bearer ${tokens[who]}` });
  const venueIds: number[] = [];
  let equipmentId: number | undefined;
  let eventId: number | undefined;
  let transport: ReturnType<typeof mock.method> | undefined;
  try {
    for (const name of ['Week 7 flow auditorium', 'Week 7 flow breakout']) {
      const created = await database.from('venues').insert({ name, location: 'Local fixture', capacity: 300,
        facilities: 'Seating, projector', accessibility_features: 'Step-free', operating_information: '08:00-22:00' }).select('venue_id').single();
      assert.equal(created.error, null);
      venueIds.push(created.data!.venue_id);
      assert.equal((await database.from('venue_layouts').insert({ venue_id: created.data!.venue_id, layout: 'classroom' })).error, null);
    }
    const equipment = await database.from('equipment').insert({ name: 'Week 7 flow projector', quantity_total: 10 }).select('equipment_id').single();
    assert.equal(equipment.error, null);
    equipmentId = equipment.data!.equipment_id;

    // The production adapters, with every Supabase URL mapped to the disposable PostgREST.
    Object.assign(dbConfig, { supabaseUrl: gateway, supabaseAnonKey: jwt('anon'), supabaseServiceRoleKey: serviceKey });
    transport = mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const original = new Request(input, init);
      const url = new URL(original.url);
      if (url.hostname.endsWith('.supabase.test')) {
        const bearer = original.headers.get('authorization');
        assert.ok([serviceKey, ...Object.values(tokens)].some(token => bearer === `Bearer ${token}`), 'Only the flow callers or the service role reach the database.');
        url.pathname = url.pathname.slice('/rest/v1'.length);
        url.protocol = rest.protocol;
        url.host = rest.host;
      } else assert.equal(url.origin, rest.origin, 'Only disposable loopback database traffic is accepted.');
      return originalFetch(new Request(url, original));
    });
    const flow = request(createApp(undefined, flowAccess));
    const status = async () => (await stored(eventId!)).status;
    const period = { starts_at: '2090-06-15T02:00:00.000Z', ends_at: '2090-06-15T04:00:00.000Z' };

    // 1. The organiser submits a complete request; it waits for the Lead, unassigned.
    const created = await flow.post('/api/event-requests').set(as('organiser')).send({ ...values, name: 'Week 7 flow conference' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    eventId = created.body.request.event_id as number;
    const registration = await flow.patch(`/api/event-requests/${eventId}/registration-settings`).set(as('organiser')).send({
      registration_capacity: 136, registration_opens_at: '2089-10-01T13:30:00Z', registration_closes_at: '2089-10-02T13:30:00Z' });
    assert.equal(registration.status, 200, JSON.stringify(registration.body));
    const submitted = await flow.patch(`/api/event-requests/${eventId}/submit`).set(as('organiser')).send({});
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    assert.equal(await status(), 'unassigned');

    // 2. The Lead finds it in the unassigned queue and assigns a coordinator.
    const queue = await flow.get('/api/assignment-queue').set(as('lead'));
    assert.equal(queue.status, 200, JSON.stringify(queue.body));
    assert.ok(JSON.stringify(queue.body).includes('"Week 7 flow conference"'), 'The submitted event is in the Lead queue.');
    const assigned = await flow.patch(`/api/event-requests/${eventId}/coordinator`).set(as('lead')).send({ coordinatorId: ids.coordinator });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
    assert.equal(await status(), 'submitted');

    // 3. The coordinator reviews and approves it.
    assert.equal((await flow.patch(`/api/event-requests/${eventId}/review`).set(as('coordinator')).send({})).status, 200);
    const approved = await flow.patch(`/api/event-requests/${eventId}/decision`).set(as('coordinator')).send({ decision: 'approved' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(await status(), 'approved');

    // 4. Two venues and the equipment are requested; support places and reserves the equipment.
    const venueRequests: number[] = [];
    for (const venueId of venueIds) {
      const requested: { status: number; body: unknown } = await flow.post('/api/venue-booking-requests').set(as('coordinator')).send({ event_id: eventId, venue_id: venueId, layout: 'classroom', ...period });
      assert.equal(requested.status, 201, JSON.stringify(requested.body));
    }
    const asked = await database.from('venue_booking_requests').select('request_id,venue_id').eq('event_id', eventId).order('request_id');
    assert.equal(asked.error, null);
    venueRequests.push(...asked.data!.map(row => row.request_id as number));
    assert.deepEqual(asked.data!.map(row => row.venue_id), venueIds);
    const needed = await flow.post('/api/equipment-requests').set(as('coordinator')).send({ event_id: eventId, equipment_id: equipmentId, quantity: 2 });
    assert.equal(needed.status, 201, JSON.stringify(needed.body));
    const row = await database.from('equipment_requests').select('request_id,version').eq('event_id', eventId).single();
    assert.equal(row.error, null);
    const equipmentRequestId = row.data!.request_id as number;
    const version = row.data!.version as number;
    const placed = await flow.patch(`/api/equipment-requests/${equipmentRequestId}/arrangement`).set(as('support')).send({ event_id: eventId, version,
      arrangement_notes: 'Ceiling projector on the main stage.', shortfall: 0, placement_venue_id: venueIds[0], placement_position: 'Main stage' });
    assert.equal(placed.status, 200, JSON.stringify(placed.body));
    const reserved = await flow.post(`/api/equipment-requests/${equipmentRequestId}/reservation`).set(as('support')).send({ event_id: eventId,
      version: (await database.from('equipment_requests').select('version').eq('request_id', equipmentRequestId).single()).data!.version, ...period });
    assert.ok([200, 201].includes(reserved.status), JSON.stringify(reserved.body));
    assert.equal(await status(), 'approved', 'Venues are still pending, so the event is not ready for its safety check.');

    // 5. Venue Staff approve both venues; the last approval makes every arrangement
    //    ready, and the database moves the event into Awaiting Safety Check by itself.
    const firstDecision = await flow.post(`/api/venue-booking-requests/${venueRequests[0]}/decision`).set(as('venue')).send({ decision: 'approve' });
    assert.equal(firstDecision.status, 200, JSON.stringify(firstDecision.body));
    assert.equal(await status(), 'approved', 'One venue is still pending.');
    const secondDecision = await flow.post(`/api/venue-booking-requests/${venueRequests[1]}/decision`).set(as('venue')).send({ decision: 'approve' });
    assert.equal(secondDecision.status, 200, JSON.stringify(secondDecision.body));
    assert.equal(await status(), 'awaiting_safety_check');

    // [FAILURE] Confirmation is refused while the safety check is outstanding.
    const early = await flow.patch(`/api/event-requests/${eventId}/confirm`).set(as('coordinator')).send({});
    assert.equal(early.status, 409, JSON.stringify(early.body));
    assert.equal(await status(), 'awaiting_safety_check');

    // 6. The Safety Officer finds it on the list and approves it; the event moves into Preparation.
    const checks = await flow.get('/api/safety-checks').set(as('safety'));
    assert.equal(checks.status, 200, JSON.stringify(checks.body));
    const listed = checks.body.events.find((row: { event_id: number }) => row.event_id === eventId);
    assert.ok(listed, 'The event is on the Safety Officer list.');
    const decided = await flow.post(`/api/event-requests/${eventId}/safety-decision`).set(as('safety'))
      .send({ decision: 'approve', reason: 'Exits and aisles are clear.', safety_check_revision: listed.safety_check_revision });
    assert.equal(decided.status, 201, JSON.stringify(decided.body));
    assert.equal(await status(), 'preparation');

    // 7. The coordinator confirms it; the organiser sees the confirmed arrangements.
    const confirmed = await flow.patch(`/api/event-requests/${eventId}/confirm`).set(as('coordinator')).send({});
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(await status(), 'confirmed');
    const summary = await flow.get(`/api/event-requests/${eventId}/confirmation`).set(as('organiser'));
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    const shown = JSON.stringify(summary.body);
    for (const name of ['Week 7 flow auditorium', 'Week 7 flow breakout', 'Week 7 flow projector']) assert.ok(shown.includes(name), `confirmation shows ${name}`);

    // The history holds each step in order, and the organiser was told along the way.
    const steps = await database.from('event_audit_logs').select('old_value,new_value').eq('event_id', eventId).eq('field_name', 'status').order('log_id');
    assert.equal(steps.error, null);
    assert.deepEqual(steps.data!.map(row => row.new_value), ['unassigned', 'submitted', 'under_review', 'approved', 'awaiting_safety_check', 'preparation', 'confirmed']);
    const told = await database.from('notifications').select('kind').eq('event_id', eventId).eq('recipient_id', ids.organiser);
    assert.equal(told.error, null);
    const kinds = new Set(told.data!.map(row => row.kind));
    for (const kind of ['coordinator_assigned', 'event_approved', 'safety_decision', 'event_confirmed']) assert.ok(kinds.has(kind), `organiser told: ${kind}`);
  } finally {
    transport?.mock.restore();
    Object.assign(dbConfig, originalConfig);
    if (eventId !== undefined) assert.equal((await database.from('events').delete().eq('event_id', eventId)).error, null);
    if (equipmentId !== undefined) assert.equal((await database.from('equipment').delete().eq('equipment_id', equipmentId)).error, null);
    if (venueIds.length) assert.equal((await database.from('venues').delete().in('venue_id', venueIds)).error, null);
  }
});
