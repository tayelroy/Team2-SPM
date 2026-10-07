import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, AccessError, type Principal } from './auth';
import { dbConfig } from './db';
import type { BookingRequestRow, SuitabilityEventRow, SuitabilityVenueRow } from './db/venueSuitability';
import type { NewVenueBookingRequest, VenueBookingRequestRecord, VenueBookingRequestStore } from './db/venueBookingRequests';
import type { ConflictOptions, ConflictPeriod, VenueConflictRow, VenueConflictStore } from './db/venueConflicts';
import { createVenueBookingRequestsRouter } from './venues/bookingRequests';
import { createVenueConflictsRouter, type VenueConflictDependencies } from './venues/conflicts';
import type { DecisionResult, VenueBookingDecisionStore } from './db/venueBookingDecisions';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const NOW = Date.parse('2030-01-01T00:00:00.000Z');

const USERS: Record<string, Principal> = {
  coordinator: { userId: 'user-coordinator', role: 'event_coordinator' },
  other_coordinator: { userId: 'user-other-coordinator', role: 'event_coordinator' },
  venue: { userId: 'user-venue', role: 'venue_staff' },
  organiser: { userId: 'user-organiser', role: 'event_organiser' },
  support: { userId: 'user-support', role: 'technical_support_staff' },
  attendee: { userId: 'user-attendee', role: 'attendee' }
};

const forum: SuitabilityEventRow = {
  event_id: 7, name: 'Leadership Forum', organiser_id: 'user-organiser', coordinator_id: 'user-coordinator',
  status: 'approved', expected_attendance: 150, venue_requirements: 'A stage', accessibility_needs: null
};
const atrium: SuitabilityVenueRow = { venue_id: 1, name: 'Atrium Hall', location: 'Level 1', capacity: 400,
  facilities: 'Stage', accessibility_features: 'Step-free' };

