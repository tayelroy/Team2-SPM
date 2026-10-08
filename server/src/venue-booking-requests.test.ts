import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, AccessError, type Role } from './auth';
import { dbConfig } from './db';
import type { CapacityExceptionRecord, SuitabilityEventRow, SuitabilityVenueRow } from './db/venueSuitability';
import type { NewVenueBookingRequest, VenueBookingRequestRecord, VenueBookingRequestStore } from './db/venueBookingRequests';
import type { ConflictOptions, ConflictPeriod, VenueConflictRow } from './db/venueConflicts';
import type { Layout } from './venues/layoutFields';
import { validateVenueBookingRequest } from './venues/bookingRequestFields';
import { createVenueBookingRequestsRouter, type VenueBookingRequestDependencies } from './venues/bookingRequests';
import type { Decision, DecisionResult, VenueBookingDecisionStore } from './db/venueBookingDecisions';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const NOW = Date.parse('2030-01-01T00:00:00.000Z');

const USERS: Record<string, { userId: string; role: Role }> = {
  coordinator: { userId: 'user-coordinator', role: 'event_coordinator' },
  other_coordinator: { userId: 'user-other-coordinator', role: 'event_coordinator' },
  organiser: { userId: 'user-organiser', role: 'event_organiser' },
  venue: { userId: 'user-venue', role: 'venue_staff' },
  support: { userId: 'user-support', role: 'technical_support_staff' },
  attendee: { userId: 'user-attendee', role: 'attendee' }
};

const forum: SuitabilityEventRow = {
  event_id: 7, name: 'Leadership Forum', organiser_id: 'user-organiser', coordinator_id: 'user-coordinator',
  status: 'approved', expected_attendance: 150, venue_requirements: 'A stage and a projector', accessibility_needs: null
};
const atrium: SuitabilityVenueRow = { venue_id: 1, name: 'Atrium Hall', location: 'Level 1', capacity: 400,
  facilities: 'Stage, PA, projection', accessibility_features: 'Step-free' };
const theatre: SuitabilityVenueRow = { venue_id: 3, name: 'Lecture Theatre', location: 'Level 2', capacity: 120,
  facilities: 'Stage, projector', accessibility_features: 'Step-free' };
const seminar: SuitabilityVenueRow = { venue_id: 2, name: 'Seminar Room', location: 'Level 3', capacity: 400,
  facilities: 'Whiteboards', accessibility_features: 'Step-free' };
const bare: SuitabilityVenueRow = { venue_id: 4, name: 'Empty Annex', location: null, capacity: 400,
  facilities: 'Stage, projector', accessibility_features: null };

const LAYOUTS: Record<number, Layout[]> = { 1: ['theatre', 'banquet'], 2: ['theatre'], 3: ['theatre'], 4: [] };

const UNDECIDED = { decider_name: null, decided_at: null, decision_reason: null };

const body = (overrides: Record<string, unknown> = {}) => ({
  event_id: 7, venue_id: 1, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', layout: 'theatre', ...overrides
});

