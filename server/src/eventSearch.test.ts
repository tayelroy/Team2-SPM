import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { AccessError, createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createEventSearchRouter, parseSearchFilters } from './eventSearch';
import type { EventSearchFilters, EventSearchOptions, EventSearchPage, EventSearchStore } from './db/eventSearch';

const NO_FILTERS: EventSearchFilters = {
  query: null, date_from: null, date_to: null, status: null, venue_id: null, category: null, coordinator_id: null
};
const page: EventSearchPage = {
  events: [{ event_id: 7, name: 'Harbour Gala', organisation: 'Harbour Foundation', category: 'social', status: 'planning',
    proposed_date: '2031-11-01T02:00:00Z', coordinator_id: 'c0000000-0000-4000-8000-000000000001',
    coordinator_name: 'Alice', venues: ['Atrium'] }],
  truncated: false,
  filters: { ...NO_FILTERS, query: 'harbour' }
};
const options: EventSearchOptions = {
  venues: [{ venue_id: 1, name: 'Atrium' }], coordinators: [{ user_id: 'c0000000-0000-4000-8000-000000000001', name: 'Alice' }]
};
const auth = { Authorization: 'Bearer staff-token' };
const COORDINATOR = 'c0000000-0000-4000-8000-000000000001';

function fixture(role: Role = 'event_coordinator', overrides: Partial<EventSearchStore> = {}) {
  const searched: EventSearchFilters[] = [];
  let optionReads = 0;
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'staff-1', role }) });
  const store = (token: string): EventSearchStore => {
    assert.equal(token, 'staff-token');
    return {
      search: overrides.search ?? (async (filters) => { searched.push(filters); return page; }),
      options: overrides.options ?? (async () => { optionReads++; return options; })
    };
  };
  const router = createEventSearchRouter(access, store);
  return { app: express().use('/api/event-search', router), router, access, searched, optionReads: () => optionReads };
}

test('[NORMAL] [SG2-70:AC1] an internal user searches by name or organisation and gets each match with its details', async () => {
  const { app, searched } = fixture();
  const response = await request(app).get('/api/event-search').query({ q: '  harbour ' }).set(auth);
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, page);
  assert.deepEqual(searched, [{ ...NO_FILTERS, query: 'harbour' }]);
});

test('[NORMAL] [SG2-70:AC2] every filter is passed to the database together', async () => {
  const { app, searched } = fixture();
  const response = await request(app).get('/api/event-search').set(auth).query({
    q: 'gala', from: '2031-11-01', to: '2031-11-30', status: 'planning', venue: '12', category: 'social',
    coordinator: COORDINATOR.toUpperCase()
  });
  assert.equal(response.status, 200);
  assert.deepEqual(searched, [{ query: 'gala', date_from: '2031-11-01', date_to: '2031-11-30', status: 'planning',
    venue_id: 12, category: 'social', coordinator_id: COORDINATOR }]);
});

test('[NORMAL] [SG2-70:AC2] the filter options list the venues and coordinators to choose from', async () => {
  const { app, optionReads } = fixture('venue_staff');
  const response = await request(app).get('/api/event-search/options').set(auth);
  assert.deepEqual([response.status, response.body], [200, options]);
  assert.equal(optionReads(), 1);
});

test('[NORMAL] [SG2-70:AC3] production mounts event search and leaves public health accessible', async () => {
  const { router, access } = fixture();
  const args = Array.from({ length: 39 }, () => undefined) as unknown as Parameters<typeof createApp>;
  args[1] = access; args[38] = router;
  const app = createApp(...args);
  assert.equal((await request(app).get('/api/health')).status, 200);
  const response = await request(app).get('/api/event-search').query({ q: 'harbour' }).set(auth);
  assert.deepEqual([response.status, response.body], [200, page]);
});

test('[BOUNDARY] [SG2-70:AC1] blank values leave their filter out, and a one-day range is allowed', async () => {
  const { app, searched } = fixture();
  await request(app).get('/api/event-search').set(auth).query({ q: '   ', status: '', venue: ' ', from: '2031-11-01', to: '2031-11-01' });
  assert.deepEqual(searched, [{ ...NO_FILTERS, date_from: '2031-11-01', date_to: '2031-11-01' }]);
});

test('[BOUNDARY] [SG2-70:AC1] the search text takes up to 255 characters, counted as the database counts them', async () => {
  const { app, searched } = fixture();
  assert.equal((await request(app).get('/api/event-search').set(auth).query({ q: '😀'.repeat(255) })).status, 200);
  const refused = await request(app).get('/api/event-search').set(auth).query({ q: 'x'.repeat(256) });
  assert.deepEqual([refused.status, refused.body], [400, { error: 'The search text must be 255 characters or fewer.' }]);
  assert.equal(searched.length, 1);
});

test('[BOUNDARY] [SG2-70:AC4] a search with no match is still a 200 with the filters in force, not an error', async () => {
  const empty = { events: [], truncated: false, filters: { ...NO_FILTERS, query: 'nothing', category: 'training' } };
  const { app } = fixture('safety_officer', { search: async () => empty });
  const response = await request(app).get('/api/event-search').set(auth).query({ q: 'nothing', category: 'training' });
  assert.deepEqual([response.status, response.body], [200, empty]);
});

