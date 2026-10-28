import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchRegistrationOverview, updateRegistrationSettings } from './registrations';

const rpcClient = (data: unknown, error: unknown = null, calls: unknown[] = []) =>
  ({ rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data, error }; } }) as unknown as SupabaseClient;

const failed = { message: 'secret provider detail' };

const OVERVIEW = {
  event: {
    event_id: 12, name: 'Partner Forum', status: 'confirmed', organisation: 'Acme', organiser_id: 'organiser-1',
    coordinator_id: 'coordinator-1', proposed_date: '2030-06-20T01:00:00+00:00', registration_needed: true,
    registration_capacity: 120, registration_opens_at: '2030-06-01T01:00:00+00:00', registration_closes_at: '2030-06-10T01:00:00+00:00',
    waiting_list_response_hours: 24
  },
  attendees: [
    { registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', email: 'ana@attendee.test', phone: '+65 6000 0001',
      needs: 'Step-free access', registered_at: '2030-06-02T01:00:00+00:00' },
    { registration_id: 4, name: 'Ben Attendee', organisation: null, email: null, phone: null, needs: null, registered_at: '2030-06-03T01:00:00+00:00' }
  ],
  waiting_list: [],
  venues: [{ venue_id: 7, name: 'Main hall', capacity: 100 }, { venue_id: 8, name: 'Lawn', capacity: null }]
};

describe('fetchRegistrationOverview (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC1] [SG2-63:AC2] [SG2-60:AC4] one RPC reads the event, its active registrations with their needs and its booked venues, typed', async () => {
    const calls: unknown[] = [];
    assert.deepEqual(await fetchRegistrationOverview(rpcClient(OVERVIEW, null, calls), 12), { ok: true, overview: OVERVIEW });
    assert.deepEqual(calls, [['event_registration_overview', { p_event_id: 12 }]]);
  });

  test('[BOUNDARY] [SG2-63:AC1] an event never filled in reads its blanks as null, not as text', async () => {
    const result = await fetchRegistrationOverview(rpcClient({
      event: { event_id: 13, status: 'planning', name: null, organisation: null, organiser_id: null, coordinator_id: null,
        proposed_date: null, registration_needed: null, registration_capacity: null, registration_opens_at: null,
        registration_closes_at: null },
      attendees: [], venues: []
    }), 13);
    assert.deepEqual(result, { ok: true, overview: { event: {
      event_id: 13, name: null, status: 'planning', organisation: null, organiser_id: null, coordinator_id: null,
      proposed_date: null, registration_needed: null, registration_capacity: null, registration_opens_at: null,
      registration_closes_at: null, waiting_list_response_hours: 24
    }, attendees: [], waiting_list: [], venues: [] } });
  });

  test('[NORMAL] [SG2-61:AC7] [SG2-62:AC6] the waiting list is read in order, with each offer and its time', async () => {
    const list = [
      { entry_id: 5, name: 'Cara', organisation: null, status: 'offered', joined_at: 'a', offer_expires_at: 'b' },
      { entry_id: 6, name: 'Dev', organisation: 'Guests Ltd', status: 'waiting', joined_at: 'c', offer_expires_at: null }
    ];
    const result = await fetchRegistrationOverview(rpcClient({ ...OVERVIEW, waiting_list: list,
      event: { ...OVERVIEW.event, waiting_list_response_hours: 6 } }), 12);
    assert.ok(result.ok);
    assert.deepEqual([result.overview.waiting_list, result.overview.event.waiting_list_response_hours], [list, 6]);
  });

  test('[BOUNDARY] [SG2-61:AC7] a picture read before the waiting list existed has an empty list and the default window', async () => {
    const { waiting_list: _list, ...older } = OVERVIEW;
    const { waiting_list_response_hours: _hours, ...event } = OVERVIEW.event;
    const result = await fetchRegistrationOverview(rpcClient({ ...older, event }), 12);
    assert.ok(result.ok);
    assert.deepEqual([result.overview.waiting_list, result.overview.event.waiting_list_response_hours], [[], 24]);
  });

  test('[FAILURE] [SG2-63:AC3] a missing event, a failed read and a malformed answer are told apart', async () => {
    assert.deepEqual(await fetchRegistrationOverview(rpcClient(null), 99), { ok: false, reason: 'not_found' });
    assert.deepEqual(await fetchRegistrationOverview(rpcClient(null, failed), 12), { ok: false, reason: 'unavailable' });
    for (const data of ['text', { ...OVERVIEW, attendees: null }, { ...OVERVIEW, venues: {} }, { ...OVERVIEW, event: null },
      { ...OVERVIEW, event: 'x' }]) {
      assert.deepEqual(await fetchRegistrationOverview(rpcClient(data), 12), { ok: false, reason: 'unavailable' }, JSON.stringify(data));
    }
  });
});

describe('updateRegistrationSettings (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC5] [SG2-63:AC6] one RPC carries the event, the organiser, the settings and whether to close now', async () => {
    const calls: unknown[] = [];
    const result = await updateRegistrationSettings(rpcClient({ outcome: 'ok', changed: ['registration_capacity'] }, null, calls),
      { eventId: 12, actorId: 'organiser-1', values: { registration_capacity: 150 }, closeNow: false });
    assert.deepEqual(result, { outcome: 'ok' });
    assert.deepEqual(calls, [['update_registration_settings',
      { p_event_id: 12, p_actor_id: 'organiser-1', p_values: { registration_capacity: 150 }, p_close_now: false }]]);
  });

  test('[CONFLICT] [SG2-63:AC5] [SG2-63:AC6] refusals from the database pass through, with the status for a closed event', async () => {
    for (const outcome of ['missing', 'not_needed', 'started', 'not_open', 'invalid'] as const) {
      assert.deepEqual(await updateRegistrationSettings(rpcClient({ outcome }),
        { eventId: 12, actorId: 'organiser-1', values: {}, closeNow: true }), { outcome });
    }
    assert.deepEqual(await updateRegistrationSettings(rpcClient({ outcome: 'closed', status: 'cancelled' }),
      { eventId: 12, actorId: 'organiser-1', values: {}, closeNow: true }), { outcome: 'closed', status: 'cancelled' });
    assert.deepEqual(await updateRegistrationSettings(rpcClient({ outcome: 'below_registered', registered: 3 }),
      { eventId: 12, actorId: 'organiser-1', values: { registration_capacity: 2 }, closeNow: false }), { outcome: 'below_registered', registered: 3 });
  });

  test('[FAILURE] [SG2-63:AC5] an error or an unexpected answer is reported unavailable', async () => {
    for (const [data, error] of [[null, failed], [null, null], ['ok', null], [{ outcome: 'closed' }, null],
      [{ outcome: 'below_registered' }, null], [{ outcome: 'done' }, null]]) {
      assert.deepEqual(await updateRegistrationSettings(rpcClient(data, error),
        { eventId: 12, actorId: 'organiser-1', values: { registration_capacity: 2 }, closeNow: false }),
      { outcome: 'unavailable' }, JSON.stringify(data));
    }
  });
});
