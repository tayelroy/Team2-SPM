import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserRecord } from './users';

function fakeAdmin(options: {
  roleLookup?: () => Promise<{ data: { role_id: number } | null; error: { message: string } | null }>;
  insert?: (row: any) => Promise<{ error: { message: string } | null }>;
  onRoleNameQueried?: (roleName: string) => void;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'roles') {
        return {
          select: (columns: string) => {
            assert.equal(columns, 'role_id');
            return { eq: (column: string, value: string) => {
              assert.equal(column, 'role_name');
              options.onRoleNameQueried?.(value);
              return {
                maybeSingle: options.roleLookup ?? (async () => ({ data: { role_id: 5 }, error: null }))
              };
            } };
          }
        };
      }
      if (table === 'users') {
        return { insert: options.insert ?? (async () => ({ error: null })) };
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

  test('fails without inserting when the role lookup errors', async () => {
    let inserts = 0;
    const admin = fakeAdmin({
      roleLookup: async () => ({ data: null, error: { message: 'connection reset' } }),
      insert: async () => { inserts++; return { error: null }; }
    });

    const result = await createUserRecord(admin, record);

    assert.deepEqual(result, { ok: false, error: 'Role "Attendee" is not configured.' });
    assert.equal(inserts, 0);
  });

  test('surfaces the database error when the insert fails', async () => {
    const admin = fakeAdmin({
      insert: async () => ({ error: { message: 'duplicate key value violates unique constraint' } })
    });

    const result = await createUserRecord(admin, record);

    assert.deepEqual(result, { ok: false, error: 'duplicate key value violates unique constraint' });
  });
});