function fakeStore(seed: { events?: SuitabilityEventRow[]; requests?: VenueBookingRequestRecord[]; raceOnCreate?: boolean;
  holds?: Record<number, number>; exceptions?: CapacityExceptionRecord[]; occupied?: VenueConflictRow[] } = {}) {
  const events = seed.events ?? [forum];
  const venues = [atrium, theatre, seminar, bare];
  const requests: VenueBookingRequestRecord[] = seed.requests ?? [];
  const created: NewVenueBookingRequest[] = [];
  const checked: [ConflictPeriod, ConflictOptions][] = [];
  const store: VenueBookingRequestStore = {
    async event(id) { return events.find(event => event.event_id === id) ?? null; },
    async venue(id) { return venues.find(venue => venue.venue_id === id) ?? null; },
    async layouts(id) { return LAYOUTS[id]; },
    async duplicate(values) {
      // Mirrors venue_booking_requests_no_duplicate.
      return requests.find(row => row.event_id === values.event_id && row.venue_id === values.venue_id
        && ['pending', 'approved'].includes(row.status) && row.starts_at < values.ends_at && row.ends_at > values.starts_at) ?? null;
    },
    async create(values) {
      if (seed.raceOnCreate) return null;
      created.push(values);
      const { requested_by: _requester, ...rest } = values;
      const record: VenueBookingRequestRecord = { ...rest, request_id: 40 + created.length, status: 'pending',
        venue_name: venues.find(venue => venue.venue_id === values.venue_id)!.name, requester_name: 'Casey Coordinator',
        requested_at: '2030-01-01T00:00:00.000Z', ...UNDECIDED };
      requests.push(record);
      return record;
    },
    async list(id) { return requests.filter(row => row.event_id === id); },
    async request(id) { return requests.find(row => row.request_id === id) ?? null; },
    async hold(id) { return seed.holds?.[id] ?? null; },
    async exceptions(id) { return (seed.exceptions ?? []).filter(row => row.request_id === id); },
    // SG2-50: whatever the seed says occupies the venue over the period.
    async conflicts(period, options) {
      checked.push([{ venue_id: period.venue_id, starts_at: period.starts_at, ends_at: period.ends_at }, options]);
      return (seed.occupied ?? []).filter(row => row.starts_at < period.ends_at && row.ends_at > period.starts_at);
    }
  };
  return { store, created, requests, checked };
}

function app(store: VenueBookingRequestStore | null, dependencies: VenueBookingRequestDependencies = {}) {
  const access = createAuthorization({
    resolvePrincipal: async token => { const user = USERS[token]; if (!user) throw new AccessError(401); return user; }
  });
  const deps: VenueBookingRequestDependencies = store
    ? { getAdminClient: () => ({}) as SupabaseClient, store: () => store, now: () => NOW, ...dependencies }
    : dependencies;
  const composed = express();
  composed.use(express.json());
  composed.use('/api/venue-booking-requests', createVenueBookingRequestsRouter(access, deps));
  return composed;
}

const as = (user: string) => ({ Authorization: `Bearer ${user}` });
const post = (composed: express.Express, user: string, payload: unknown) =>
  request(composed).post('/api/venue-booking-requests').set(as(user)).send(payload as object);

// --- POST /api/venue-booking-requests -----------------------------------------

test('[NORMAL] [SG2-48:AC1] [SG2-48:AC2] the assigned coordinator requests a venue; it carries the period, layout and the event\'s venue requirements and awaits Venue Staff', async () => {
  const { store, created } = fakeStore();
  const response = await post(app(store), 'coordinator', body({ venue_requirements: 'Ignored: taken from the event' }));
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    booking: 'allowed',
    conflicts: [],
    request: {
      request_id: 41, event_id: 7, venue_id: 1, venue_name: 'Atrium Hall', status: 'pending', layout: 'theatre',
      starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z',
      venue_requirements: 'A stage and a projector', requester_name: 'Casey Coordinator', requested_at: '2030-01-01T00:00:00.000Z',
      decider_name: null, decided_at: null, decision_reason: null
    }
  });
  assert.deepEqual(created, [{
    event_id: 7, venue_id: 1, layout: 'theatre', starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z',
    venue_requirements: 'A stage and a projector', requested_by: 'user-coordinator'
  }]);
});

test('[NORMAL] [SG2-48:AC3] [SG2-47:AC5] a venue too small for the event can still be requested; it stays pending until a capacity exception and a decision', async () => {
  const response = await post(app(fakeStore().store), 'coordinator', body({ venue_id: 3 }));
  assert.equal(response.status, 201);
  assert.equal(response.body.request.status, 'pending');
  assert.equal(response.body.booking, 'needs_capacity_exception');
});

test('[NORMAL] [SG2-48:AC4] an event can request several different venues for the same period, and planning events can request too', async () => {
  const { store } = fakeStore({ events: [forum, { ...forum, event_id: 8, status: 'planning' }] });
  const composed = app(store);
  assert.equal((await post(composed, 'coordinator', body())).status, 201);
  assert.equal((await post(composed, 'coordinator', body({ venue_id: 3 }))).status, 201);
  assert.equal((await post(composed, 'coordinator', body({ event_id: 8 }))).status, 201);
  const listed = await request(composed).get('/api/venue-booking-requests?event_id=7').set(as('coordinator'));
  assert.deepEqual(listed.body.requests.map((row: { venue_name: string }) => row.venue_name), ['Atrium Hall', 'Lecture Theatre']);
});

