import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSafetyChecksStore } from './safetyChecks';
import { dbConfig } from './config';
import { AccessError } from '../auth';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const row = {
  event_id: 7, safety_check_revision: 3, name: 'Open Day', organisation: 'SMU', proposed_date: '2031-11-01T09:00:00Z',
  awaiting_since: '2031-10-01T02:00:00Z', expected_attendance: 120, accessibility_needs: 'Wheelchair seating',
  expected_crowd_movement: 'Enter east, leave west',
  venues: [{ request_id: 11, venue_id: 4, venue_name: 'Hall', location: 'Level 1', capacity: 300, layout: 'theatre',
    starts_at: '2031-11-01T09:00:00Z', ends_at: '2031-11-01T17:00:00Z', accessibility_features: 'Ramp',
    emergency_access: 'Two exits', known_restrictions: 'No open flames' }],
  equipment: [{ request_id: 21, equipment_name: 'Speakers', quantity: 2, placement_venue_name: 'Hall',
    placement_position: 'Stage left', arrangement_notes: 'Cable ramps' }]
};

function client(result: { data?: unknown; error?: unknown; status?: number }, calls: unknown[] = []) {
  return { rpc: async (...args: unknown[]) => { calls.push(args); return { data: null, error: null, status: 200, ...result }; } } as unknown as SupabaseClient;
}

test('[NORMAL] [SG2-91:AC2] [SG2-91:AC3] the list is read through safety_check_queue with the caller token and keeps every review detail', async () => {
  const calls: unknown[] = []; let token = '';
  const store = createSafetyChecksStore('officer-token', value => { token = value; return client({ data: [row] }, calls); });
  assert.deepEqual(await store.list(), [row]);
  assert.equal(token, 'officer-token');
  assert.deepEqual(calls, [['safety_check_queue']]);
});

test('[BOUNDARY] [SG2-91:AC3] details a venue or event never recorded are null, and missing names fall back instead of disappearing', async () => {
  const sparse = { event_id: 8, safety_check_revision: 0, venues: [{ request_id: 12, venue_id: 5, capacity: 1.5 }, 'not a venue'],
    equipment: [{ request_id: 22, quantity: 1 }], expected_attendance: '120' };
  const store = createSafetyChecksStore('t', () => client({ data: [sparse, null] }));
  assert.deepEqual(await store.list(), [{
    event_id: 8, safety_check_revision: 0, name: '', organisation: null, proposed_date: null, awaiting_since: null,
    expected_attendance: null, accessibility_needs: null, expected_crowd_movement: null,
    venues: [{ request_id: 12, venue_id: 5, venue_name: 'Venue no longer listed', location: null, capacity: null, layout: null,
      starts_at: null, ends_at: null, accessibility_features: null, emergency_access: null, known_restrictions: null }],
    equipment: [{ request_id: 22, equipment_name: 'Equipment no longer listed', quantity: 1, placement_venue_name: null,
      placement_position: null, arrangement_notes: null }]
  }]);
});

test('[BOUNDARY] [SG2-91:AC2] an empty list stays an empty list, and an event without arrangements lists none', async () => {
  assert.deepEqual(await createSafetyChecksStore('t', () => client({ data: [] })).list(), []);
  const [only] = await createSafetyChecksStore('t', () => client({ data: [{ event_id: 9, safety_check_revision: 1 }] })).list();
  assert.deepEqual([only.venues, only.equipment], [[], []]);
});

test('[FAILURE] [SG2-91:AC4] a refusal or failure is translated without disclosing database error text', async () => {
  for (const [status, error, data, expected] of [[401, { code: 'secret' }, null, 401], [403, {}, null, 403],
    [400, { code: '42501' }, null, 403], [500, { code: 'secret' }, null, 503], [200, null, { not: 'a list' }, 503]] as const) {
    await assert.rejects(createSafetyChecksStore('t', () => client({ status, error, data })).list(),
      failure => failure instanceof AccessError && failure.status === expected && !failure.message.includes('secret'));
  }
  assert.throws(() => createSafetyChecksStore('t', () => null), failure => failure instanceof AccessError && failure.status === 503);
  assert.throws(() => createSafetyChecksStore('t'), failure => failure instanceof AccessError && failure.status === 503);
});
