import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { eventLabel, eventNoticeMessages, fetchLeadIds, notifyEvent } from './eventNotifications';

function insertingAdmin(error: { message: string } | null = null) {
  const calls: { table: string; rows: unknown }[] = [];
  const admin = {
    from(table: string) {
      return { insert: async (rows: unknown) => { calls.push({ table, rows }); return { error }; } };
    }
  } as unknown as SupabaseClient;
  return { admin, calls };
}

function selectingAdmin(result: { data: unknown; error: { message: string } | null }) {
  const calls: unknown[][] = [];
  const admin = {
    from(table: string) {
      return {
        select(columns: string) {
          return { eq: async (column: string, value: string) => { calls.push([table, columns, column, value]); return result; } };
        }
      };
    }
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe('notifyEvent (SG2-68)', () => {
  test('[NORMAL] [SG2-68:AC1] [SG2-68:AC2] stores every notice for its recipient in one insert', async () => {
    const { admin, calls } = insertingAdmin();
    const result = await notifyEvent(admin, [
      { recipient_id: 'lead-1', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was submitted and is waiting for a coordinator.' },
      { recipient_id: 'lead-2', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was submitted and is waiting for a coordinator.' }
    ]);
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [{
      table: 'notifications',
      rows: [
        { recipient_id: 'lead-1', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was submitted and is waiting for a coordinator.' },
        { recipient_id: 'lead-2', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was submitted and is waiting for a coordinator.' }
      ]
    }]);
  });

  test('[CONFLICT] [SG2-68:AC1] one person holding two parts gets one notice of a kind, and different kinds are kept', async () => {
    const { admin, calls } = insertingAdmin();
    await notifyEvent(admin, [
      { recipient_id: 'coord-1', event_id: 7, kind: 'coordinator_assigned', message: 'You are now coordinating Partner Forum.' },
      { recipient_id: 'coord-1', event_id: 7, kind: 'coordinator_assigned', message: 'Partner Forum was reassigned to another coordinator.' },
      { recipient_id: 'coord-1', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was resubmitted for your review.' }
    ]);
    assert.deepEqual(calls[0].rows, [
      { recipient_id: 'coord-1', event_id: 7, kind: 'coordinator_assigned', message: 'You are now coordinating Partner Forum.' },
      { recipient_id: 'coord-1', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was resubmitted for your review.' }
    ]);
  });

  test('[BOUNDARY] [SG2-68:AC3] notices with no recipient or no message are dropped, and an empty batch writes nothing', async () => {
    const { admin, calls } = insertingAdmin();
    const result = await notifyEvent(admin, [
      { recipient_id: null, event_id: 7, kind: 'event_submitted', message: 'Partner Forum was resubmitted for your review.' },
      { recipient_id: undefined, event_id: 7, kind: 'event_submitted', message: 'Partner Forum was resubmitted for your review.' },
      { recipient_id: '', event_id: 7, kind: 'event_submitted', message: 'Partner Forum was resubmitted for your review.' },
      { recipient_id: 'coord-1', event_id: 7, kind: 'event_submitted', message: '' }
    ]);
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, []);
    assert.deepEqual(await notifyEvent(admin, []), { ok: true });
    assert.deepEqual(calls, []);
  });

  test('[FAILURE] [SG2-68:AC1] a refused insert is reported without the provider error', async () => {
    const { admin } = insertingAdmin({ message: 'PRIVATE_SENTINEL' });
    const result = await notifyEvent(admin, [
      { recipient_id: 'org-1', event_id: 7, kind: 'event_approved', message: 'Partner Forum was approved.' }
    ]);
    assert.deepEqual(result, { ok: false });
  });
});

describe('fetchLeadIds (SG2-68)', () => {
  test('[NORMAL] [SG2-68:AC1] reads every Event Coordinator Lead from the role store', async () => {
    const { admin, calls } = selectingAdmin({ data: [{ user_id: 'lead-1' }, { user_id: 'lead-2' }], error: null });
    assert.deepEqual(await fetchLeadIds(admin), { ok: true, ids: ['lead-1', 'lead-2'] });
    assert.deepEqual(calls, [['account_roles', 'user_id', 'role', 'event_coordinator_lead']]);
  });

  test('[BOUNDARY] [SG2-68:AC1] no Lead accounts gives an empty list', async () => {
    const { admin } = selectingAdmin({ data: [], error: null });
    assert.deepEqual(await fetchLeadIds(admin), { ok: true, ids: [] });
  });

  test('[FAILURE] [SG2-68:AC1] an unreadable role store is reported as a failure', async () => {
    assert.deepEqual(await fetchLeadIds(selectingAdmin({ data: null, error: { message: 'PRIVATE_SENTINEL' } }).admin), { ok: false });
    assert.deepEqual(await fetchLeadIds(selectingAdmin({ data: null, error: null }).admin), { ok: false });
  });
});

describe('event notice text (SG2-68 AC2)', () => {
  test('[NORMAL] [SG2-68:AC2] every message names the event and says what happened', () => {
    assert.equal(eventNoticeMessages.submittedToLeads('Partner Forum'), 'Partner Forum was submitted and is waiting for a coordinator.');
    assert.equal(eventNoticeMessages.resubmittedToCoordinator('Partner Forum'), 'Partner Forum was resubmitted for your review.');
    assert.equal(eventNoticeMessages.assignedToCoordinator('Partner Forum'), 'You are now coordinating Partner Forum.');
    assert.equal(eventNoticeMessages.assignedToOrganiser('Casey Coordinator', 'Partner Forum'), 'Casey Coordinator is now coordinating Partner Forum.');
    assert.equal(eventNoticeMessages.reassignedFromCoordinator('Partner Forum'), 'Partner Forum was reassigned to another coordinator.');
    assert.equal(eventNoticeMessages.clarificationRequested('Partner Forum'), 'Your coordinator has a question about Partner Forum.');
    assert.equal(eventNoticeMessages.approved('Partner Forum'), 'Partner Forum was approved.');
    assert.equal(eventNoticeMessages.rejected('Partner Forum', 'Clashes with the AGM'), 'Partner Forum was not approved: Clashes with the AGM');
  });

  test('[BOUNDARY] [SG2-68:AC2] an unnamed event, an unnamed coordinator, and over-long names and reasons stay within the stored limits', () => {
    assert.equal(eventLabel(null), 'Untitled event');
    assert.equal(eventLabel(undefined), 'Untitled event');
    assert.equal(eventLabel(''), 'Untitled event');
    assert.equal(eventLabel('a'.repeat(500)), 'a'.repeat(500));
    assert.equal(eventLabel('a'.repeat(501)), 'a'.repeat(500));
    // Characters, not UTF-16 units, as Postgres counts them.
    assert.equal(eventLabel('😀'.repeat(501)), '😀'.repeat(500));
    assert.equal(eventNoticeMessages.assignedToOrganiser(null, 'Partner Forum'), 'A coordinator is now coordinating Partner Forum.');
    assert.equal(eventNoticeMessages.assignedToOrganiser('b'.repeat(501), 'X'), `${'b'.repeat(500)} is now coordinating X.`);
    const prefix = 'Partner Forum was not approved: ';
    const fits = 'r'.repeat(2000 - prefix.length);
    assert.equal(eventNoticeMessages.rejected('Partner Forum', fits), prefix + fits);
    assert.equal(eventNoticeMessages.rejected('Partner Forum', `${fits}rr`), prefix + fits);
  });

  test('[NORMAL] [SG2-66:AC7] the back-to-Planning notices tell the organiser and the coordinator what happens next', () => {
    assert.equal(eventNoticeMessages.returnedToPlanningOrganiser('Partner Forum'),
      'Partner Forum has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.');
    assert.equal(eventNoticeMessages.returnedToPlanningCoordinator('Partner Forum'),
      'Partner Forum is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.');
  });

  test('[BOUNDARY] [SG2-66:AC7] an organiser who also coordinates the event gets one back-to-Planning notice', async () => {
    const { admin, calls } = insertingAdmin();
    await notifyEvent(admin, [
      { recipient_id: 'same-1', event_id: 7, kind: 'event_returned_to_planning', message: eventNoticeMessages.returnedToPlanningOrganiser('X') },
      { recipient_id: 'same-1', event_id: 7, kind: 'event_returned_to_planning', message: eventNoticeMessages.returnedToPlanningCoordinator('X') }
    ]);
    assert.equal((calls[0].rows as unknown[]).length, 1);
  });

  test('[NORMAL] [SG2-92:AC5] each safety decision notice names the event, the decision and its reason, as the database writes it', () => {
    assert.equal(eventNoticeMessages.safetyApproved('Partner Forum', null),
      'Partner Forum passed its operational safety check and has moved to Preparation.');
    assert.equal(eventNoticeMessages.safetyApproved('Partner Forum', 'Keep the east exit clear'),
      'Partner Forum passed its operational safety check and has moved to Preparation. Note: Keep the east exit clear');
    assert.equal(eventNoticeMessages.safetyRejected('Partner Forum', 'Crowd flow blocks the fire exit'),
      'Partner Forum did not pass its operational safety check: Crowd flow blocks the fire exit. The coordinator will rework the arrangements for a new check.');
    assert.equal(eventNoticeMessages.safetyChangesRequested('Partner Forum', 'Venue, Equipment and technical', 'Move the stage'),
      'Partner Forum needs changes before it can pass its operational safety check (Venue, Equipment and technical): Move the stage. It has moved back to Planning.');
  });

  test('[BOUNDARY] [SG2-92:AC5] a 2000-character reason keeps every safety notice within the stored limit', () => {
    const reason = 'r'.repeat(2000);
    for (const message of [
      eventNoticeMessages.safetyApproved('E', reason),
      eventNoticeMessages.safetyRejected('E', reason),
      eventNoticeMessages.safetyChangesRequested('E', 'Other', reason)
    ]) {
      assert.equal(Array.from(message).length, 2000);
      assert.ok(message.startsWith('E '));
    }
  });
});