test('[CONFLICT] [SG2-48:AC4] a second request for the same venue over an overlapping period is refused and the earlier request is named', async () => {
  const { store, created } = fakeStore();
  const composed = app(store);
  assert.equal((await post(composed, 'coordinator', body())).status, 201);
  const duplicate = await post(composed, 'coordinator', body({ starts_at: '2030-06-15T09:59:00.000Z', ends_at: '2030-06-15T12:00:00.000Z' }));
  assert.deepEqual([duplicate.status, duplicate.body], [409, {
    error: 'This event already requested Atrium Hall for an overlapping period (request #41, pending).'
  }]);
  assert.equal(created.length, 1);
});

test('[BOUNDARY] [SG2-48:AC4] a period starting as the earlier one ends is not a duplicate, nor is one duplicating a rejected request', async () => {
  const rejected: VenueBookingRequestRecord = { request_id: 30, event_id: 7, venue_id: 1, venue_name: 'Atrium Hall', status: 'rejected',
    layout: 'theatre', starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z',
    venue_requirements: null, requester_name: null, requested_at: '2029-12-01T00:00:00.000Z', ...UNDECIDED };
  const composed = app(fakeStore({ requests: [rejected] }).store);
  assert.equal((await post(composed, 'coordinator', body())).status, 201);
  const adjacent = await post(composed, 'coordinator', body({ starts_at: '2030-06-15T10:00:00.000Z', ends_at: '2030-06-15T12:00:00.000Z' }));
  assert.equal(adjacent.status, 201);
});

test('[CONFLICT] [SG2-48:AC4] the same request made twice at once is refused by the database and reported as a duplicate', async () => {
  const response = await post(app(fakeStore({ raceOnCreate: true }).store), 'coordinator', body());
  assert.deepEqual([response.status, response.body], [409, { error: 'This event already requested this venue for an overlapping period.' }]);
  const unnamed: VenueBookingRequestRecord = { request_id: 30, event_id: 7, venue_id: 1, venue_name: null, status: 'approved',
    layout: null, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z',
    venue_requirements: null, requester_name: null, requested_at: '2029-12-01T00:00:00.000Z', ...UNDECIDED };
  const approved = await post(app(fakeStore({ requests: [unnamed] }).store), 'coordinator', body());
  assert.equal(approved.body.error, 'This event already requested this venue for an overlapping period (request #30, approved).');
});

test('[FAILURE] [SG2-48:AC1] a layout the venue does not offer is refused, naming the layouts it does offer', async () => {
  const composed = app(fakeStore().store);
  const unsupported = await post(composed, 'coordinator', body({ layout: 'classroom' }));
  assert.deepEqual([unsupported.status, unsupported.body], [409, { error: 'Atrium Hall does not offer the classroom layout. It offers: theatre, banquet.' }]);
  const none = await post(composed, 'coordinator', body({ venue_id: 4 }));
  assert.deepEqual([none.status, none.body], [409, { error: 'Empty Annex has no layouts recorded, so it cannot be requested yet.' }]);
});

test('[FAILURE] [SG2-48:AC1] [SG2-47:AC2] a venue missing a required facility cannot be requested', async () => {
  const { store, created } = fakeStore();
  const response = await post(app(store), 'coordinator', body({ venue_id: 2 }));
  assert.deepEqual([response.status, response.body], [409, {
    error: 'Seminar Room cannot be booked for this event. Missing required facilities: projector, stage.'
  }]);
  assert.equal(created.length, 0);
});

