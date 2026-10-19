import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, AccessError, type Role } from './auth';
import type {
  BookingRequestRow,
  CapacityExceptionRecord,
  NewCapacityException,
  SuitabilityEventRow,
  SuitabilityVenueRow,
  VenueSuitabilityStore
} from './db/venueSuitability';
import {
  createBookingRequestSuitabilityRouter,
  createVenueSuitabilityRouter,
  type VenueSuitabilityDependencies
} from './venues/suitabilityRoutes';

const USERS: Record<string, { userId: string; role: Role }> = {
  coordinator: { userId: 'user-coordinator', role: 'event_coordinator' },
  other_coordinator: { userId: 'user-other-coordinator', role: 'event_coordinator' },
  organiser: { userId: 'user-organiser', role: 'event_organiser' },
  other_organiser: { userId: 'user-other-organiser', role: 'event_organiser' },
  venue: { userId: 'user-venue', role: 'venue_staff' },
  other_venue: { userId: 'user-other-venue', role: 'venue_staff' },
  support: { userId: 'user-support', role: 'technical_support_staff' },
  lead: { userId: 'user-lead', role: 'event_coordinator_lead' },
  safety: { userId: 'user-safety', role: 'safety_officer' },
  attendee: { userId: 'user-attendee', role: 'attendee' }
};

const forum: SuitabilityEventRow = {
  event_id: 7, name: 'Leadership Forum', organiser_id: 'user-organiser', coordinator_id: 'user-coordinator',
  status: 'approved', expected_attendance: 150, venue_requirements: 'A stage and a projector',
  accessibility_needs: 'Step-free entry and a hearing loop'
};
const atrium: SuitabilityVenueRow = { venue_id: 1, name: 'Atrium Hall', location: 'Level 1', capacity: 400,
  facilities: 'Stage, PA, projection', accessibility_features: 'Step-free, hearing loop' };
const seminar: SuitabilityVenueRow = { venue_id: 2, name: 'Seminar Room', location: 'Level 3', capacity: 60,
  facilities: 'Whiteboards, screen', accessibility_features: 'Step-free' };
const theatre: SuitabilityVenueRow = { venue_id: 3, name: 'Lecture Theatre', location: 'Level 2', capacity: 120,
  facilities: 'Stage, projector', accessibility_features: 'Step-free, hearing loop' };

const pending = (overrides: Partial<BookingRequestRow> = {}): BookingRequestRow => ({
  request_id: 31, event_id: 7, venue_id: 3, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z',
  status: 'pending', venue_booking: null, ...overrides
});
// SG2-66 AC2: an approved request that holds a confirmed booking.
const booked = (overrides: Partial<BookingRequestRow> = {}) => pending({ status: 'approved', venue_booking: { status: 'confirmed' }, ...overrides });
const legacy: CapacityExceptionRecord = { exception_id: 9, request_id: 31, approved_by: 'user-organiser', approver_name: 'Olive',
  approver_role: 'event_organiser', expected_attendance: 150, venue_capacity: 120, approved_at: '2026-01-01T00:00:00.000Z' };

function fakeStore(seed: {
  events?: SuitabilityEventRow[];
  venues?: SuitabilityVenueRow[];
  requests?: BookingRequestRow[];
  exceptions?: CapacityExceptionRecord[];
} = {}) {
  const events = seed.events ?? [forum];
  const venues = seed.venues ?? [atrium, theatre, seminar];
  const requests = seed.requests ?? [pending(), pending({ request_id: 32, venue_id: 2 }), pending({ request_id: 33, venue_id: 1 })];
  const exceptions = seed.exceptions ?? [];
  const recorded: NewCapacityException[] = [];
  const store: VenueSuitabilityStore = {
    async capacityCandidates() {
      return requests.flatMap(row => {
        const event = events.find(event => event.event_id === row.event_id)!;
        const venue = venues.find(venue => venue.venue_id === row.venue_id)!;
        return ['pending', 'approved'].includes(row.status)
          ? [{ ...row, event, venue, exceptions: exceptions.filter(grant => grant.request_id === row.request_id) }] : [];
      });
    },
    async event(id) { return events.find(event => event.event_id === id) ?? null; },
    async venues(id) {
      return venues.filter(venue => id === undefined || venue.venue_id === id).sort((a, b) => a.name.localeCompare(b.name));
    },
    async request(id) { return requests.find(row => row.request_id === id) ?? null; },
    async exceptions(id) { return exceptions.filter(row => row.request_id === id); },
    async recordException(values) {
      // Mirrors the unique (request_id, expected_attendance) index on Venue Staff approvals.
      if (exceptions.some(row => row.request_id === values.request_id && row.expected_attendance === values.expected_attendance
        && row.approver_role === 'venue_staff')) return null;
      recorded.push(values);
      const record = { ...values, exception_id: exceptions.length + 1, approver_name: 'Approver', approved_at: '2030-06-01T00:00:00.000Z' };
      exceptions.push(record);
      return record;
    }
  };
  return { store, recorded, requests };
}

