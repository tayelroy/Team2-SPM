import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAccountRole, updateAccountRole, deleteAccountRole } from './accountRoles';

function fakeAdmin(options: {
  insert?: (row: any) => Promise<{ error: { message: string } | null }>;
  update?: (payload: any) => Promise<{ data: any; error: { message: string } | null }>;
  delete?: () => Promise<{ error: { message: string } | null }>;
}): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'account_roles');
      return {
        insert: options.insert ?? (async () => ({ error: null })),
        update: (payload: any) => ({
          eq: () => ({
            select: async () =>
              options.update ? options.update(payload) : { data: [{ user_id: 'target-1' }], error: null }
          })
        }),
        delete: () => ({
          eq: async () => (options.delete ? options.delete() : { error: null })
        })
      };
    }
  } as unknown as SupabaseClient;
}

describe('createAccountRole', () => {
  test('inserts the given snake_case role for the user', async () => {
    let insertedRow: any;
    const admin = fakeAdmin({
      insert: async (row) => {
        insertedRow = row;
        return { error: null };
      }
    });

    const result = await createAccountRole(admin, 'user-123', 'attendee');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(insertedRow, { user_id: 'user-123', role: 'attendee' });
  });

  test('surfaces the database error when the insert fails', async () => {
    const admin = fakeAdmin({ insert: async () => ({ error: { message: 'duplicate key value' } }) });
    const result = await createAccountRole(admin, 'user-123', 'attendee');
    assert.deepEqual(result, { ok: false, error: 'duplicate key value' });
  });
});

describe('updateAccountRole', () => {
  test('updates the role for an existing user', async () => {
    let updatePayload: any;
    const admin = fakeAdmin({
      update: async (payload) => {
        updatePayload = payload;
        return { data: [{ user_id: 'target-1' }], error: null };
      }
    });

    const result = await updateAccountRole(admin, 'target-1', 'venue_staff');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(updatePayload, { role: 'venue_staff' });
  });

  test('reports user_not_found when no row matches the target user id', async () => {
    const admin = fakeAdmin({ update: async () => ({ data: [], error: null }) });
    const result = await updateAccountRole(admin, 'does-not-exist', 'venue_staff');
    assert.deepEqual(result, { ok: false, reason: 'user_not_found' });
  });

  test('surfaces a database error from the update itself', async () => {
    const admin = fakeAdmin({ update: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const result = await updateAccountRole(admin, 'target-1', 'venue_staff');
    assert.deepEqual(result, { ok: false, reason: 'error', error: 'connection reset' });
  });
});

describe('deleteAccountRole', () => {
  test('resolves even when the delete fails (best-effort rollback)', async () => {
    const admin = fakeAdmin({ delete: async () => ({ error: { message: 'connection reset' } }) });
    await assert.doesNotReject(() => deleteAccountRole(admin, 'user-123'));
  });

  test('resolves on success', async () => {
    const admin = fakeAdmin({});
    await assert.doesNotReject(() => deleteAccountRole(admin, 'user-123'));
  });
});