/** Gala Night (another coordinator's event) holds Atrium Hall 10:00–18:00 SGT. */
const gala: VenueConflictRow = { kind: 'booking', reference_id: 12, event_id: 9, event_name: 'Gala Night', coordinator_id: 'user-other-coordinator',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', status: 'confirmed' };
/** A tentative hold on the same venue for the coordinator's own event 8. */
const ownHold: VenueConflictRow = { kind: 'hold', reference_id: 3, event_id: 8, event_name: 'Partner Lunch', coordinator_id: 'user-coordinator',
  starts_at: '2030-06-15T09:00:00.000Z', ends_at: '2030-06-15T12:00:00.000Z', status: 'tentative' };

const period = { starts_at: '2030-06-15T08:00:00.000Z', ends_at: '2030-06-15T11:00:00.000Z' };
const pending: BookingRequestRow = { request_id: 41, event_id: 7, venue_id: 1, ...period, status: 'pending' };
const pendingRecord: VenueBookingRequestRecord = { ...pending, venue_name: 'Atrium Hall', layout: 'theatre', venue_requirements: 'A stage',
  requester_name: 'Casey', requested_at: '2030-01-01T00:00:00.000Z', decider_name: null, decided_at: null, decision_reason: null };

function overlapping(rows: VenueConflictRow[], at: ConflictPeriod) {
  return rows.filter(row => row.starts_at < at.ends_at && row.ends_at > at.starts_at);
}

function access() {
  return createAuthorization({
    resolvePrincipal: async token => { const user = USERS[token]; if (!user) throw new AccessError(401); return user; }
  });
}

const as = (user: string) => ({ Authorization: `Bearer ${user}` });

// --- Reported when the request is made (POST /api/venue-booking-requests) -----

function requestStore(occupied: VenueConflictRow[]) {
  const checked: [ConflictPeriod, ConflictOptions][] = [];
  const store: VenueBookingRequestStore = {
    async event(id) { return id === forum.event_id ? forum : null; },
    async venue(id) { return id === atrium.venue_id ? atrium : null; },
    async layouts() { return ['theatre']; },
    async duplicate() { return null; },
    async create(values: NewVenueBookingRequest): Promise<VenueBookingRequestRecord> {
      const { requested_by: _requester, ...rest } = values;
      return { ...rest, request_id: 41, status: 'pending', venue_name: 'Atrium Hall', requester_name: 'Casey', requested_at: '2030-01-01T00:00:00.000Z',
        decider_name: null, decided_at: null, decision_reason: null };
    },
    async list() { return []; },
    async request(id) { return id === 41 ? { ...pendingRecord } : null; },
    async hold() { return null; },
    async exceptions() { return []; },
    async conflicts(at, options) {
      checked.push([at, options]);
      return overlapping(occupied, at);
    }
  };
  const composed = express();
  composed.use(express.json());
  composed.use('/api/venue-booking-requests', createVenueBookingRequestsRouter(access(), {
    getAdminClient: () => ({}) as SupabaseClient, store: () => store, now: () => NOW
  }));
  return { composed, checked, store };
}

const submit = (composed: express.Express, at = period) => request(composed).post('/api/venue-booking-requests').set(as('coordinator'))
  .send({ event_id: 7, venue_id: 1, layout: 'theatre', ...at });

test('[NORMAL] [SG2-50:AC1] a request overlapping another event\'s confirmed booking is made but reports the conflict, naming the booking', async () => {
  const { composed, checked } = requestStore([gala]);
  const response = await submit(composed);
  assert.equal(response.status, 201);
  assert.equal(response.body.request.status, 'pending');
  // Another coordinator's event: the coordinator learns the booking, not the event.
  assert.deepEqual(response.body.conflicts, [{ kind: 'booking', reference_id: 12, event_id: null, event_name: null,
    starts_at: gala.starts_at, ends_at: gala.ends_at, status: 'confirmed' }]);
  assert.deepEqual(checked, [[{ ...pending, layout: 'theatre', venue_name: 'Atrium Hall', requester_name: 'Casey',
    requested_at: '2030-01-01T00:00:00.000Z', venue_requirements: 'A stage', decider_name: null, decided_at: null, decision_reason: null }, { now: '2030-01-01T00:00:00.000Z', excludeRequestId: 41 }]]);
});

test('[NORMAL] [SG2-50:AC1] a coordinator sees which of their own events holds the venue', async () => {
  const response = await submit(requestStore([ownHold]).composed);
  assert.equal(response.status, 201);
  assert.deepEqual(response.body.conflicts.map((row: { event_name: string; kind: string }) => [row.kind, row.event_name]), [['hold', 'Partner Lunch']]);
});

test('[BOUNDARY] [SG2-50:AC1] a request ending as the booking starts, or starting as it ends, reports no conflict; one minute of overlap does', async () => {
  const { composed } = requestStore([gala]);
  for (const at of [
    { starts_at: '2030-06-15T00:00:00.000Z', ends_at: gala.starts_at },
    { starts_at: gala.ends_at, ends_at: '2030-06-15T12:00:00.000Z' }
  ]) {
    assert.deepEqual((await submit(composed, at)).body.conflicts, [], at.starts_at);
  }
  const touching = await submit(composed, { starts_at: '2030-06-15T00:00:00.000Z', ends_at: '2030-06-15T02:01:00.000Z' });
  assert.deepEqual(touching.body.conflicts.map((row: { reference_id: number }) => row.reference_id), [12]);
});

// --- GET /api/venue-booking-requests/:requestId/conflicts ---------------------

function conflictStore(seed: { requests?: BookingRequestRow[]; occupied?: VenueConflictRow[]; fail?: Error } = {}) {
  const requests = seed.requests ?? [pending];
  const checked: ConflictOptions[] = [];
  const store: VenueConflictStore = {
    async request(id) { if (seed.fail) throw seed.fail; return requests.find(row => row.request_id === id) ?? null; },
    async event(id) { return id === forum.event_id ? forum : null; },
    async conflicts(at, options) { checked.push(options); return overlapping(seed.occupied ?? [gala, ownHold], at); }
  };
  return { store, checked };
}

function conflictsApp(store: VenueConflictStore | null, dependencies: VenueConflictDependencies = {}) {
  const deps: VenueConflictDependencies = store
    ? { getAdminClient: () => ({}) as SupabaseClient, store: () => store, now: () => NOW, ...dependencies }
    : dependencies;
  const composed = express();
  composed.use('/api/venue-booking-requests', createVenueConflictsRouter(access(), deps));
  return composed;
}

const conflictsOf = (composed: express.Express, user: string, id: string | number = 41) =>
  request(composed).get(`/api/venue-booking-requests/${id}/conflicts`).set(as(user));

test('[NORMAL] [SG2-50:AC1] Venue Staff see every booking and hold a pending request overlaps, earliest first, with the events by name', async () => {
  const { store, checked } = conflictStore();
  const response = await conflictsOf(conflictsApp(store), 'venue');
  assert.equal(response.status, 200);
  const strip = ({ coordinator_id: _coordinator, ...row }: VenueConflictRow) => row;
  assert.deepEqual(response.body, { request_id: 41, status: 'pending', conflicts: [strip(gala), strip(ownHold)] });
  // The request's own tentative hold (SG2-84) is never its own conflict.
  assert.deepEqual(checked, [{ now: '2030-01-01T00:00:00.000Z', excludeRequestId: 41 }]);
});

test('[NORMAL] [SG2-50:AC1] the assigned coordinator sees the conflicts too, but only their own events by name', async () => {
  const response = await conflictsOf(conflictsApp(conflictStore().store), 'coordinator');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.conflicts.map((row: { event_id: number | null; event_name: string | null }) => [row.event_id, row.event_name]),
    [[null, null], [8, 'Partner Lunch']]);
});

test('[NORMAL] [SG2-50:AC3] a request already decided no longer competes for the venue and reports no conflicts', async () => {
  for (const status of ['approved', 'rejected', 'cancelled']) {
    const { store, checked } = conflictStore({ requests: [{ ...pending, status }] });
    const response = await conflictsOf(conflictsApp(store), 'venue');
    assert.deepEqual([response.status, response.body], [200, { request_id: 41, status, conflicts: [] }], status);
    assert.equal(checked.length, 0);
  }
});

