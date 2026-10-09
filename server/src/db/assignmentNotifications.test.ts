import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { insertAssignmentNotifications } from './assignmentNotifications';

const NOTICE = { recipient_id: 'coord-1', event_id: 7, kind: 'coordinator_assigned' as const, message: 'You are now the Event Coordinator for “Partner Forum”.' };

function notificationsTable(error?: string) {
  const inserted: unknown[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, 'notifications');
      return { async insert(rows: unknown[]) { inserted.push(...rows); return { error: error ? { message: error } : null }; } };
    }
  } as unknown as SupabaseClient;
  return { client, inserted };
}

test('[NORMAL] [SG2-88:AC4] every notice is stored in one insert', async () => {
  const { client, inserted } = notificationsTable();
  assert.deepEqual(await insertAssignmentNotifications(client, [NOTICE, { ...NOTICE, recipient_id: 'org-1', kind: 'event_coordinator_changed' }]), { ok: true });
  assert.deepEqual(inserted, [NOTICE, { ...NOTICE, recipient_id: 'org-1', kind: 'event_coordinator_changed' }]);
});

test('[BOUNDARY] [SG2-88:AC4] nothing to send never touches the table', async () => {
  const client = { from() { throw new Error('should not query'); } } as unknown as SupabaseClient;
  assert.deepEqual(await insertAssignmentNotifications(client, []), { ok: true });
});

test('[FAILURE] [SG2-88:AC4] a failed insert is reported with its reason', async () => {
  const { client } = notificationsTable('new row violates check constraint "notifications_kind_check"');
  assert.deepEqual(await insertAssignmentNotifications(client, [NOTICE]), {
    ok: false, message: 'new row violates check constraint "notifications_kind_check"'
  });
});