function app(store: VenueSuitabilityStore, dependencies: VenueSuitabilityDependencies = {}) {
  const access = createAuthorization({
    resolvePrincipal: async token => { const user = USERS[token]; if (!user) throw new AccessError(401); return user; }
  });
  const deps = { getAdminClient: () => ({}) as SupabaseClient, store: () => store, ...dependencies };
  const composed = express();
  composed.use(express.json());
  composed.use('/api/venues', createVenueSuitabilityRouter(access, deps));
  composed.use('/api/venue-booking-requests', createBookingRequestSuitabilityRouter(access, deps));
  return composed;
}

const as = (user: string) => ({ Authorization: `Bearer ${user}` });

// --- GET /api/venue-booking-requests/capacity-exceptions ----------------------

test('[NORMAL] [SG2-47:AC3] [SG2-66:AC5] Venue Staff discover only actionable capacity exceptions with a minimal row projection', async () => {
  const expected = { request_id: 31, event_id: 7, event_name: 'Leadership Forum', venue_name: 'Lecture Theatre',
    starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', expected_attendance: 150, venue_capacity: 120, booked: false };
  const response = await request(app(fakeStore().store)).get('/api/venue-booking-requests/capacity-exceptions').set(as('venue'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { requests: [expected] });
});

test('[FAILURE] [SG2-47:AC3] [SG2-66:AC5] capacity discovery refuses unauthenticated and non-approver roles before reading any candidates', async () => {
  let reads = 0;
  const store = fakeStore().store;
  store.capacityCandidates = async () => { reads++; return []; };
  const server = app(store);
  const path = '/api/venue-booking-requests/capacity-exceptions?organiser_id=user-organiser&request_id=31';
  assert.equal((await request(server).get(path)).status, 401);
  for (const who of ['coordinator', 'other_coordinator', 'lead', 'safety', 'attendee']) {
    assert.equal((await request(server).get(path).set(as(who))).status, 403, who);
  }
  assert.equal(reads, 0);
});

test('[FAILURE] [SG2-47:AC3] [SG2-66:AC5] organisers and Technical Support Staff can no longer discover capacity exceptions, even for their own events', async () => {
  let reads = 0;
  const store = fakeStore().store;
  store.capacityCandidates = async () => { reads++; return []; };
  for (const who of ['organiser', 'support']) {
    const response = await request(app(store)).get('/api/venue-booking-requests/capacity-exceptions?organiser_id=user-organiser').set(as(who));
    assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }], who);
  }
  assert.equal(reads, 0);
});