test('[FAILURE] [SG2-50:AC1] a request for an event the coordinator is not assigned to, or that does not exist, is reported missing', async () => {
  const composed = conflictsApp(conflictStore({ requests: [pending, { ...pending, request_id: 42, event_id: 99 }] }).store);
  for (const [user, id] of [['other_coordinator', 41], ['venue', 404], ['venue', 42]] as const) {
    const response = await conflictsOf(composed, user, id);
    assert.deepEqual([response.status, response.body], [404, { error: 'Booking request not found.' }], `${user} ${id}`);
  }
});

test('[FAILURE] [SG2-50:AC1] organisers, attendees and Technical Support Staff cannot read conflicts, and nobody can without signing in', async () => {
  const composed = conflictsApp(conflictStore().store);
  for (const user of ['organiser', 'support', 'attendee'] satisfies (keyof typeof USERS)[]) {
    assert.equal((await conflictsOf(composed, user)).status, 403, user);
  }
  assert.equal((await request(composed).get('/api/venue-booking-requests/41/conflicts')).status, 401);
});

test('[BOUNDARY] [SG2-50:AC1] request IDs must be positive whole numbers that fit the database', async () => {
  const composed = conflictsApp(conflictStore().store);
  for (const id of ['0', '-1', 'abc', '1.5', '2147483648']) {
    assert.deepEqual([(await conflictsOf(composed, 'venue', id)).status], [400], id);
  }
  // The largest ID the database holds is accepted and simply not found.
  assert.equal((await conflictsOf(composed, 'venue', '2147483647')).status, 404);
});

test('[FAILURE] [SG2-50:AC1] an unconfigured or failing database is reported as temporarily unavailable without details', async () => {
  assert.equal((await conflictsOf(conflictsApp(null, { getAdminClient: () => null }), 'venue')).status, 503);
  for (const fail of [new Error('db password in message'), new AccessError(503)]) {
    const response = await conflictsOf(conflictsApp(conflictStore({ fail }).store), 'venue');
    assert.deepEqual([response.status, response.body], [503, { error: new AccessError(503).message }]);
  }
});

test('[FAILURE] [SG2-50:AC1] without injected dependencies the route uses the configured database, and reports it unavailable when there is none', async () => {
  assert.equal((await conflictsOf(conflictsApp(null), 'venue')).status, 503);
});

// --- SG2-50 AC2: approval refused while the conflict stands --------------------
//
// Approval is SG2-49's POST /:requestId/decision. Its database function refuses
// a confirmed booking or live hold over the period under the venue lock; that
// is proven on the real function in supabase/tests/venue_double_booking.sql.
// Here the database answers as that function does, from what occupies the venue.

function decisionApp(occupied: VenueConflictRow[]) {
  const decided: number[] = [];
  const decisions = (): VenueBookingDecisionStore => ({
    async decide(requestId, decision): Promise<DecisionResult> {
      const clash = decision === 'approve' ? overlapping(occupied, pending)[0] : undefined;
      if (clash) {
        return { outcome: 'conflict', kind: clash.kind, starts_at: clash.starts_at, ends_at: clash.ends_at, label: clash.event_name ?? 'Untitled event' };
      }
      decided.push(requestId);
      return { outcome: 'updated', request_id: requestId, status: 'approved', venue_booking_id: 90, decided_at: '2030-01-01T00:00:00.000Z' };
    }
  });
  const { store } = requestStore(occupied);
  const composed = express();
  composed.use(express.json());
  composed.use('/api/venue-booking-requests', createVenueBookingRequestsRouter(access(), {
    getAdminClient: () => ({}) as SupabaseClient, store: () => store, now: () => NOW, decisions
  }));
  return { composed, decided, occupied };
}

const approve = (composed: express.Express) =>
  request(composed).post('/api/venue-booking-requests/41/decision').set(as('venue')).send({ decision: 'approve' });

test('[CONFLICT] [SG2-50:AC2] Venue Staff approving a request that overlaps a confirmed booking are refused, naming it, and nothing is decided', async () => {
  const { composed, decided } = decisionApp([gala]);
  const response = await approve(composed);
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: 'Atrium Hall is already booked for Gala Night during this period.',
    conflict: { kind: 'booking', starts_at: gala.starts_at, ends_at: gala.ends_at, label: 'Gala Night' }
  });
  assert.deepEqual(decided, []);
});

test('[CONFLICT] [SG2-50:AC2] a live tentative hold over the period refuses approval too', async () => {
  const response = await approve(decisionApp([ownHold]).composed);
  assert.deepEqual([response.status, response.body.error], [409, 'Atrium Hall is on a tentative hold for Partner Lunch during this period.']);
});

test('[NORMAL] [SG2-50:AC2] [SG2-50:AC3] once the conflicting booking is released the same request is approved', async () => {
  const state = decisionApp([gala]);
  assert.equal((await approve(state.composed)).status, 409);
  // The booking no longer commits the venue.
  state.occupied.length = 0;
  const response = await approve(state.composed);
  assert.equal(response.status, 200);
  assert.deepEqual(state.decided, [41]);
});
