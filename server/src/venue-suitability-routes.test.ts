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
  support: { userId: 'user-support', role: 'technical_support_staff' },
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
  status: 'pending', ...overrides
});

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
    async event(id) { return events.find(event => event.event_id === id) ?? null; },
    async venues(id) {
      return venues.filter(venue => id === undefined || venue.venue_id === id).sort((a, b) => a.name.localeCompare(b.name));
    },
    async request(id) { return requests.find(row => row.request_id === id) ?? null; },
    async exceptions(id) { return exceptions.filter(row => row.request_id === id); },
    async recordException(values) {
      // Mirrors the unique (request_id, expected_attendance) index.
      if (exceptions.some(row => row.request_id === values.request_id && row.expected_attendance === values.expected_attendance)) return null;
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

test('[NORMAL] [FAILURE] [SG2-47:AC3] Technical Support Staff and the event\'s own organiser may also approve', async () => {
  for (const user of ['support', 'organiser']) {
    const { store, recorded } = fakeStore();
    const response = await request(app(store)).post('/api/venue-booking-requests/31/capacity-exception').set(as(user));
    assert.equal(response.status, 201, user);
    assert.equal(recorded[0].approver_role, USERS[user].role);
  }
  const { store, recorded } = fakeStore();
  const response = await request(app(store)).post('/api/venue-booking-requests/31/capacity-exception').set(as('other_organiser'));
  assert.equal(response.status, 404);
  assert.deepEqual(recorded, []);
});

test('[FAILURE] [SG2-47:AC3] a coordinator cannot approve an exception, even for their own event', async () => {
  const { store, recorded } = fakeStore();
  const composed = app(store);
  for (const user of ['coordinator', 'attendee']) {
    assert.equal((await request(composed).post('/api/venue-booking-requests/31/capacity-exception').set(as(user))).status, 403, user);
  }
  assert.deepEqual(recorded, []);
});

test('[FAILURE] [SG2-47:AC2] no exception is permitted for a venue missing a required facility', async () => {
  const { store, recorded } = fakeStore();
  const response = await request(app(store)).post('/api/venue-booking-requests/32/capacity-exception').set(as('venue'));
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'This venue cannot be booked for the event. Missing required facilities: projector, stage. No exception is permitted for a missing facility.');
  assert.deepEqual(recorded, []);
});

test('[CONFLICT] [SG2-47:AC3] [SG2-47:AC5] an exception is refused when it is not needed, already covered or the request is decided', async () => {
  const covered: CapacityExceptionRecord = { exception_id: 1, request_id: 31, approved_by: 'user-venue', approver_name: null,
    approver_role: 'venue_staff', expected_attendance: 150, venue_capacity: 120, approved_at: '2030-06-01T00:00:00.000Z' };
  const cases: [string, ReturnType<typeof fakeStore>, number, string][] = [
    ['fits', fakeStore(), 33, "The event's expected attendance fits this venue, so no capacity exception is needed."],
    ['covered', fakeStore({ exceptions: [covered] }), 31, 'A capacity exception covering this attendance has already been approved.'],
    ['decided', fakeStore({ requests: [pending({ status: 'approved' })] }), 31, 'Only a booking request awaiting a decision can be given a capacity exception.']
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
  const responses = await Promise.all(['venue', 'support'].map(user =>
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
  const response = await request(app(store)).post('/api/venue-booking-requests/31/capacity-exception').set(as('support'));
  assert.equal(response.status, 201);
  assert.equal(recorded[0].expected_attendance, 150);
});
