import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { confirmSafetyRereview, listEventSafetyRereviews, listSafetyRereviewQueue } from './safetyRereviews';

const rpcClient = (data: unknown, error: unknown = null, calls: unknown[] = []) =>
  ({ rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data, error }; } }) as unknown as SupabaseClient;

const FLAG = {
  review_id: 31, decision_id: 9, arrangement: 'venue', label: 'Hall (20 Jun 2030 10:00 – 14:00 SGT)',
  flagged_at: '2030-06-01T00:00:00Z', resolution: 'confirmed', resolved_by_name: 'Val Venue', resolved_at: '2030-06-02T00:00:00Z'
};
const QUEUED = {
  review_id: 31, arrangement: 'equipment', event_id: 7, event_name: 'Harbour Gala', proposed_date: '2030-06-20T02:00:00Z',
  coordinator_name: 'Casey', flagged_at: '2030-06-01T00:00:00Z', label: '4 × Speakers', reason: 'Speakers block the aisle',
  decided_by_name: 'Sam Safety', layout: null, placement_venue_name: 'Hall', placement_position: 'Stage left'
};

describe('listEventSafetyRereviews (SG2-93 AC5)', () => {
  test('[NORMAL] [SG2-93:AC5] reads every flag on the event through event_safety_rereviews', async () => {
    const calls: unknown[] = [];
    assert.deepEqual(await listEventSafetyRereviews(rpcClient([FLAG], null, calls), 7), { ok: true, rereviews: [FLAG] });
    assert.deepEqual(calls, [['event_safety_rereviews', { p_event_id: 7 }]]);
  });

  test('[BOUNDARY] [SG2-93:AC5] an open flag has no resolution, and a row outside the vocabulary is skipped', async () => {
    const open = { ...FLAG, review_id: 32, resolution: null, resolved_by_name: null, resolved_at: null };
    assert.deepEqual(await listEventSafetyRereviews(rpcClient([open, { ...FLAG, arrangement: 'other' }, { ...FLAG, label: 3 }]), 7),
      { ok: true, rereviews: [open] });
  });

  test('[FAILURE] [SG2-93:AC5] an error or a body that is not a list is unavailable', async () => {
    assert.deepEqual(await listEventSafetyRereviews(rpcClient(null, { message: 'down' }), 7), { ok: false });
    assert.deepEqual(await listEventSafetyRereviews(rpcClient({}), 7), { ok: false });
  });
});

describe('listSafetyRereviewQueue (SG2-93 AC2)', () => {
  test('[NORMAL] [SG2-93:AC2] reads the open flags of one kind through safety_rereview_queue', async () => {
    const calls: unknown[] = [];
    assert.deepEqual(await listSafetyRereviewQueue(rpcClient([QUEUED], null, calls), 'equipment'), { ok: true, items: [QUEUED] });
    assert.deepEqual(calls, [['safety_rereview_queue', { p_arrangement: 'equipment' }]]);
  });

  test('[BOUNDARY] [SG2-93:AC2] details the database left out read as null, and a row outside the vocabulary is skipped', async () => {
    const bare = { review_id: 33, arrangement: 'venue', event_id: 8, flagged_at: '2030-06-01T00:00:00Z', label: 'Annex' };
    assert.deepEqual(await listSafetyRereviewQueue(rpcClient([bare, { ...QUEUED, arrangement: 'venues' }]), 'venue'), { ok: true, items: [{
      ...bare, event_name: null, proposed_date: null, coordinator_name: null, reason: null, decided_by_name: null,
      layout: null, placement_venue_name: null, placement_position: null
    }] });
  });

  test('[FAILURE] [SG2-93:AC2] an error or a body that is not a list is unavailable', async () => {
    assert.deepEqual(await listSafetyRereviewQueue(rpcClient(null, { message: 'down' }), 'venue'), { ok: false });
    assert.deepEqual(await listSafetyRereviewQueue(rpcClient('nope'), 'venue'), { ok: false });
  });
});

describe('confirmSafetyRereview (SG2-93 AC2, AC4)', () => {
  test('[NORMAL] [SG2-93:AC4] confirms as the verified actor and acting role, and returns where the event now stands', async () => {
    const calls: unknown[] = [];
    const ok = { outcome: 'ok', review_id: 31, event_id: 7, status: 'awaiting_safety_check', outstanding_arrangements: [] };
    assert.deepEqual(await confirmSafetyRereview(rpcClient(ok, null, calls), 31, 'staff-1', 'venue_staff'), ok);
    assert.deepEqual(calls, [['confirm_safety_rereview', { p_review_id: 31, p_actor_id: 'staff-1', p_acting_role: 'venue_staff' }]]);
  });

  test('[CONFLICT] [SG2-93:AC2] a flag dealt with already, a missing one and a refused actor pass through', async () => {
    for (const resolution of ['confirmed', 'withdrawn']) {
      assert.deepEqual(await confirmSafetyRereview(rpcClient({ outcome: 'closed', resolution }), 31, 's', 'venue_staff'), { outcome: 'closed', resolution });
    }
    for (const outcome of ['missing', 'forbidden']) {
      assert.deepEqual(await confirmSafetyRereview(rpcClient({ outcome }), 31, 's', 'venue_staff'), { outcome });
    }
  });

  test('[FAILURE] [SG2-93:AC2] an error or an unexpected answer is unavailable', async () => {
    const ok = { outcome: 'ok', review_id: 31, event_id: 7, status: 'planning', outstanding_arrangements: ['safety_other_recheck'] };
    for (const [data, error] of [[null, { message: 'down' }], [null, null], [{ outcome: 'closed', resolution: 'maybe' }, null],
      [{ ...ok, status: 3 }, null], [{ ...ok, outstanding_arrangements: ['safety'] }, null], [{ ...ok, outstanding_arrangements: 'x' }, null],
      [{ outcome: 'later' }, null]]) {
      assert.deepEqual(await confirmSafetyRereview(rpcClient(data, error), 31, 's', 'venue_staff'), { outcome: 'unavailable' }, JSON.stringify(data));
    }
  });
});