test('[FAILURE] [SG2-48:AC1] only an approved event the caller coordinates, and a known venue, can be requested for', async () => {
  const { store } = fakeStore({ events: [forum, { ...forum, event_id: 8, status: 'under_review' }, { ...forum, event_id: 9, status: 'confirmed' }] });
  const composed = app(store);
  const reviewing = await post(composed, 'coordinator', body({ event_id: 8 }));
  assert.deepEqual([reviewing.status, reviewing.body], [409, { error: 'A venue can be requested only for an approved event. This event is under review.' }]);
  assert.equal((await post(composed, 'coordinator', body({ event_id: 9 }))).status, 409);
  for (const [user, payload] of [['other_coordinator', body()], ['coordinator', body({ event_id: 99 })]] as const) {
    const hidden = await post(composed, user, payload);
    assert.deepEqual([hidden.status, hidden.body], [404, { error: 'Event not found.' }], user);
  }
  const venue = await post(composed, 'coordinator', body({ venue_id: 99 }));
  assert.deepEqual([venue.status, venue.body], [404, { error: 'Venue not found.' }]);
});

test('[BOUNDARY] [SG2-48:AC1] the request needs whole-number ids, a known layout and a future period that starts before it ends', async () => {
  const composed = app(fakeStore().store);
  const invalid: unknown[] = [
    [], body({ event_id: '7' }), body({ venue_id: 0 }), body({ event_id: 2147483648 }), body({ venue_id: 1.5 }),
    body({ layout: 'ballroom' }), body({ layout: undefined }), body({ starts_at: 'soon' }), body({ ends_at: '' }),
    body({ ends_at: '2030-06-15T02:00:00.000Z' }), body({ starts_at: '2030-06-15T11:00:00.000Z' }),
    body({ starts_at: '2030-01-01T00:00:00.000Z' }), body({ starts_at: '2029-12-31T23:00:00.000Z' })
  ];
  for (const payload of invalid) {
    const response = await post(composed, 'coordinator', payload);
    assert.deepEqual([response.status, response.body], [400, { error: 'Choose an event, a venue, a layout and a future period that starts before it ends.' }], JSON.stringify(payload));
  }
  assert.equal(validateVenueBookingRequest(null, NOW), null);
  assert.deepEqual(validateVenueBookingRequest(body({ starts_at: '2030-01-01T08:00:00.001+08:00', ends_at: '2030-01-01T08:00:00.002+08:00' }), NOW), {
    event_id: 7, venue_id: 1, layout: 'theatre', starts_at: '2030-01-01T00:00:00.001Z', ends_at: '2030-01-01T00:00:00.002Z'
  });
});

test('[FAILURE] [SG2-48:AC1] [SG2-48:request-access] only a signed-in coordinator may request a venue', async () => {
  const composed = app(fakeStore().store);
  assert.equal((await request(composed).post('/api/venue-booking-requests').send(body())).status, 401);
  for (const user of ['venue', 'support', 'organiser', 'attendee']) {
    assert.equal((await post(composed, user, body())).status, 403, user);
  }
});

// --- GET /api/venue-booking-requests?event_id= ---------------------------------

test('[NORMAL] [SG2-48:AC3] the coordinator and Venue Staff see the event\'s requests and that they are pending', async () => {
  const { store } = fakeStore();
  const composed = app(store);
  await post(composed, 'coordinator', body());
  for (const user of ['coordinator', 'venue']) {
    const response = await request(composed).get('/api/venue-booking-requests?event_id=7').set(as(user));
    assert.equal(response.status, 200, user);
    assert.deepEqual(response.body.requests.map((row: { request_id: number; status: string }) => [row.request_id, row.status]), [[41, 'pending']]);
  }
});

test('[FAILURE] [BOUNDARY] [SG2-48:AC3] [SG2-48:request-visibility] requests for an event outside the caller\'s reach, or without a valid id, are not listed', async () => {
  const composed = app(fakeStore().store);
  const hidden = await request(composed).get('/api/venue-booking-requests?event_id=7').set(as('other_coordinator'));
  assert.deepEqual([hidden.status, hidden.body], [404, { error: 'Event not found.' }]);
  assert.equal((await request(composed).get('/api/venue-booking-requests?event_id=8').set(as('venue'))).status, 404);
  for (const query of ['', 'event_id=0', 'event_id=abc']) {
    assert.equal((await request(composed).get(`/api/venue-booking-requests?${query}`).set(as('coordinator'))).status, 400, query);
  }
  for (const user of ['organiser', 'support', 'attendee']) {
    assert.equal((await request(composed).get('/api/venue-booking-requests?event_id=7').set(as(user))).status, 403, user);
  }
});