test('[BOUNDARY] [SG2-47:AC3] [SG2-66:AC2] missing capacity is actionable but missing attendance, covered requests and decided requests without a live booking are not', async () => {
  const events = [forum, { ...forum, event_id: 8, expected_attendance: null },
    { ...forum, event_id: 9, expected_attendance: 0 }, { ...forum, event_id: 10, name: null },
    { ...forum, event_id: 11, name: '   ' }, { ...forum, event_id: 12, status: 'cancelled' }];
  const unknown = { ...theatre, venue_id: 4, name: '   ', capacity: null };
  const covered = { exception_id: 1, request_id: 31, approved_by: 'user-venue', approver_name: 'Venue Staff',
    approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120, approved_at: '2030-06-01T00:00:00.000Z' };
  const { store } = fakeStore({ events, venues: [atrium, theatre, seminar, unknown], exceptions: [covered], requests: [
    pending(), pending({ request_id: 32, venue_id: 2 }), pending({ request_id: 33, venue_id: 1 }),
    pending({ request_id: 34, event_id: 8 }), pending({ request_id: 35, event_id: 9 }),
    pending({ request_id: 36, event_id: 10, venue_id: 4 }), pending({ request_id: 37, event_id: 11, venue_id: 4 }),
    // Approved, but its booking was released, the event is cancelled, or it holds no booking.
    booked({ request_id: 38, venue_booking: { status: 'cancelled' } }), booked({ request_id: 39, event_id: 12 }),
    pending({ request_id: 40, status: 'approved' }), pending({ request_id: 41, status: 'rejected' })
  ] });
  const response = await request(app(store)).get('/api/venue-booking-requests/capacity-exceptions').set(as('venue'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.requests.map((row: { request_id: number }) => row.request_id), [36, 37]);
  for (const row of response.body.requests) {
    assert.equal(row.venue_capacity, null);
    assert.equal(row.expected_attendance, 150);
    assert.equal(row.event_name, 'Untitled event');
    assert.equal(row.venue_name, 'Unnamed venue');
  }
});

test('[NORMAL] [SG2-66:AC2] [SG2-66:AC5] a booked venue whose live event now outgrows it is listed for Venue Staff as booked, with only an earlier lower approval', async () => {
  const lower = { ...legacy, exception_id: 1, request_id: 50, approver_role: 'venue_staff', approved_by: 'user-venue', expected_attendance: 130 };
  const events = ['approved', 'planning', 'awaiting_safety_check', 'preparation', 'confirmed']
    .map((status, index) => ({ ...forum, event_id: 20 + index, status }));
  const { store } = fakeStore({ events, exceptions: [lower], requests: events.map((event, index) => booked({ request_id: 50 + index, event_id: event.event_id })) });
  const response = await request(app(store)).get('/api/venue-booking-requests/capacity-exceptions').set(as('venue'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.requests.map((row: { request_id: number; booked: boolean }) => [row.request_id, row.booked]),
    [[50, true], [51, true], [52, true], [53, true], [54, true]]);
});

test('[NORMAL] [SG2-47:AC3] [SG2-47:AC5] [SG2-66:AC5] Venue Staff discover, approve and reload the receipt while the booking request stays pending', async () => {
  const { store, requests } = fakeStore();
  const server = app(store);
  const path = '/api/venue-booking-requests/capacity-exceptions';
  assert.equal((await request(server).get(path).set(as('venue'))).body.requests.length, 1);
  const approved = await request(server).post('/api/venue-booking-requests/31/capacity-exception').set(as('venue'))
    .send({ approved_by: 'forged-user', expected_attendance: 1, approver_role: 'event_coordinator' });
  assert.equal(approved.status, 201);
  assert.equal(approved.body.exception.approved_by, 'user-venue');
  assert.equal(approved.body.exception.expected_attendance, 150);
  assert.equal(approved.body.exception.approver_role, 'venue_staff');
  assert.equal(requests[0].status, 'pending');
  const receipt = await request(server).get('/api/venue-booking-requests/31/suitability').set(as('venue'));
  assert.equal(receipt.status, 200);
  assert.deepEqual(receipt.body.exceptions, [approved.body.exception]);
  assert.equal(receipt.body.booking, 'allowed');
  assert.deepEqual((await request(server).get(path).set(as('venue'))).body, { requests: [] });
});

test('[FAILURE] [SG2-47:AC3] unavailable capacity discovery reports a safe retryable error rather than private database details', async () => {
  const { store } = fakeStore();
  store.capacityCandidates = async () => { throw new Error('PRIVATE database details'); };
  for (const server of [app(store), app(store, { getAdminClient: () => null })]) {
    const response = await request(server).get('/api/venue-booking-requests/capacity-exceptions').set(as('venue'));
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(response.body).includes('PRIVATE'), false);
  }
});

// --- GET /api/venues/suitability ---------------------------------------------

test('[NORMAL] [SG2-47:AC1] [SG2-47:AC2] [SG2-47:AC4] an assigned coordinator sees every venue against the event, with each reason it does not fit', async () => {
  const response = await request(app(fakeStore().store)).get('/api/venues/suitability?event_id=7').set(as('coordinator'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.event, {
    event_id: 7, name: 'Leadership Forum', expected_attendance: 150,
    venue_requirements: 'A stage and a projector', accessibility_needs: 'Step-free entry and a hearing loop'
  });
  const byName = Object.fromEntries(response.body.venues.map((venue: { name: string; suitability: unknown }) => [venue.name, venue.suitability]));
  assert.deepEqual(Object.keys(byName), ['Atrium Hall', 'Lecture Theatre', 'Seminar Room']);
  assert.equal(byName['Atrium Hall'].suitable, true);
  assert.deepEqual(byName['Lecture Theatre'].issues.map((issue: { message: string }) => issue.message),
    ["Expected attendance of 150 is above this venue's capacity of 120."]);
  assert.deepEqual(byName['Seminar Room'].issues.map((issue: { kind: string }) => issue.kind), ['capacity', 'facility', 'accessibility']);
  assert.deepEqual(byName['Seminar Room'].issues[1].missing, ['projector', 'stage']);
  assert.deepEqual(byName['Seminar Room'].issues[2].missing, ['hearing loop']);
});

test('[NORMAL] [FAILURE] [SG2-47:AC1] one venue can be viewed against the event', async () => {
  const response = await request(app(fakeStore().store)).get('/api/venues/suitability?event_id=7&venue_id=3').set(as('venue'));
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.venues.map((venue: { venue_id: number }) => venue.venue_id), [3]);
  const missing = await request(app(fakeStore().store)).get('/api/venues/suitability?event_id=7&venue_id=99').set(as('venue'));
  assert.deepEqual([missing.status, missing.body], [404, { error: 'Venue not found.' }]);
});

test('[FAILURE] [SG2-47:event-visibility] an event outside the caller\'s reach is reported as not found', async () => {
  const composed = app(fakeStore().store);
  for (const user of ['other_coordinator', 'other_organiser']) {
    const response = await request(composed).get('/api/venues/suitability?event_id=7').set(as(user));
    assert.deepEqual([response.status, response.body], [404, { error: 'Event not found.' }], user);
  }
  for (const user of ['organiser', 'venue', 'support']) {
    assert.equal((await request(composed).get('/api/venues/suitability?event_id=7').set(as(user))).status, 200, user);
  }
  assert.equal((await request(composed).get('/api/venues/suitability?event_id=8').set(as('venue'))).status, 404);
});

test('[FAILURE] [BOUNDARY] [SG2-47:suitability-access] suitability needs a signed-in internal role or organiser, and whole-number ids', async () => {
  const composed = app(fakeStore().store);
  assert.equal((await request(composed).get('/api/venues/suitability?event_id=7')).status, 401);
  assert.equal((await request(composed).get('/api/venues/suitability?event_id=7').set(as('attendee'))).status, 403);
  for (const query of ['', 'event_id=0', 'event_id=abc', 'event_id=7&venue_id=-1', 'event_id=99999999999', 'event_id=7&event_id=8']) {
    const response = await request(composed).get(`/api/venues/suitability?${query}`).set(as('coordinator'));
    assert.equal(response.status, 400, query);
  }
});

test('[FAILURE] [SG2-47:suitability-unavailable] suitability is unavailable when the database is', async () => {
  const unconfigured = app(fakeStore().store, { getAdminClient: () => null });
  assert.equal((await request(unconfigured).get('/api/venues/suitability?event_id=7').set(as('venue'))).status, 503);
  const failing = fakeStore().store;
  failing.event = async () => { throw new Error('offline'); };
  const response = await request(app(failing)).get('/api/venues/suitability?event_id=7').set(as('venue'));
  assert.equal(response.status, 503);
  assert.doesNotMatch(response.text, /offline/);
});

// --- GET /api/venue-booking-requests/:requestId/suitability --------------------

test('[NORMAL] [SG2-47:AC2] [SG2-47:AC3] a booking request shows its venue against the event and whether it may go ahead', async () => {
  const { store } = fakeStore({ exceptions: [{ exception_id: 1, request_id: 31, approved_by: 'user-venue', approver_name: 'Vera',
    approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120, approved_at: '2030-06-01T00:00:00.000Z' }] });
  const composed = app(store);
  const response = await request(composed).get('/api/venue-booking-requests/31/suitability').set(as('venue'));
  assert.equal(response.status, 200);
  assert.equal(response.body.request.request_id, 31);
  assert.equal(response.body.event.name, 'Leadership Forum');
  assert.equal(response.body.venue.name, 'Lecture Theatre');
  assert.deepEqual(response.body.suitability.issues.map((issue: { kind: string }) => issue.kind), ['capacity']);
  assert.equal(response.body.exceptions[0].approver_name, 'Vera');
  assert.equal(response.body.booking, 'allowed');

  const blocked = await request(composed).get('/api/venue-booking-requests/32/suitability').set(as('coordinator'));
  assert.equal(blocked.body.booking, 'blocked');
  const needs = await request(app(fakeStore().store)).get('/api/venue-booking-requests/31/suitability').set(as('organiser'));
  assert.equal(needs.body.booking, 'needs_capacity_exception');
});

test('[FAILURE] [SG2-47:request-visibility] a booking request that is unknown, malformed or outside the caller\'s reach is refused', async () => {
  const composed = app(fakeStore().store);
  assert.equal((await request(composed).get('/api/venue-booking-requests/abc/suitability').set(as('venue'))).status, 400);
  assert.equal((await request(composed).get('/api/venue-booking-requests/99/suitability').set(as('venue'))).status, 404);
  const orphan = app(fakeStore({ requests: [pending({ event_id: 99 })] }).store);
  assert.equal((await request(orphan).get('/api/venue-booking-requests/31/suitability').set(as('venue'))).status, 404);
  const hidden = await request(composed).get('/api/venue-booking-requests/31/suitability').set(as('other_organiser'));
  assert.deepEqual([hidden.status, hidden.body], [404, { error: 'Booking request not found.' }]);
});

// --- POST /api/venue-booking-requests/:requestId/capacity-exception -------------

test('[NORMAL] [SG2-47:AC3] [SG2-47:AC5] Venue Staff approve a capacity exception; the approver is recorded and the booking is left undecided', async () => {
  const { store, recorded, requests } = fakeStore();
  const response = await request(app(store)).post('/api/venue-booking-requests/31/capacity-exception').set(as('venue'));
  assert.equal(response.status, 201);
  assert.deepEqual(recorded, [{ request_id: 31, approved_by: 'user-venue', approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120 }]);
  assert.equal(response.body.exception.approved_by, 'user-venue');
  assert.equal(response.body.booking, 'allowed');
  assert.equal(requests[0].status, 'pending');
});

test('[FAILURE] [SG2-47:AC3] [SG2-66:AC5] Technical Support Staff and organisers, even the event\'s own, can no longer approve', async () => {
  const { store, recorded } = fakeStore();
  const composed = app(store);
  for (const user of ['support', 'organiser', 'other_organiser']) {
    const response = await request(composed).post('/api/venue-booking-requests/31/capacity-exception').set(as(user));
    assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }], user);
  }
  assert.deepEqual(recorded, []);
});

