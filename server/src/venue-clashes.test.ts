import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, AccessError, type Principal } from './auth';
import { dbConfig } from './db';
import type { ClashBookingRow, ClashRow, VenueClashStore } from './db/venueClashes';
import { createVenueClashesRouter, type VenueClashDependencies } from './venues/clashes';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const USERS: Record<string, Principal> = {
  venue: { userId: 'user-venue', role: 'venue_staff' },
  coordinator: { userId: 'user-coordinator', role: 'event_coordinator' },
  other_coordinator: { userId: 'user-other-coordinator', role: 'event_coordinator' },
  organiser: { userId: 'user-organiser', role: 'event_organiser' },
  support: { userId: 'user-support', role: 'technical_support_staff' },
  attendee: { userId: 'user-attendee', role: 'attendee' }
};

/** Morning Summit (the coordinator's) and Afternoon Forum (another
 * coordinator's) sit 30 minutes apart at Clash Hall, which needs 75. */
const summit: ClashBookingRow = { booking_id: 11, venue_id: 1, venue_name: 'Clash Hall', event_id: 7, event_name: 'Morning Summit',
  starts_at: '2030-10-01T02:00:00.000Z', ends_at: '2030-10-01T04:00:00.000Z', coordinator_id: 'user-coordinator' };
const forum: ClashBookingRow = { booking_id: 12, venue_id: 1, venue_name: 'Clash Hall', event_id: 8, event_name: 'Afternoon Forum',
  starts_at: '2030-10-01T04:30:00.000Z', ends_at: '2030-10-01T05:30:00.000Z', coordinator_id: 'user-other-coordinator' };
/** The coordinator's own two events also clash at Clash Room. */
const lunch: ClashBookingRow = { booking_id: 13, venue_id: 2, venue_name: 'Clash Room', event_id: 9, event_name: 'Board Lunch',
  starts_at: '2030-10-02T04:10:00.000Z', ends_at: '2030-10-02T05:00:00.000Z', coordinator_id: 'user-coordinator' };
const breakfast: ClashBookingRow = { ...lunch, booking_id: 14, event_id: 10, event_name: 'Breakfast Talk',
  starts_at: '2030-10-02T02:00:00.000Z', ends_at: '2030-10-02T04:00:00.000Z' };
const FLAGGED = '2030-01-01T00:00:00.000Z';
const rows: ClashRow[] = [
  { booking: summit, clashes_with: forum, flagged_at: FLAGGED }, { booking: forum, clashes_with: summit, flagged_at: FLAGGED },
  { booking: breakfast, clashes_with: lunch, flagged_at: FLAGGED }, { booking: lunch, clashes_with: breakfast, flagged_at: FLAGGED }
];
const shown = ({ coordinator_id: _c, ...booking }: ClashBookingRow) => booking;

function app(dependencies: VenueClashDependencies) {
  const access = createAuthorization({
    resolvePrincipal: async token => { const user = USERS[token]; if (!user) throw new AccessError(401); return user; }
  });
  const composed = express();
  composed.use('/api/venue-clashes', createVenueClashesRouter(access, dependencies));
  return composed;
}
const withRows = (list: ClashRow[]) => app({ getAdminClient: () => ({}) as SupabaseClient, store: () => ({ list: async () => list }) });
const get = (composed: express.Express, user?: string) => {
  const call = request(composed).get('/api/venue-clashes');
  return user ? call.set('Authorization', `Bearer ${user}`) : call;
};

test('[NORMAL] [SG2-79:AC3] Venue Staff see every flagged booking and the booking it clashes with, by event, uncached', async () => {
  const response = await get(withRows(rows), 'venue');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, { clashes: rows.map(row => ({ booking: shown(row.booking), clashes_with: shown(row.clashes_with), flagged_at: FLAGGED })) });
});

test('[NORMAL] [SG2-79:AC3] a coordinator sees only their own events\' flagged bookings, and another coordinator\'s event without its name', async () => {
  const response = await get(withRows(rows), 'coordinator');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.clashes, [
    { booking: shown(summit), clashes_with: { ...shown(forum), event_id: null, event_name: null }, flagged_at: FLAGGED },
    { booking: shown(breakfast), clashes_with: shown(lunch), flagged_at: FLAGGED },
    { booking: shown(lunch), clashes_with: shown(breakfast), flagged_at: FLAGGED }
  ]);
  const other = await get(withRows(rows), 'other_coordinator');
  assert.deepEqual(other.body.clashes.map((row: { booking: { booking_id: number } }) => row.booking.booking_id), [12]);
});

test('[BOUNDARY] [SG2-79:AC3] with nothing flagged, or nothing flagged for the coordinator, the list is empty', async () => {
  assert.deepEqual((await get(withRows([]), 'venue')).body, { clashes: [] });
  assert.deepEqual((await get(withRows([rows[0]]), 'other_coordinator')).body, { clashes: [] });
});

test('[FAILURE] [SG2-79:AC3] organisers, Technical Support Staff and attendees cannot see clashes, and nobody can without signing in', async () => {
  const composed = withRows(rows);
  for (const user of ['organiser', 'support', 'attendee']) assert.equal((await get(composed, user)).status, 403, user);
  assert.equal((await get(composed)).status, 401);
});

test('[FAILURE] [SG2-79:AC3] an unconfigured or failing database is reported as unavailable without details', async () => {
  assert.equal((await get(app({ getAdminClient: () => null }), 'venue')).status, 503);
  assert.equal((await get(app({}), 'venue')).status, 503);
  for (const error of [new Error('db password in message'), new AccessError(503)]) {
    const failing = app({ getAdminClient: () => ({}) as SupabaseClient, store: (): VenueClashStore => ({ list: async () => { throw error; } }) });
    const response = await get(failing, 'venue');
    assert.deepEqual([response.status, response.body], [503, { error: new AccessError(503).message }]);
  }
});
