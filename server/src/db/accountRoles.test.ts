import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAccountRole, updateAccountRole, deleteAccountRole, getAccountRole } from './accountRoles';

function fakeAdmin(options: {
  insert?: (row: any) => Promise<{ error: { message: string } | null }>;
  update?: (payload: any) => Promise<{ data: any; error: { message: string } | null }>;
  delete?: () => Promise<{ error: { message: string } | null }>;
  select?: (userId: unknown) => Promise<{ data: any; error: { message: string } | null }>;
  captureFilter?: (column: string, userId: string) => void;
}): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'account_roles');
      return {
        insert: options.insert ?? (async () => ({ error: null })),
        update: (payload: any) => ({
          eq: (column: string, userId: string) => {
            options.captureFilter?.(column, userId);
            return { select: async () =>
              options.update ? options.update(payload) : { data: [{ user_id: 'target-1' }], error: null } };
          }
        }),
        delete: () => ({
          eq: async (column: string, userId: string) => {
            options.captureFilter?.(column, userId);
            return options.delete ? options.delete() : { error: null };
          }
        }),
        select: (columns: string) => {
          assert.equal(columns, 'role');
          return {
            eq: (column: string, value: unknown) => {
              assert.equal(column, 'user_id');
              return {
                maybeSingle: async () =>
                  options.select ? options.select(value) : { data: { role: 'event_coordinator' }, error: null }
              };
            }
          };
        }
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
    let filter: unknown;
    const admin = fakeAdmin({
      captureFilter: (column, userId) => { filter = { column, userId }; },
      update: async (payload) => {
        updatePayload = payload;
        return { data: [{ user_id: 'target-1' }], error: null };
      }
    });

    const result = await updateAccountRole(admin, 'target-1', 'venue_staff');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(updatePayload, { role: 'venue_staff' });
    assert.deepEqual(filter, { column: 'user_id', userId: 'target-1' });
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
  for (const outcome of ['success', 'database error', 'transport rejection'] as const) {
    test(`attempts cleanup of only the target account and resolves on ${outcome}`, async () => {
      let deletes = 0;
      let filter: unknown;
      const admin = fakeAdmin({
        captureFilter: (column, userId) => { filter = { column, userId }; },
        delete: async () => {
          deletes++;
          if (outcome === 'transport rejection') throw new Error('connection reset');
          return { error: outcome === 'database error' ? { message: 'connection reset' } : null };
        }
      });
      await assert.doesNotReject(() => deleteAccountRole(admin, 'user-123'));
      assert.equal(deletes, 1);
      assert.deepEqual(filter, { column: 'user_id', userId: 'user-123' });
    });
  }
});

describe('getAccountRole', () => {
  test('returns the role for an existing account', async () => {
    let askedFor: unknown;
    const admin = fakeAdmin({
      select: async (userId) => {
        askedFor = userId;
        return { data: { role: 'event_coordinator' }, error: null };
      }
    });

    const result = await getAccountRole(admin, 'coord-1');

    assert.deepEqual(result, { ok: true, role: 'event_coordinator' });
    assert.equal(askedFor, 'coord-1');
  });

  test('reports user_not_found when no row matches', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: null }) });
    const result = await getAccountRole(admin, 'ghost');
    assert.deepEqual(result, { ok: false, reason: 'user_not_found' });
  });

  test('surfaces a database error', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const result = await getAccountRole(admin, 'coord-1');
    assert.deepEqual(result, { ok: false, reason: 'error', error: 'connection reset' });
  });
});