test('[FAILURE] [SG2-70:AC2] malformed filters are refused by name before the database is asked', async () => {
  const { app, searched } = fixture();
  const cases: [Record<string, string | string[]>, string][] = [
    [{ from: '01/11/2031' }, 'from must be a date (YYYY-MM-DD).'],
    [{ to: '2031-02-31' }, 'to must be a date (YYYY-MM-DD).'],
    [{ from: '2031-11-02', to: '2031-11-01' }, 'The start date must not be after the end date.'],
    [{ status: 'awaiting' }, 'Unknown event state.'],
    [{ venue: '0' }, 'venue must be a venue id.'],
    [{ venue: '1.5' }, 'venue must be a venue id.'],
    [{ venue: '99999999999999999999' }, 'venue must be a venue id.'],
    [{ category: 'party' }, 'Unknown event category.'],
    [{ coordinator: 'alice; drop' }, 'coordinator must be a coordinator id.'],
    [{ coordinator: 'a'.repeat(65) }, 'coordinator must be a coordinator id.'],
    [{ q: ['a', 'b'] }, 'Give q at most once.']
  ];
  for (const [query, error] of cases) {
    const response = await request(app).get('/api/event-search').set(auth).query(query);
    assert.deepEqual([response.status, response.body], [400, { error }], JSON.stringify(query));
  }
  assert.equal(searched.length, 0);
});

test('[FAILURE] [SG2-70:AC3] Draft is not a state a search can ask for, since drafts are never found', async () => {
  const { app, searched } = fixture();
  const response = await request(app).get('/api/event-search').set(auth).query({ status: 'draft' });
  assert.deepEqual([response.status, response.body], [400, { error: 'Unknown event state.' }]);
  assert.equal(searched.length, 0);
});

// Independent literal lists (docs/testing.md), not the production INTERNAL_ROLES.
const SEARCHING_ROLES: Role[] = ['event_coordinator', 'venue_staff', 'technical_support_staff', 'event_coordinator_lead', 'safety_officer'];
const REFUSED_ROLES: Role[] = ['event_organiser', 'attendee'];

for (const role of SEARCHING_ROLES) {
  test(`[NORMAL] [SG2-70:AC3] ${role} may search across the system`, async () => {
    const { app } = fixture(role);
    assert.equal((await request(app).get('/api/event-search').set(auth)).status, 200);
  });
}

for (const role of REFUSED_ROLES) {
  test(`[FAILURE] [SG2-70:AC3] ${role} cannot search or read the filter options, even with a forged role header`, async () => {
    const { app, searched, optionReads } = fixture(role);
    for (const path of ['/api/event-search', '/api/event-search/options']) {
      const response = await request(app).get(path).set(auth).set('X-Role', 'event_coordinator');
      assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
    }
    assert.deepEqual([searched.length, optionReads()], [0, 0]);
  });
}

test('[FAILURE] [SG2-70:AC3] unsigned or expired credentials cannot search', async () => {
  const { app, searched } = fixture();
  assert.equal((await request(app).get('/api/event-search')).status, 401);
  const access = createAuthorization({ resolvePrincipal: async () => { throw new AccessError(401); } });
  const expired = express().use('/api/event-search', createEventSearchRouter(access, () => assert.fail('Expired credentials must not reach storage')));
  assert.equal((await request(expired).get('/api/event-search').set(auth)).status, 401);
  assert.equal(searched.length, 0);
});

// The database's acting-role check itself is proven by event_search.sql
// (role-change-refused, acting-organiser-refused); this covers the route's
// handling of that refusal.
test('[CONFLICT] [SG2-70:AC3] when the store refuses an account whose role changed after sign-in, the route answers 403', async () => {
  const refused = async () => { throw new AccessError(403); };
  const { app } = fixture('event_coordinator', { search: refused, options: refused });
  for (const path of ['/api/event-search', '/api/event-search/options']) {
    const response = await request(app).get(path).set(auth);
    assert.deepEqual([response.status, response.body], [403, { error: 'Access denied' }]);
  }
});

test('[FAILURE] [SG2-70:AC1] an unavailable database or unexpected failure answers 503 without detail', async () => {
  for (const failure of [new AccessError(503), new Error('connection string leaked')]) {
    const failing = async () => { throw failure; };
    const { app } = fixture('event_coordinator', { search: failing, options: failing });
    for (const path of ['/api/event-search', '/api/event-search/options']) {
      const response = await request(app).get(path).set(auth);
      assert.deepEqual([response.status, response.body],
        [503, { error: 'Event search is temporarily unavailable. Please try again.' }]);
    }
  }
});

test('[BOUNDARY] [SG2-70:AC2] the parser accepts a leap day and the largest venue id, and refuses the day after', () => {
  const leap = parseSearchFilters({ from: '2032-02-29', venue: String(Number.MAX_SAFE_INTEGER) });
  assert.deepEqual(leap, { ok: true, filters: { ...NO_FILTERS, date_from: '2032-02-29', venue_id: Number.MAX_SAFE_INTEGER } });
  assert.deepEqual(parseSearchFilters({ from: '2031-02-29' }), { ok: false, error: 'from must be a date (YYYY-MM-DD).' });
  assert.deepEqual(parseSearchFilters({ coordinator: 'A'.repeat(64) }),
    { ok: true, filters: { ...NO_FILTERS, coordinator_id: 'a'.repeat(64) } });
});

test('[NORMAL] [SG2-70:AC2] the Unassigned coordinator filter is passed on as unassigned', () => {
  assert.deepEqual(parseSearchFilters({ coordinator: 'Unassigned' }),
    { ok: true, filters: { ...NO_FILTERS, coordinator_id: 'unassigned' } });
});
