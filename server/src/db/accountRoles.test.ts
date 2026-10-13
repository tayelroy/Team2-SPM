import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAccountRole, updateAccountRole, deleteAccountRole, getAccountRole, getAccountRoles, listCoordinators } from './accountRoles';

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
  test('[NORMAL] [SG2-24:AC1] inserts the given snake_case role for the user', async () => {
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

  test('[FAILURE] [SG2-24:AC1] surfaces the database error when the insert fails', async () => {
    const admin = fakeAdmin({ insert: async () => ({ error: { message: 'duplicate key value' } }) });
    const result = await createAccountRole(admin, 'user-123', 'attendee');
    assert.deepEqual(result, { ok: false, error: 'duplicate key value' });
  });
});

describe('updateAccountRole', () => {
  test('[NORMAL] [SG2-24:AC2] updates the role for an existing user', async () => {
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

  test('[FAILURE] [SG2-24:AC2] reports user_not_found when no row matches the target user id', async () => {
    const admin = fakeAdmin({ update: async () => ({ data: [], error: null }) });
    const result = await updateAccountRole(admin, 'does-not-exist', 'venue_staff');
    assert.deepEqual(result, { ok: false, reason: 'user_not_found' });
  });

  test('[FAILURE] [SG2-24:AC2] surfaces a database error from the update itself', async () => {
    const admin = fakeAdmin({ update: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const result = await updateAccountRole(admin, 'target-1', 'venue_staff');
    assert.deepEqual(result, { ok: false, reason: 'error', error: 'connection reset' });
  });
});

describe('deleteAccountRole', () => {
  for (const outcome of ['success', 'database error', 'transport rejection'] as const) {
    test(`${outcome === 'success' ? '[NORMAL]' : '[FAILURE]'} [SG2-24:account-cleanup] attempts cleanup of only the target account and resolves on ${outcome}`, async () => {
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
  test('[NORMAL] [SG2-24:AC3] returns the role for an existing account', async () => {
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

  test('[FAILURE] [SG2-24:AC3] reports user_not_found when no row matches', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: null }) });
    const result = await getAccountRole(admin, 'ghost');
    assert.deepEqual(result, { ok: false, reason: 'user_not_found' });
  });

  test('[FAILURE] [SG2-24:AC3] surfaces a database error', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const result = await getAccountRole(admin, 'coord-1');
    assert.deepEqual(result, { ok: false, reason: 'error', error: 'connection reset' });
  });
});

describe('getAccountRoles', () => {
  function rolesAdmin(result: { data: unknown; error: { message: string } | null }, asked: unknown[] = []): SupabaseClient {
    return {
      from(table: string) {
        assert.equal(table, 'account_roles');
        return {
          select: (columns: string) => ({
            in: async (column: string, values: unknown) => {
              asked.push([columns, column, values]);
              return result;
            }
          })
        };
      }
    } as unknown as SupabaseClient;
  }

  test('[NORMAL] [SG2-40:AC1] reads every requested account\'s role in one query, keyed by user id', async () => {
    const asked: unknown[] = [];
    const result = await getAccountRoles(rolesAdmin({ data: [
      { user_id: 'coord-1', role: 'event_coordinator' },
      { user_id: 'lead-1', role: 'event_coordinator_lead' }
    ], error: null }, asked), ['coord-1', 'lead-1', 'gone-1']);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual([...result.roles], [['coord-1', 'event_coordinator'], ['lead-1', 'event_coordinator_lead']]);
      assert.equal(result.roles.has('gone-1'), false);
    }
    assert.deepEqual(asked, [['user_id, role', 'user_id', ['coord-1', 'lead-1', 'gone-1']]]);
  });

  test('[BOUNDARY] [SG2-40:AC1] null rows read back as no roles', async () => {
    const result = await getAccountRoles(rolesAdmin({ data: null, error: null }), ['ghost']);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.roles.size, 0);
  });

  test('[FAILURE] [SG2-40:AC1] surfaces a database error', async () => {
    const result = await getAccountRoles(rolesAdmin({ data: null, error: { message: 'connection reset' } }), ['coord-1']);
    assert.deepEqual(result, { ok: false, error: 'connection reset' });
  });
});

describe('listCoordinators', () => {
  type Step = { data: any; error: { message: string } | null };

  function fakeListAdmin(roles: Step, users: Step, capture?: (ids: unknown) => void): SupabaseClient {
    return {
      from(table: string) {
        if (table === 'account_roles') {
          return {
            select: (columns: string) => {
              assert.equal(columns, 'user_id');
              return {
                eq: async (column: string, value: string) => {
                  assert.deepEqual([column, value], ['role', 'event_coordinator']);
                  return roles;
                }
              };
            }
          };
        }
        assert.equal(table, 'users');
        return {
          select: (columns: string) => {
            assert.equal(columns, 'user_id, name');
            return {
              in: async (column: string, ids: unknown) => {
                assert.equal(column, 'user_id');
                capture?.(ids);
                return users;
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;
  }

  test('[NORMAL] [SG2-33:AC1] [SG2-34:AC1] returns coordinators with their names, sorted by name', async () => {
    let asked: unknown;
    const result = await listCoordinators(
      fakeListAdmin(
        { data: [{ user_id: 'b' }, { user_id: 'a' }], error: null },
        { data: [{ user_id: 'b', name: 'Zed', extra: 1 }, { user_id: 'a', name: 'Amy' }], error: null },
        (ids) => (asked = ids)
      )
    );
    assert.deepEqual(asked, ['b', 'a']);
    assert.deepEqual(result, {
      ok: true,
      coordinators: [
        { user_id: 'a', name: 'Amy' },
        { user_id: 'b', name: 'Zed' }
      ]
    });
  });

  test('[BOUNDARY] [SG2-33:AC1] [SG2-34:AC1] returns an empty list, without a second query, when nobody holds the role', async () => {
    const admin = fakeListAdmin({ data: [], error: null }, { data: null, error: { message: 'must not run' } });
    assert.deepEqual(await listCoordinators(admin), { ok: true, coordinators: [] });
    const nullRoles = fakeListAdmin({ data: null, error: null }, { data: null, error: { message: 'must not run' } });
    assert.deepEqual(await listCoordinators(nullRoles), { ok: true, coordinators: [] });
  });

  test('[BOUNDARY] [SG2-33:AC1] [SG2-34:AC1] returns an empty list when no profile rows come back', async () => {
    const admin = fakeListAdmin({ data: [{ user_id: 'a' }], error: null }, { data: null, error: null });
    assert.deepEqual(await listCoordinators(admin), { ok: true, coordinators: [] });
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] surfaces a role lookup error', async () => {
    const admin = fakeListAdmin({ data: null, error: { message: 'roles down' } }, { data: [], error: null });
    assert.deepEqual(await listCoordinators(admin), { ok: false, error: 'roles down' });
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] surfaces a profile lookup error', async () => {
    const admin = fakeListAdmin({ data: [{ user_id: 'a' }], error: null }, { data: null, error: { message: 'users down' } });
    assert.deepEqual(await listCoordinators(admin), { ok: false, error: 'users down' });
  });

  // SG2-86: adding the Event Coordinator Lead role does not widen who is
  // assignable as a coordinator. fakeListAdmin's eq() above hard-asserts the
  // queried role is the exact literal 'event_coordinator' (not a value
  // derived from the implementation), so this fails if listCoordinators is
  // ever changed to also match event_coordinator_lead. Deliberate — see the
  // SG2-86 plan of record; SG2-87 decides lead assignability, if ever.
  test('[BOUNDARY] [SG2-86:AC4] queries the exact literal event_coordinator, excluding event_coordinator_lead', async () => {
    const admin = fakeListAdmin(
      { data: [{ user_id: 'a' }], error: null },
      { data: [{ user_id: 'a', name: 'Amy' }], error: null }
    );
    assert.deepEqual(await listCoordinators(admin), { ok: true, coordinators: [{ user_id: 'a', name: 'Amy' }] });
  });
});