test('[NORMAL] [SG2-66:AC2] [SG2-66:AC5] Venue Staff approve an exception for the revised attendance of a booked venue; the booking stays as it is', async () => {
  const lower: CapacityExceptionRecord = { ...legacy, approver_role: 'venue_staff', approved_by: 'user-venue', expected_attendance: 130 };
  const { store, recorded, requests } = fakeStore({ events: [{ ...forum, status: 'confirmed' }], requests: [booked()], exceptions: [lower] });
  const server = app(store);
  const before = await request(server).get('/api/venue-booking-requests/31/suitability').set(as('venue'));
  assert.equal(before.body.booking, 'needs_capacity_exception');
  const response = await request(server).post('/api/venue-booking-requests/31/capacity-exception').set(as('venue'));
  assert.equal(response.status, 201);
  assert.deepEqual(recorded, [{ request_id: 31, approved_by: 'user-venue', approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120 }]);
  assert.equal(response.body.booking, 'allowed');
  assert.deepEqual([requests[0].status, requests[0].venue_booking], ['approved', { status: 'confirmed' }]);
  assert.deepEqual((await request(server).get('/api/venue-booking-requests/capacity-exceptions').set(as('venue'))).body, { requests: [] });
});

test('[CONFLICT] [SG2-66:AC5] an exception recorded by another role before SG2-66 does not count; Venue Staff still record the one that does', async () => {
  const { store, recorded } = fakeStore({ exceptions: [legacy] });
  const server = app(store);
  const fit = await request(server).get('/api/venue-booking-requests/31/suitability').set(as('venue'));
  assert.deepEqual([fit.body.exceptions.length, fit.body.booking], [1, 'needs_capacity_exception']);
  const listed = await request(server).get('/api/venue-booking-requests/capacity-exceptions').set(as('venue'));
  assert.deepEqual(listed.body.requests.map((row: { request_id: number }) => row.request_id), [31]);
  const response = await request(server).post('/api/venue-booking-requests/31/capacity-exception').set(as('venue'));
  assert.deepEqual([response.status, response.body.booking], [201, 'allowed']);
  assert.equal(recorded[0].approver_role, 'venue_staff');
});

