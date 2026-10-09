import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, AccessError, type Principal } from './auth';
import { dbConfig } from './db';
import type { SuitabilityEventRow } from './db/venueSuitability';
import type { ReleaseResult, VenueBookingRecord, VenueBookingStore } from './db/venueBookings';
import { createVenueBookingsRouter, validateReleaseReason, type VenueBookingDependencies } from './venues/bookings';

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

const summit: SuitabilityEventRow = {
  event_id: 7, name: 'Leadership Summit', organiser_id: 'user-organiser', coordinator_id: 'user-coordinator',
  status: 'planning', expected_attendance: 150, venue_requirements: null, accessibility_needs: null
};

/** The summit holds two venues (Week 7 change #3). */
const hall: VenueBookingRecord = { booking_id: 11, venue_id: 1, venue_name: 'Atrium Hall', event_id: 7, event_name: 'Leadership Summit',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', status: 'confirmed',
  cancelled_at: null, cancellation_reason: null, canceller_name: null };
const annex: VenueBookingRecord = { ...hall, booking_id: 12, venue_id: 2, venue_name: 'Annex' };

function fixture(seed: { results?: ReleaseResult[]; fail?: Error } = {}) {
  const released: [string, number, string][] = [];
  const asked: unknown[][] = [];
  const store: VenueBookingStore = {
    async event(id) { if (seed.fail) throw seed.fail; return id === summit.event_id ? summit : null; },
    async venueExists(id) { return id === 1 || id === 2; },
    async forEvent(id) { asked.push(['event', id]); return [hall, annex]; },
    async forVenue(id, now) { asked.push(['venue', id, now]); return [hall]; }
  };
  const results = seed.results ?? [{ outcome: 'released', booking_id: 11, cancelled_at: '2030-01-01T00:00:00.000Z' }];
  const deps: VenueBookingDependencies = {
    getAdminClient: () => ({}) as SupabaseClient, store: () => store, now: () => NOW,
    releases: token => ({
      async release(bookingId, reason) {
        released.push([token, bookingId, reason]);
        return results.shift()!;
      }
    })
  };
  return { composed: compose(deps), released, asked };
}

function compose(deps: VenueBookingDependencies) {
  const access = createAuthorization({
    resolvePrincipal: async token => { const user = USERS[token]; if (!user) throw new AccessError(401); return user; }
  });
  const composed = express();
  composed.use(express.json());
  composed.use('/api/venue-bookings', createVenueBookingsRouter(access, deps));
  return composed;
}

const as = (user: string) => ({ Authorization: `Bearer ${user}` });
const release = (composed: express.Express, user: string, body: unknown, id: string | number = 11) =>
  request(composed).post(`/api/venue-bookings/${id}/release`).set(as(user)).send(body as object);

// --- POST /:bookingId/release ---------------------------------------------------

test('[NORMAL] [SG2-51:AC1] [SG2-51:AC5] the assigned coordinator releases a booking with a reason, as themselves', async () => {
  const { composed, released } = fixture();
  const response = await release(composed, 'coordinator', { reason: '  The workshop moved online  ' });
  assert.deepEqual([response.status, response.body], [200, {
    booking_id: 11, status: 'cancelled', cancelled_at: '2030-01-01T00:00:00.000Z', cancellation_reason: 'The workshop moved online'
  }]);
  // The database records the caller, so it runs with their own token.
  assert.deepEqual(released, [['coordinator', 11, 'The workshop moved online']]);
});

test('[NORMAL] [SG2-51:AC1] Venue Staff release a booking too', async () => {
  const { composed, released } = fixture();
  assert.equal((await release(composed, 'venue', { reason: 'Burst pipe' })).status, 200);
  assert.deepEqual(released, [['venue', 11, 'Burst pipe']]);
});

test('[BOUNDARY] [SG2-51:AC1] a reason is required and may be 500 characters but not 501', async () => {
  const { composed, released } = fixture({ results: [{ outcome: 'released', booking_id: 11, cancelled_at: '2030-01-01T00:00:00.000Z' }] });
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 42 }, { reason: '🚪'.repeat(501) }, [], null]) {
    const response = await release(composed, 'venue', body);
    assert.deepEqual([response.status, response.body.error], [400, 'Give a reason for releasing this booking, in 500 characters or fewer.'], JSON.stringify(body));
  }
  assert.equal((await release(composed, 'venue', { reason: '🚪'.repeat(500) })).status, 200);
  assert.equal(released.length, 1);
  assert.equal(validateReleaseReason('not an object'), null);
});

test('[CONFLICT] [SG2-51:AC1] a booking already released, held or over is not released again', async () => {
  const { composed } = fixture({ results: [
    { outcome: 'inactive', status: 'cancelled' }, { outcome: 'inactive', status: 'held' }, { outcome: 'past' }
  ] });
  const answers = [];
  for (let i = 0; i < 3; i += 1) {
    const response = await release(composed, 'venue', { reason: 'No longer needed' });
    answers.push([response.status, response.body.error]);
  }
  assert.deepEqual(answers, [
    [409, 'This booking has already been released.'],
    [409, 'Only a confirmed booking can be released.'],
    [409, 'This booking has already ended, so there is nothing to release.']
  ]);
});

