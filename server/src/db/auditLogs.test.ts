import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchEventAuditLogs,
  insertAuditLogs,
  type InsertAuditLogInput
} from './auditLogs';

describe('Event Audit Logs DB operations (SG2-39 / SG2-40)', () => {
  describe('insertAuditLogs', () => {
    test('returns empty logs immediately when entries array is empty', async () => {
      let called = false;
      const fakeAdmin = {
        from() {
          called = true;
          return {};
        }
      } as unknown as SupabaseClient;

      const result = await insertAuditLogs(fakeAdmin, []);
      assert.equal(called, false);
      assert.deepEqual(result, { ok: true, logs: [] });
    });

    test('inserts entries and maps returned rows', async () => {
      let capturedTable = '';
      let capturedEntries: any = null;

      const mockReturned = [
        {
          log_id: 1,
          event_id: 101,
          actor_id: 'user-uuid-1',
          field_name: 'expected_attendance',
          old_value: '100',
          new_value: '250',
          created_at: '2026-09-24T10:00:00Z'
        },
        {
          log_id: 2,
          event_id: 101,
          actor_id: 'user-uuid-1',
          field_name: 'planning_notes',
          old_value: null,
          new_value: null,
          created_at: '2026-09-24T10:00:00Z'
        }
      ];

      const fakeAdmin = {
        from(table: string) {
          capturedTable = table;
          return {
            insert(entries: any) {
              capturedEntries = entries;
              return {
                select: async (cols: string) => {
                  assert.ok(cols.includes('log_id'));
                  return { data: mockReturned, error: null };
                }
              };
            }
          };
        }
      } as unknown as SupabaseClient;

      const entries: InsertAuditLogInput[] = [
        {
          event_id: 101,
          actor_id: 'user-uuid-1',
          field_name: 'expected_attendance',
          old_value: '100',
          new_value: '250'
        },
        {
          event_id: 101,
          actor_id: 'user-uuid-1',
          field_name: 'planning_notes',
          old_value: null,
          new_value: 'Updated vendor notes'
        }
      ];

      const result = await insertAuditLogs(fakeAdmin, entries);
      assert.equal(capturedTable, 'event_audit_logs');
      assert.deepEqual(capturedEntries, entries);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.logs.length, 2);
        assert.equal(result.logs[0].log_id, 1);
        assert.equal(result.logs[0].old_value, '100');
        assert.equal(result.logs[0].new_value, '250');
        assert.equal(result.logs[0].actor_name, null);
        assert.equal(result.logs[1].log_id, 2);
        assert.equal(result.logs[1].old_value, null);
        assert.equal(result.logs[1].new_value, null);
      }
    });

    test('handles null returned data gracefully', async () => {
      const fakeAdmin = {
        from() {
          return {
            insert() {
              return {
                select: async () => ({ data: null, error: null })
              };
            }
          };
        }
      } as unknown as SupabaseClient;

      const result = await insertAuditLogs(fakeAdmin, [
        {
          event_id: 101,
          actor_id: 'user-1',
          field_name: 'notes',
          old_value: null,
          new_value: 'abc'
        }
      ]);

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.logs, []);
      }
    });

    test('returns unavailable on database error', async () => {
      const fakeAdmin = {
        from() {
          return {
            insert() {
              return {
                select: async () => ({
                  data: null,
                  error: { message: 'Insert failed due to constraint' }
                })
              };
            }
          };
        }
      } as unknown as SupabaseClient;

      const result = await insertAuditLogs(fakeAdmin, [
        {
          event_id: 101,
          actor_id: 'user-1',
          field_name: 'notes',
          old_value: null,
          new_value: 'abc'
        }
      ]);

      assert.deepEqual(result, {
        ok: false,
        reason: 'unavailable',
        message: 'Insert failed due to constraint'
      });
    });
  });

  describe('fetchEventAuditLogs', () => {
    test('fetches audit logs with ordering and maps fields', async () => {
      let capturedTable = '';
      let capturedEventId: any = null;
      const orderCalls: { col: string; ascending: boolean }[] = [];

      const mockRows = [
        {
          log_id: 10,
          event_id: 101,
          actor_id: 'coord-uuid',
          field_name: 'expected_attendance',
          old_value: '100',
          new_value: '250',
          created_at: '2026-09-24T12:00:00Z',
          actor: [{ name: 'Coordinator Alice' }]
        },
        {
          log_id: 9,
          event_id: 101,
          actor_id: 'coord-uuid-2',
          field_name: 'registration_capacity',
          old_value: null,
          new_value: '250',
          created_at: '2026-09-24T11:00:00Z',
          actor: { name: 'Coordinator Bob' }
        }
      ];

      const fakeClient = {
        from(table: string) {
          capturedTable = table;
          return {
            select(cols: string) {
              assert.ok(cols.includes('actor:users!actor_id(name)'));
              return {
                eq(col: string, val: any) {
                  assert.equal(col, 'event_id');
                  capturedEventId = val;
                  const queryChain: any = {
                    order(orderCol: string, opts: { ascending: boolean }) {
                      orderCalls.push({ col: orderCol, ascending: opts.ascending });
                      return queryChain;
                    },
                    then(resolve: any) {
                      resolve({ data: mockRows, error: null });
                    }
                  };
                  return queryChain;
                }
              };
            }
          };
        }
      } as unknown as SupabaseClient;

      const result = await fetchEventAuditLogs(fakeClient, 101);
      assert.equal(capturedTable, 'event_audit_logs');
      assert.equal(capturedEventId, 101);
      assert.deepEqual(orderCalls, [
        { col: 'created_at', ascending: false },
        { col: 'log_id', ascending: false }
      ]);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.logs.length, 2);
        assert.equal(result.logs[0].log_id, 10);
        assert.equal(result.logs[0].actor_name, 'Coordinator Alice');
        assert.equal(result.logs[0].old_value, '100');
        assert.equal(result.logs[0].new_value, '250');
        assert.equal(result.logs[1].log_id, 9);
        assert.equal(result.logs[1].actor_name, 'Coordinator Bob');
        assert.equal(result.logs[1].old_value, null);
        assert.equal(result.logs[1].new_value, '250');
      }
    });

    test('handles fallback actor_name and malformed actor shapes', async () => {
      const mockRows = [
        {
          log_id: 1,
          event_id: 102,
          actor_id: 'u-1',
          field_name: 'notes',
          old_value: 123, // non-string old_value
          new_value: 456, // non-string new_value
          created_at: '2026-09-24T10:00:00Z',
          actor: [{ name: 12345 }] // non-string name in array
        },
        {
          log_id: 2,
          event_id: 102,
          actor_id: 'u-2',
          field_name: 'notes',
          old_value: null,
          new_value: null,
          created_at: '2026-09-24T10:01:00Z',
          actor: [],
          actor_name: 'Fallback Coordinator'
        },
        {
          log_id: 3,
          event_id: 102,
          actor_id: 'u-3',
          field_name: 'notes',
          old_value: 'old',
          new_value: 'new',
          created_at: '2026-09-24T10:02:00Z',
          actor: { name: null } // non-string name in object
        },
        {
          log_id: 4,
          event_id: 102,
          actor_id: 'u-4',
          field_name: 'notes',
          old_value: 'old',
          new_value: 'new',
          created_at: '2026-09-24T10:03:00Z',
          actor_name: 'Direct Actor Name'
        },
        {
          log_id: 5,
          event_id: 102,
          actor_id: 'u-5',
          field_name: 'notes',
          old_value: 'old',
          new_value: 'new',
          created_at: '2026-09-24T10:04:00Z'
          // no actor and no actor_name
        }
      ];

      const fakeClient = {
        from() {
          return {
            select() {
              return {
                eq() {
                  const queryChain: any = {
                    order() {
                      return queryChain;
                    },
                    then(resolve: any) {
                      resolve({ data: mockRows, error: null });
                    }
                  };
                  return queryChain;
                }
              };
            }
          };
        }
      } as unknown as SupabaseClient;

      const result = await fetchEventAuditLogs(fakeClient, 102);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.logs.length, 5);
        assert.equal(result.logs[0].actor_name, null);
        assert.equal(result.logs[0].old_value, null);
        assert.equal(result.logs[0].new_value, null);

        assert.equal(result.logs[1].actor_name, 'Fallback Coordinator');

        assert.equal(result.logs[2].actor_name, null);

        assert.equal(result.logs[3].actor_name, 'Direct Actor Name');

        assert.equal(result.logs[4].actor_name, null);
      }
    });

    test('handles null returned rows on fetch', async () => {
      const fakeClient = {
        from() {
          return {
            select() {
              return {
                eq() {
                  const queryChain: any = {
                    order() {
                      return queryChain;
                    },
                    then(resolve: any) {
                      resolve({ data: null, error: null });
                    }
                  };
                  return queryChain;
                }
              };
            }
          };
        }
      } as unknown as SupabaseClient;

      const result = await fetchEventAuditLogs(fakeClient, 103);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.logs, []);
      }
    });

    test('returns unavailable on database error', async () => {
      const fakeClient = {
        from() {
          return {
            select() {
              return {
                eq() {
                  const queryChain: any = {
                    order() {
                      return queryChain;
                    },
                    then(resolve: any) {
                      resolve({ data: null, error: { message: 'Connection terminated' } });
                    }
                  };
                  return queryChain;
                }
              };
            }
          };
        }
      } as unknown as SupabaseClient;

      const result = await fetchEventAuditLogs(fakeClient, 101);
      assert.deepEqual(result, {
        ok: false,
        reason: 'unavailable',
        message: 'Connection terminated'
      });
    });
  });
});