test('[FAILURE] [SG2-48:AC1] [SG2-48:request-unavailable] an unconfigured or failing database is reported as temporarily unavailable', async () => {
  const unconfigured = app(null);
  assert.equal((await post(unconfigured, 'coordinator', body({ starts_at: '2099-06-15T02:00:00.000Z', ends_at: '2099-06-15T10:00:00.000Z' }))).status, 503);
  const noStore = app(null, { getAdminClient: () => ({}) as SupabaseClient });
  assert.equal((await request(noStore).get('/api/venue-booking-requests?event_id=7').set(as('venue'))).status, 503);
  const failing = (error: Error) => ({ ...fakeStore().store, async event(): Promise<never> { throw error; } });
  for (const error of [new Error('offline'), new AccessError(503)]) {
    const response = await post(app(failing(error)), 'coordinator', body());
    assert.deepEqual([response.status, response.body], [503, { error: new AccessError(503).message }]);
  }
});

// --- POST /api/venue-booking-requests/:requestId/decision (SG2-49) ------------

const pendingRequest = (overrides: Partial<VenueBookingRequestRecord> = {}): VenueBookingRequestRecord => ({
  request_id: 41, event_id: 7, venue_id: 1, venue_name: 'Atrium Hall', status: 'pending', layout: 'theatre',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', venue_requirements: 'A stage and a projector',
  requester_name: 'Casey Coordinator', requested_at: '2030-01-01T00:00:00.000Z', ...UNDECIDED, ...overrides
});

/** Records each decision; by default it commits it as the database would. */
function fakeDecisions(requests: VenueBookingRequestRecord[], result?: DecisionResult) {
  const calls: { token: string; args: [number, Decision, string | null] }[] = [];
  const decisions = (token: string): VenueBookingDecisionStore => ({
    async decide(requestId, decision, reason) {
      calls.push({ token, args: [requestId, decision, reason] });
      if (result) return result;
      const row = requests.find(item => item.request_id === requestId)!;
      Object.assign(row, { status: decision === 'approve' ? 'approved' : 'rejected', decider_name: 'Vera Venue',
        decided_at: '2030-01-02T00:00:00.000Z', decision_reason: reason });
      return { outcome: 'updated', request_id: requestId, status: row.status as 'approved' | 'rejected',
        venue_booking_id: decision === 'approve' ? 9 : null, decided_at: '2030-01-02T00:00:00.000Z' };
    }
  });
  return { decisions, calls };
}

function decisionApp(seed: Parameters<typeof fakeStore>[0] = {}, result?: DecisionResult) {
  const { store, requests } = fakeStore({ requests: [pendingRequest()], ...seed });
  const { decisions, calls } = fakeDecisions(requests, result);
  return { composed: app(store, { decisions }), calls, requests };
}

const decide = (composed: express.Express, user: string, payload: unknown, id: number | string = 41) =>
  request(composed).post(`/api/venue-booking-requests/${id}/decision`).set(as(user)).send(payload as object);

test('[NORMAL] [SG2-49:AC1] [SG2-49:AC3] Venue Staff approve a clear request; the database commits it as them and the decision comes back recorded', async () => {
  const { composed, calls } = decisionApp();
  const response = await decide(composed, 'venue', { decision: 'approve' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ token: 'venue', args: [41, 'approve', null] }]);
  assert.deepEqual([response.body.request.status, response.body.request.decider_name, response.body.request.decided_at],
    ['approved', 'Vera Venue', '2030-01-02T00:00:00.000Z']);
});