test('[FAILURE] [SG2-47:AC3] a coordinator cannot approve an exception, even for their own event', async () => {
  const { store, recorded } = fakeStore();
  const composed = app(store);
  for (const user of ['coordinator', 'attendee']) {
    assert.equal((await request(composed).post('/api/venue-booking-requests/31/capacity-exception').set(as(user))).status, 403, user);
  }
  assert.deepEqual(recorded, []);
});

test('[BOUNDARY] [SG2-66:AC5] Venue Staff approving an exception for a malformed or unknown request id are refused without recording one', async () => {
  const { store, recorded } = fakeStore();
  const composed = app(store);
  const malformed = await request(composed).post('/api/venue-booking-requests/0/capacity-exception').set(as('venue'));
  assert.deepEqual([malformed.status, malformed.body], [400, { error: 'Invalid booking request ID.' }]);
  const unknown = await request(composed).post('/api/venue-booking-requests/999/capacity-exception').set(as('venue'));
  assert.deepEqual([unknown.status, unknown.body], [404, { error: 'Booking request not found.' }]);
  assert.deepEqual(recorded, []);
});

test('[FAILURE] [SG2-47:AC2] no exception is permitted for a venue missing a required facility', async () => {
  const { store, recorded } = fakeStore();
  const response = await request(app(store)).post('/api/venue-booking-requests/32/capacity-exception').set(as('venue'));
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'This venue cannot be booked for the event. Missing required facilities: projector, stage. No exception is permitted for a missing facility.');
  assert.deepEqual(recorded, []);
});

