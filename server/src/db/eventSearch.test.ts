import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createEventSearchStore, type EventSearchFilters } from './eventSearch';
import { dbConfig } from './config';
import { AccessError } from '../auth';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const filters: EventSearchFilters = {
  query: 'harbour', date_from: '2031-11-01', date_to: '2031-11-30', status: 'planning', venue_id: 4,
  category: 'social', coordinator_id: 'c0000000-0000-4000-8000-000000000001'
};
const event = {
  event_id: 7, name: 'Harbour Gala', organisation: 'Harbour Foundation', category: 'social', status: 'planning',
  proposed_date: '2031-11-01T02:00:00+00:00', coordinator_id: 'c0000000-0000-4000-8000-000000000001',
  coordinator_name: 'Alice', venues: ['Atrium']
};

function client(result: { data?: unknown; error?: unknown; status?: number }, calls: unknown[] = []) {
  return { rpc: async (...args: unknown[]) => { calls.push(args); return { data: null, error: null, status: 200, ...result }; } } as unknown as SupabaseClient;
}

test('[NORMAL] [SG2-70:AC1] [SG2-70:AC2] a search goes through search_events with the caller token and every filter', async () => {
  const calls: unknown[] = []; let token = '';
  const store = createEventSearchStore('staff-token', value => {
    token = value;
    return client({ data: { events: [event], truncated: false, filters } }, calls);
  });
  assert.deepEqual(await store.search(filters), { events: [event], truncated: false, filters });
  assert.equal(token, 'staff-token');
  assert.deepEqual(calls, [['search_events', {
    p_query: 'harbour', p_date_from: '2031-11-01', p_date_to: '2031-11-30', p_status: 'planning', p_venue_id: 4,
    p_category: 'social', p_coordinator_id: 'c0000000-0000-4000-8000-000000000001'
  }]]);
});

test('[NORMAL] [SG2-70:AC2] the filter options are read through event_search_options', async () => {
  const calls: unknown[] = [];
  const data = { venues: [{ venue_id: 4, name: 'Atrium' }], coordinators: [{ user_id: 'c1', name: 'Alice' }] };
  assert.deepEqual(await createEventSearchStore('t', () => client({ data }, calls)).options(), data);
  assert.deepEqual(calls, [['event_search_options']]);
});

test('[NORMAL] [SG2-70:AC4] the filters the database applied are returned, and a truncated page says so', async () => {
  const applied = { query: null, date_from: null, date_to: null, status: null, venue_id: null, category: 'training', coordinator_id: null };
  const page = await createEventSearchStore('t', () => client({ data: { events: [], truncated: true, filters: applied } })).search(filters);
  assert.deepEqual(page, { events: [], truncated: true, filters: applied });
});

test('[BOUNDARY] [SG2-70:AC1] details the database left out are null or empty rather than invented', async () => {
  const sparse = { event_id: 8, venues: ['Annex', 3, null] };
  const page = await createEventSearchStore('t', () => client({ data: {
    events: [sparse, 'not an event'], truncated: 'yes', filters: { venue_id: 1.5, query: 5 }
  } })).search(filters);
  assert.deepEqual(page, {
    events: [{ event_id: 8, name: '', organisation: null, category: null, status: '', proposed_date: null,
      coordinator_id: null, coordinator_name: null, venues: ['Annex'] }],
    truncated: false,
    filters: { query: null, date_from: null, date_to: null, status: null, venue_id: null, category: null, coordinator_id: null }
  });
  const [none] = (await createEventSearchStore('t', () => client({ data: { events: [{ event_id: 9 }], filters: {} } })).search(filters)).events;
  assert.deepEqual(none.venues, []);
  const options = await createEventSearchStore('t', () => client({ data: {
    venues: [{ venue_id: 2 }, 'x'], coordinators: [{ user_id: 'c2' }]
  } })).options();
  assert.deepEqual(options, { venues: [{ venue_id: 2, name: 'Unnamed venue' }], coordinators: [{ user_id: 'c2', name: 'Unnamed coordinator' }] });
});

test('[FAILURE] [SG2-70:AC3] a refusal or failure is translated without disclosing database error text', async () => {
  for (const [status, error, data, expected] of [[401, { code: 'secret' }, null, 401], [403, {}, null, 403],
    [400, { code: '42501' }, null, 403], [500, { code: 'secret' }, null, 503],
    [200, null, ['not', 'an', 'object'], 503], [200, null, { events: 'x', filters: {} }, 503],
    [200, null, { events: [], filters: [] }, 503], [200, null, null, 503]] as const) {
    await assert.rejects(createEventSearchStore('t', () => client({ status, error, data })).search(filters),
      failure => failure instanceof AccessError && failure.status === expected && !failure.message.includes('secret'));
  }
  for (const [status, error, data, expected] of [[403, { code: 'x' }, null, 403], [500, {}, null, 503],
    [200, null, { venues: [] }, 503], [200, null, { coordinators: [], venues: {} }, 503], [200, null, [], 503]] as const) {
    await assert.rejects(createEventSearchStore('t', () => client({ status, error, data })).options(),
      failure => failure instanceof AccessError && failure.status === expected);
  }
});

test('[FAILURE] [SG2-70:AC3] an unconfigured database is unavailable before anything is read', () => {
  assert.throws(() => createEventSearchStore('t'), failure => failure instanceof AccessError && failure.status === 503);
  assert.throws(() => createEventSearchStore('t', () => null), failure => failure instanceof AccessError && failure.status === 503);
});