test('[NORMAL] [SG2-49:AC2] [SG2-49:AC3] a rejection carries its trimmed reason, which comes back on the request', async () => {
  const { composed, calls } = decisionApp();
  const response = await decide(composed, 'venue', { decision: 'reject', reason: '  The hall is being rewired.  ' });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].args, [41, 'reject', 'The hall is being rewired.']);
  assert.deepEqual([response.body.request.status, response.body.request.decision_reason], ['rejected', 'The hall is being rewired.']);
});

test('[BOUNDARY] [SG2-49:AC2] a rejection needs a reason of at most 500 characters; an approval may carry an optional note', async () => {
  const cases: [unknown, string][] = [
    [{ decision: 'reject' }, 'Give a reason for rejecting this request.'],
    [{ decision: 'reject', reason: '   ' }, 'Give a reason for rejecting this request.'],
    [{ decision: 'reject', reason: 'x'.repeat(501) }, 'Keep the reason to 500 characters or fewer.'],
    [{ decision: 'approve', reason: 5 }, 'The reason must be text.'],
    [{ decision: 'maybe' }, 'Choose approve or reject.'],
    [[], 'Choose approve or reject.']
  ];
  for (const [payload, error] of cases) {
    const { composed, calls } = decisionApp();
    const response = await decide(composed, 'venue', payload);
    assert.deepEqual([response.status, response.body], [400, { error }], JSON.stringify(payload));
    assert.equal(calls.length, 0);
  }
  const longest = decisionApp();
  assert.equal((await decide(longest.composed, 'venue', { decision: 'reject', reason: 'x'.repeat(500) })).status, 200);
  const noted = decisionApp();
  assert.equal((await decide(noted.composed, 'venue', { decision: 'approve', reason: null })).status, 200);
  assert.equal((await decide(noted.composed, 'venue', { decision: 'approve' }, 'abc')).status, 400);
});

test('[FAILURE] [SG2-49:AC1] [SG2-47:AC2] a venue missing a required facility cannot be approved, though it can be rejected', async () => {
  const blocked = decisionApp({ requests: [pendingRequest({ venue_id: 2, venue_name: 'Seminar Room' })] });
  const response = await decide(blocked.composed, 'venue', { decision: 'approve' });
  assert.deepEqual([response.status, response.body], [409, { error: 'Seminar Room cannot be booked for this event. Missing required facilities: projector, stage.' }]);
  assert.equal(blocked.calls.length, 0);
  assert.equal((await decide(blocked.composed, 'venue', { decision: 'reject', reason: 'No stage' })).status, 200);
});

test('[FAILURE] [SG2-49:AC1] [SG2-47:AC3] a venue too small is approved only once a capacity exception covers the attendance', async () => {
  const refused = decisionApp({ requests: [pendingRequest({ venue_id: 3, venue_name: 'Lecture Theatre' })] });
  const response = await decide(refused.composed, 'venue', { decision: 'approve' });
  assert.deepEqual([response.status, response.body], [409, { error: 'Approve a capacity exception for this request before approving the booking.' }]);
  assert.equal(refused.calls.length, 0);
  const exception: CapacityExceptionRecord = { exception_id: 1, request_id: 41, approved_by: 'user-organiser', approver_name: 'Olive',
    approver_role: 'event_organiser', expected_attendance: 150, venue_capacity: 120, approved_at: '2030-01-01T00:00:00.000Z' };
  const covered = decisionApp({ requests: [pendingRequest({ venue_id: 3, venue_name: 'Lecture Theatre' })], exceptions: [exception] });
  assert.equal((await decide(covered.composed, 'venue', { decision: 'approve' })).status, 200);
});

