import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserRecord, updateUserRole } from './users';

function fakeAdmin(options: {
  roleLookup?: () => Promise<{ data: { role_id: number } | null; error: { message: string } | null }>;
  insert?: (row: any) => Promise<{ error: { message: string } | null }>;
  update?: (payload: any) => Promise<{ data: any; error: { message: string } | null }>;
  onRoleNameQueried?: (roleName: string) => void;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'roles') {
        return {
          select: () => ({
            eq: (_col: string, value: string) => {
              options.onRoleNameQueried?.(value);
              return {
                maybeSingle: options.roleLookup ?? (async () => ({ data: { role_id: 5 }, error: null }))
              };
            }
          })
        };
      }
      if (table === 'users') {
        return {
          insert: options.insert ?? (async () => ({ error: null })),
          update: (payload: any) => ({
            eq: () => ({
              select: async () =>
                options.update ? options.update(payload) : { data: [{ user_id: 'target-1' }], error: null }
            })
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  } as unknown as SupabaseClient;
}

const record = {
  userId: 'user-123',
  name: 'Ada Lovelace',
  organisation: 'Analytical Engines Ltd',
  roleName: 'Attendee'
};

describe('createUserRecord', () => {
  test('inserts the user with the chosen role id looked up from public.roles', async () => {
    let insertedRow: any;
    const admin = fakeAdmin({
      insert: async (row) => {
        insertedRow = row;
        return { error: null };
      }
    });

    const result = await createUserRecord(admin, record);

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(insertedRow, {
      user_id: 'user-123',
      name: 'Ada Lovelace',
      organisation: 'Analytical Engines Ltd',
      role_id: 5
    });
  });

  test('looks up whichever role was chosen, not a hardcoded default', async () => {
    let queriedRoleName: string | undefined;
    const admin = fakeAdmin({
      onRoleNameQueried: (roleName) => {
        queriedRoleName = roleName;
      }
    });

    await createUserRecord(admin, { ...record, roleName: 'Event Organiser' });

    assert.equal(queriedRoleName, 'Event Organiser');
  });

  test('fails without inserting when the chosen role is not configured', async () => {
    let insertCalled = false;
    const admin = fakeAdmin({
      roleLookup: async () => ({ data: null, error: null }),
      insert: async () => {
        insertCalled = true;
        return { error: null };
      }
    });

    const result = await createUserRecord(admin, record);

    assert.equal(result.ok, false);
    assert.equal(insertCalled, false);
  });

  test('fails when the role lookup errors', async () => {
    const admin = fakeAdmin({
      roleLookup: async () => ({ data: null, error: { message: 'connection reset' } })
    });

    const result = await createUserRecord(admin, record);

    assert.equal(result.ok, false);
  });

  test('surfaces the database error when the insert fails', async () => {
    const admin = fakeAdmin({
      insert: async () => ({ error: { message: 'duplicate key value violates unique constraint' } })
    });

    const result = await createUserRecord(admin, record);

    assert.deepEqual(result, { ok: false, error: 'duplicate key value violates unique constraint' });
  });
});

describe('updateUserRole', () => {
  test('updates the role id looked up from the given role name', async () => {
    let updatePayload: any;
    const admin = fakeAdmin({
      roleLookup: async () => ({ data: { role_id: 3 }, error: null }),
      update: async (payload) => {
        updatePayload = payload;
        return { data: [{ user_id: 'target-1' }], error: null };
      }
    });

    const result = await updateUserRole(admin, 'target-1', 'Venue Staff');

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(updatePayload, { role_id: 3 });
  });

  test('rejects a role name that is not one of the five valid roles', async () => {
    let roleLookupCalled = false;
    const admin = fakeAdmin({ roleLookup: async () => { roleLookupCalled = true; return { data: { role_id: 1 }, error: null }; } });

    const result = await updateUserRole(admin, 'target-1', 'Overlord');

    assert.deepEqual(result, { ok: false, reason: 'invalid_role' });
    assert.equal(roleLookupCalled, false);
  });

  test('reports invalid_role when a valid-looking name has no matching row', async () => {
    const admin = fakeAdmin({ roleLookup: async () => ({ data: null, error: null }) });
    const result = await updateUserRole(admin, 'target-1', 'Venue Staff');
    assert.deepEqual(result, { ok: false, reason: 'invalid_role' });
  });

  test('reports user_not_found when no row matches the target user id', async () => {
    const admin = fakeAdmin({ update: async () => ({ data: [], error: null }) });
    const result = await updateUserRole(admin, 'does-not-exist', 'Venue Staff');
    assert.deepEqual(result, { ok: false, reason: 'user_not_found' });
  });

  test('surfaces a database error from the update itself', async () => {
    const admin = fakeAdmin({ update: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const result = await updateUserRole(admin, 'target-1', 'Venue Staff');
    assert.deepEqual(result, { ok: false, reason: 'error', error: 'connection reset' });
  });
});