test('[CONFLICT] [SG2-47:AC3] [SG2-47:AC5] [SG2-66:AC2] an exception is refused when it is not needed, already covered, or the request is decided without a live booking', async () => {
  const covered: CapacityExceptionRecord = { exception_id: 1, request_id: 31, approved_by: 'user-venue', approver_name: null,
    approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120, approved_at: '2030-06-01T00:00:00.000Z' };
  const decided = 'Only a booking request awaiting a decision, or a booked venue for an event still going ahead, can be given a capacity exception.';
  const cases: [string, ReturnType<typeof fakeStore>, number, string][] = [
    ['fits', fakeStore(), 33, "The event's expected attendance fits this venue, so no capacity exception is needed."],
    ['covered', fakeStore({ exceptions: [covered] }), 31, 'A capacity exception covering this attendance has already been approved.'],
    ['booked and covered', fakeStore({ requests: [booked()], exceptions: [covered] }), 31, 'A capacity exception covering this attendance has already been approved.'],
    ['decided', fakeStore({ requests: [pending({ status: 'approved' })] }), 31, decided],
    ['rejected', fakeStore({ requests: [pending({ status: 'rejected' })] }), 31, decided],
    ['booking released', fakeStore({ requests: [booked({ venue_booking: { status: 'cancelled' } })] }), 31, decided],
    ['event over', fakeStore({ events: [{ ...forum, status: 'completed' }], requests: [booked()] }), 31, decided]
  ];
  for (const [name, { store, recorded }, id, error] of cases) {
    const response = await request(app(store)).post(`/api/venue-booking-requests/${id}/capacity-exception`).set(as('venue'));
    assert.deepEqual([response.status, response.body], [409, { error }], name);
    assert.deepEqual(recorded, [], name);
  }
});

test('[CONFLICT] [SG2-47:AC3] two approvers acting at once record one exception; the other is told it is already approved', async () => {
  const { store, recorded } = fakeStore();
  // Hold both requests after they have read "no exception yet", so both
  // reach the insert: only the database's uniqueness can stop the second.
  const read = store.exceptions;
  let arrived = 0;
  let release!: () => void;
  const bothRead = new Promise<void>(resolve => { release = resolve; });
  store.exceptions = async id => {
    const rows = await read(id);
    if (++arrived === 2) release();
    await bothRead;
    return rows;
  };
  const composed = app(store);
  const responses = await Promise.all(['venue', 'other_venue'].map(user =>
    request(composed).post('/api/venue-booking-requests/31/capacity-exception').set(as(user))));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.deepEqual(responses.find(response => response.status === 409)!.body,
    { error: 'A capacity exception covering this attendance has already been approved.' });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].expected_attendance, 150);
});

test('[BOUNDARY] [SG2-47:AC3] an exception for a lower attendance does not cover a rise; a new approval is recorded', async () => {
  const { store, recorded } = fakeStore({ exceptions: [{ exception_id: 1, request_id: 31, approved_by: 'user-venue', approver_name: null,
    approver_role: 'venue_staff', expected_attendance: 130, venue_capacity: 120, approved_at: '2030-06-01T00:00:00.000Z' }] });
  const response = await request(app(store)).post('/api/venue-booking-requests/31/capacity-exception').set(as('venue'));
  assert.equal(response.status, 201);
  assert.equal(recorded[0].expected_attendance, 150);
});