test('[CONFLICT] [SG2-49:AC1] a period already booked, blocked or held at the moment of approval is refused and named', async () => {
  const period = { starts_at: '2030-06-15T04:00:00.000Z', ends_at: '2030-06-15T06:00:00.000Z' };
  const cases: [DecisionResult, number, Record<string, unknown>][] = [
    [{ outcome: 'conflict', kind: 'booking', label: 'Board Dinner', ...period }, 409,
      { error: 'Atrium Hall is already booked for Board Dinner during this period.', conflict: { kind: 'booking', label: 'Board Dinner', ...period } }],
    [{ outcome: 'conflict', kind: 'block', label: 'Floor resurfacing', ...period }, 409,
      { error: 'Atrium Hall is blocked during this period: Floor resurfacing.', conflict: { kind: 'block', label: 'Floor resurfacing', ...period } }],
    [{ outcome: 'conflict', kind: 'hold', label: 'Open Day', ...period }, 409,
      { error: 'Atrium Hall is on a tentative hold for Open Day during this period.', conflict: { kind: 'hold', label: 'Open Day', ...period } }],
    [{ outcome: 'decided', status: 'rejected' }, 409, { error: 'This request has already been rejected.' }],
    [{ outcome: 'hold', hold_id: 12 }, 409, { error: 'This request belongs to tentative hold #12. Convert or release it from Venue holds.' }],
    [{ outcome: 'closed' }, 409, { error: 'This request can no longer be approved: the event is not approved or the requested period has passed.' }],
    [{ outcome: 'capacity' }, 409, { error: 'Approve a capacity exception for this request before approving the booking.' }],
    [{ outcome: 'missing' }, 404, { error: 'Booking request not found.' }],
    [{ outcome: 'invalid' }, 400, { error: 'Choose approve or reject, and give a reason for rejecting.' }]
  ];
  for (const [result, status, expected] of cases) {
    const { composed } = decisionApp({}, result);
    const response = await decide(composed, 'venue', { decision: 'approve' });
    assert.deepEqual([response.status, response.body], [status, expected], result.outcome);
  }
  const unnamed = decisionApp({ requests: [pendingRequest({ venue_name: null })] }, cases[0][0]);
  assert.equal((await decide(unnamed.composed, 'venue', { decision: 'approve' })).body.error,
    'This venue is already booked for Board Dinner during this period.');
});

test('[CONFLICT] [SG2-49:AC3] a request already decided is not decided again', async () => {
  const { composed, calls } = decisionApp({ requests: [pendingRequest({ status: 'approved' })] });
  const response = await decide(composed, 'venue', { decision: 'reject', reason: 'Too late' });
  assert.deepEqual([response.status, response.body], [409, { error: 'This request has already been approved.' }]);
  assert.equal(calls.length, 0);
});

test('[FAILURE] [SG2-49:AC1] a request created by a tentative hold, or an unknown one, is not decided here', async () => {
  const held = decisionApp({ holds: { 41: 12 } });
  const response = await decide(held.composed, 'venue', { decision: 'approve' });
  assert.deepEqual([response.status, response.body], [409, { error: 'This request belongs to tentative hold #12. Convert or release it from Venue holds.' }]);
  assert.equal(held.calls.length, 0);
  const missing = await decide(held.composed, 'venue', { decision: 'approve' }, 99);
  assert.deepEqual([missing.status, missing.body], [404, { error: 'Booking request not found.' }]);
});

test('[FAILURE] [SG2-49:AC1] [SG2-49:AC2] only signed-in Venue Staff decide venue requests', async () => {
  const { composed, calls } = decisionApp();
  assert.equal((await request(composed).post('/api/venue-booking-requests/41/decision').send({ decision: 'approve' })).status, 401);
  for (const user of ['coordinator', 'organiser', 'support', 'attendee']) {
    assert.equal((await decide(composed, user, { decision: 'approve' })).status, 403, user);
  }
  assert.equal(calls.length, 0);
});

test('[FAILURE] [SG2-49:AC3] a refused or failing database decision is reported without leaking details', async () => {
  const { store } = fakeStore({ requests: [pendingRequest()] });
  for (const [error, status] of [[new AccessError(403), 403], [new Error('offline'), 503]] as const) {
    const failing = app(store, { decisions: () => ({ async decide(): Promise<never> { throw error; } }) });
    const response = await decide(failing, 'venue', { decision: 'reject', reason: 'No' });
    assert.deepEqual([response.status, response.body], [status, { error: new AccessError(status).message }]);
  }
  // Without a configured database the default store cannot sign in as the caller.
  const unconfigured = await decide(app(store), 'venue', { decision: 'reject', reason: 'No' });
  assert.equal(unconfigured.status, 503);
});