test('[FAILURE] [SG2-51:AC1] an unknown booking, or one for another coordinator\'s event, is reported missing; a bad ID is refused', async () => {
  const { composed } = fixture({ results: [{ outcome: 'missing' }, { outcome: 'invalid' }] });
  assert.deepEqual([(await release(composed, 'other_coordinator', { reason: 'Mine now' })).status], [404]);
  // The database's own reason check answers like the API's.
  assert.equal((await release(composed, 'venue', { reason: 'x' })).status, 400);
  for (const id of ['0', 'abc', '2147483648']) {
    assert.equal((await release(composed, 'venue', { reason: 'x' }, id)).status, 400, id);
  }
});

test('[FAILURE] [SG2-51:AC1] organisers, attendees and Technical Support Staff cannot release, and nobody can without signing in', async () => {
  const { composed, released } = fixture();
  for (const user of ['organiser', 'support', 'attendee']) {
    assert.equal((await release(composed, user, { reason: 'x' })).status, 403, user);
  }
  assert.equal((await request(composed).post('/api/venue-bookings/11/release').send({ reason: 'x' })).status, 401);
  assert.deepEqual(released, []);
});

test('[FAILURE] [SG2-51:AC1] a refused or failing release is reported without details', async () => {
  for (const [error, status] of [[new AccessError(403), 403], [new Error('db password in message'), 503]] as const) {
    const composed = compose({
      getAdminClient: () => ({}) as SupabaseClient, store: () => ({}) as VenueBookingStore,
      releases: () => ({ async release() { throw error; } })
    });
    const response = await release(composed, 'venue', { reason: 'x' });
    assert.deepEqual([response.status, response.body], [status, { error: new AccessError(status).message }]);
  }
  // Without a configured database the default release store is unavailable.
  const unconfigured = compose({ getAdminClient: () => ({}) as SupabaseClient, store: () => ({}) as VenueBookingStore });
  assert.equal((await release(unconfigured, 'venue', { reason: 'x' })).status, 503);
});

// --- GET /?event_id= and /?venue_id= ---------------------------------------------

test('[NORMAL] [SG2-51:AC3] an event with several venues lists each booking, for its coordinator and Venue Staff', async () => {
  for (const user of ['coordinator', 'venue']) {
    const { composed, asked } = fixture();
    const response = await request(composed).get('/api/venue-bookings?event_id=7').set(as(user));
    assert.deepEqual([response.status, response.body], [200, { bookings: [hall, annex] }], user);
    assert.deepEqual(asked, [['event', 7]]);
  }
});

test('[NORMAL] [SG2-51:AC2] Venue Staff list a venue\'s bookings that are not yet over', async () => {
  const { composed, asked } = fixture();
  const response = await request(composed).get('/api/venue-bookings?venue_id=1').set(as('venue'));
  assert.deepEqual([response.status, response.body], [200, { bookings: [hall] }]);
  assert.deepEqual(asked, [['venue', 1, '2030-01-01T00:00:00.000Z']]);
});

test('[FAILURE] [SG2-51:AC1] bookings are hidden from other coordinators, other roles and for unknown events or venues', async () => {
  const { composed, asked } = fixture();
  const get = (query: string, user: string) => request(composed).get(`/api/venue-bookings?${query}`).set(as(user));
  assert.deepEqual([(await get('event_id=7', 'other_coordinator')).status, (await get('event_id=8', 'venue')).status], [404, 404]);
  assert.equal((await get('venue_id=1', 'coordinator')).status, 403);
  assert.equal((await get('venue_id=9', 'venue')).status, 404);
  for (const user of ['organiser', 'support', 'attendee']) assert.equal((await get('event_id=7', user)).status, 403, user);
  assert.deepEqual(asked, []);
});

test('[BOUNDARY] [SG2-51:AC1] exactly one of event_id or venue_id is needed, as a positive whole number', async () => {
  const { composed } = fixture();
  for (const query of ['', 'event_id=7&venue_id=1', 'event_id=0', 'venue_id=abc', 'event_id=2147483648']) {
    assert.equal((await request(composed).get(`/api/venue-bookings?${query}`).set(as('venue'))).status, 400, query);
  }
  assert.equal((await request(composed).get('/api/venue-bookings?event_id=2147483647').set(as('venue'))).status, 404);
});

test('[FAILURE] [SG2-51:AC1] listing fails safely when the database is unconfigured or failing', async () => {
  assert.equal((await request(compose({ getAdminClient: () => null })).get('/api/venue-bookings?event_id=7').set(as('venue'))).status, 503);
  assert.equal((await request(compose({})).get('/api/venue-bookings?event_id=7').set(as('venue'))).status, 503);
  const { composed } = fixture({ fail: new Error('offline') });
  const response = await request(composed).get('/api/venue-bookings?event_id=7').set(as('venue'));
  assert.deepEqual([response.status, response.body], [503, { error: new AccessError(503).message }]);
});
