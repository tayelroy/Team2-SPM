import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAccountRole, changeAccountRoles, deleteAccountRole, getHeldRoles, getAccountRoles, listCoordinators, COORDINATOR_ID_BATCH } from './accountRoles';

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
                order: async (orderBy: string) => {
                  assert.equal(orderBy, 'role');
                  return options.select ? options.select(value) : { data: [{ role: 'event_coordinator' }], error: null };
                }
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

describe('changeAccountRoles', () => {
  function rpcAdmin(answer: { data: unknown; error: { code?: string; message: string } | null }, calls: unknown[] = []): SupabaseClient {
    return { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return answer; } } as unknown as SupabaseClient;
  }

  test('[NORMAL] [SG2-104:AC1] replaces the target\'s roles through the database function with the verified actor', async () => {
    const calls: unknown[] = [];
    const result = await changeAccountRoles(rpcAdmin({ data: { outcome: 'changed', roles: ['venue_staff'] }, error: null }, calls),
      'support-1', 'target-1', 'replace', 'venue_staff');
    assert.deepEqual(result, { outcome: 'changed', roles: ['venue_staff'] });
    assert.deepEqual(calls, [['change_account_roles', { p_actor_id: 'support-1', p_target_id: 'target-1', p_action: 'replace', p_role: 'venue_staff' }]]);
  });

  test('[FAILURE] [SG2-104:AC2] passes on the database refusals and reports anything else as an error', async () => {
    for (const outcome of ['self', 'forbidden', 'missing', 'last_role', 'invalid'] as const) {
      assert.deepEqual(await changeAccountRoles(rpcAdmin({ data: { outcome }, error: null }), 'a', 'b', 'replace', 'attendee'), { outcome });
    }
    for (const data of [{ outcome: 'changed', roles: 'attendee' }, { outcome: 'surprise' }, null]) {
      assert.deepEqual(await changeAccountRoles(rpcAdmin({ data, error: null }), 'a', 'b', 'replace', 'attendee'), { outcome: 'error' });
    }
    assert.deepEqual(await changeAccountRoles(rpcAdmin({ data: null, error: { message: 'down' } }), 'a', 'b', 'replace', 'attendee'), { outcome: 'error' });
    assert.deepEqual(await changeAccountRoles(rpcAdmin({ data: null, error: { code: '22P02', message: 'bad uuid' } }), 'a', 'x', 'replace', 'attendee'), { outcome: 'missing' });
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

describe('getHeldRoles', () => {
  test('[NORMAL] [SG2-104:AC1] returns every role an account holds', async () => {
    let askedFor: unknown;
    const admin = fakeAdmin({ select: async (userId) => { askedFor = userId; return { data: [{ role: 'event_coordinator' }, { role: 'event_organiser' }], error: null }; } });
    assert.deepEqual(await getHeldRoles(admin, 'coord-1'), { ok: true, roles: ['event_coordinator', 'event_organiser'] });
    assert.equal(askedFor, 'coord-1');
  });

  test('[FAILURE] [SG2-104:AC2] no rows or a malformed id is user_not_found; other errors are surfaced', async () => {
    assert.deepEqual(await getHeldRoles(fakeAdmin({ select: async () => ({ data: [], error: null }) }), 'ghost'), { ok: false, reason: 'user_not_found' });
    assert.deepEqual(await getHeldRoles(fakeAdmin({ select: async () => ({ data: null, error: null }) }), 'ghost'), { ok: false, reason: 'user_not_found' });
    assert.deepEqual(await getHeldRoles(fakeAdmin({ select: async () => ({ data: null, error: { code: '22P02', message: 'bad' } as any }) }), 'x'), { ok: false, reason: 'user_not_found' });
    assert.deepEqual(await getHeldRoles(fakeAdmin({ select: async () => ({ data: null, error: { message: 'connection reset' } }) }), 'c'),
      { ok: false, reason: 'error', error: 'connection reset' });
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
      { user_id: 'lead-1', role: 'event_coordinator_lead' },
      { user_id: 'coord-1', role: 'event_organiser' }
    ], error: null }, asked), ['coord-1', 'lead-1', 'gone-1']);
    assert.equal(result.ok, true);
    if (result.ok) {
      // SG2-104: an account may hold several roles; all of them are kept.
      assert.deepEqual([...result.roles], [['coord-1', ['event_coordinator', 'event_organiser']], ['lead-1', ['event_coordinator_lead']]]);
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

  // SG2-96 capacity review: 600 coordinator ids in one `in` filter made a URL
  // the database gateway refused, so the Lead's queue answered 503.
  function batchedAdmin(count: number, failBatch?: number) {
    const ids = Array.from({ length: count }, (_, index) => `coordinator-${String(index).padStart(3, '0')}`);
    const asked: string[][] = [];
    const admin = {
      from(table: string) {
        if (table === 'account_roles') {
          return { select: () => ({ eq: async () => ({ data: ids.map(user_id => ({ user_id })), error: null }) }) };
        }
        return {
          select: () => ({
            in: async (_column: string, batch: string[]) => {
              asked.push(batch);
              return asked.length === failBatch
                ? { data: null, error: { message: 'batch down' } }
                : { data: batch.map(user_id => ({ user_id, name: `Name ${user_id}` })), error: null };
            }
          })
        };
      }
    } as unknown as SupabaseClient;
    return { admin, asked };
  }

  test('[BOUNDARY] [SG2-33:AC1] [SG2-34:AC1] reads a large coordinator list in batches of 100 and returns every coordinator once', async () => {
    const { admin, asked } = batchedAdmin(205);
    const result = await listCoordinators(admin);
    assert.equal(COORDINATOR_ID_BATCH, 100);
    assert.deepEqual(asked.map(batch => batch.length), [100, 100, 5]);
    assert.equal(new Set(asked.flat()).size, 205);
    assert.ok(result.ok);
    assert.equal(result.coordinators.length, 205);
    assert.deepEqual(result.coordinators[0], { user_id: 'coordinator-000', name: 'Name coordinator-000' });
    assert.deepEqual(result.coordinators[204], { user_id: 'coordinator-204', name: 'Name coordinator-204' });
  });

  test('[FAILURE] [SG2-33:AC1] [SG2-34:AC1] fails the whole list when one batch fails, rather than showing part of it', async () => {
    const { admin } = batchedAdmin(150, 2);
    assert.deepEqual(await listCoordinators(admin), { ok: false, error: 'batch down' });
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
