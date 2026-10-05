import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchEventPlanningRecord,
  updateEventPlanningFields,
  type UpdatePlanningFieldsInput
} from './eventPlanning';

describe('Event Planning DB operations (SG2-38 / SG2-39)', () => {
  test('[NORMAL] [SG2-38:AC1] [SG2-39:AC1] fetchEventPlanningRecord retrieves and parses planning details', async () => {
    let capturedTable = '';
    let capturedId: any = null;

    const mockEvent = {
      event_id: 101,
      status: 'planning',
      coordinator_id: 'coord-uuid-1',
      organiser_id: 'org-uuid-1',
      expected_attendance: 150,
      proposed_date: '2026-11-01T09:00:00Z',
      venue_requirements: 'Auditorium',
      accessibility_needs: 'Wheelchair ramp',
      equipment_requirements: 'Projector',
      registration_needed: true,
      registration_capacity: 150,
      registration_opens_at: '2026-10-01T09:00:00Z',
      registration_closes_at: '2026-10-15T18:00:00Z',
      planning_notes: 'Catering vendor contacted',
      arrangements_recheck_needed: true,
      outstanding_arrangements: ['venue_recheck']
    };

    const fakeClient = {
      from(table: string) {
        capturedTable = table;
        return {
          select(columns: string) {
            assert.ok(columns.includes('registration_capacity'));
            return {
              eq: async (col: string, val: any) => {
                assert.equal(col, 'event_id');
                capturedId = val;
                return { data: [mockEvent], error: null };
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await fetchEventPlanningRecord(fakeClient, 101);
    assert.equal(capturedTable, 'events');
    assert.equal(capturedId, 101);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.event_id, 101);
      assert.equal(result.event.registration_capacity, 150);
      assert.equal(result.event.arrangements_recheck_needed, true);
      assert.deepEqual(result.event.outstanding_arrangements, ['venue_recheck']);
    }
  });

  test('[FAILURE] [SG2-38:AC1] [SG2-39:AC1] fetchEventPlanningRecord returns not_found when event does not exist', async () => {
    const fakeClient = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({ data: [], error: null })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await fetchEventPlanningRecord(fakeClient, 999);
    assert.deepEqual(result, { ok: false, reason: 'not_found', message: 'Event not found.' });
  });

  test('[FAILURE] [SG2-38:AC1] [SG2-39:AC1] fetchEventPlanningRecord returns unavailable on error', async () => {
    const fakeClient = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({ data: null, error: { message: 'Database query failed' } })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await fetchEventPlanningRecord(fakeClient, 101);
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'Database query failed' });
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-39:AC1] fetchEventPlanningRecord extracts coordinator name from array relation', async () => {
    const fakeClient = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ event_id: 102, coordinator: [{ name: 'Alice Array' }] }],
                error: null
              })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await fetchEventPlanningRecord(fakeClient, 102);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.coordinator_name, 'Alice Array');
    }
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-39:AC1] fetchEventPlanningRecord extracts coordinator name from object relation', async () => {
    const fakeClient = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ event_id: 103, coordinator: { name: 'Bob Object' } }],
                error: null
              })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await fetchEventPlanningRecord(fakeClient, 103);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.coordinator_name, 'Bob Object');
    }
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-39:AC1] fetchEventPlanningRecord uses coordinator_name fallback when coordinator relation is not present', async () => {
    const fakeClient = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ event_id: 104, coordinator_name: 'Charlie Fallback' }],
                error: null
              })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await fetchEventPlanningRecord(fakeClient, 104);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.coordinator_name, 'Charlie Fallback');
    }
  });

  test('[FAILURE] [SG2-38:AC1] [SG2-39:AC1] fetchEventPlanningRecord handles coordinator without string name and no fallback', async () => {
    // Array with non-string name
    const fakeClientArray = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ event_id: 105, coordinator: [{ name: 123 }] }],
                error: null
              })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result1 = await fetchEventPlanningRecord(fakeClientArray, 105);
    assert.equal(result1.ok, true);
    if (result1.ok) {
      assert.equal(result1.event.coordinator_name, null);
    }

    // Object with non-string name
    const fakeClientObject = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ event_id: 106, coordinator: { name: null } }],
                error: null
              })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result2 = await fetchEventPlanningRecord(fakeClientObject, 106);
    assert.equal(result2.ok, true);
    if (result2.ok) {
      assert.equal(result2.event.coordinator_name, null);
    }

    // Empty array coordinator with coordinator_name fallback
    const fakeClientEmptyArray = {
      from() {
        return {
          select() {
            return {
              eq: async () => ({
                data: [{ event_id: 107, coordinator: [], coordinator_name: 'Fallback After Empty Array' }],
                error: null
              })
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result3 = await fetchEventPlanningRecord(fakeClientEmptyArray, 107);
    assert.equal(result3.ok, true);
    if (result3.ok) {
      assert.equal(result3.event.coordinator_name, 'Fallback After Empty Array');
    }
  });

  /** A stateful `events` table: update() applies only to rows matching every .eq() filter. */
  function fakeEventsTable(rows: Record<string, unknown>[], failWith?: string) {
    return {
      from(table: string) {
        assert.equal(table, 'events');
        return {
          update(fields: Record<string, unknown>) {
            const filters: [string, unknown][] = [];
            const builder = {
              eq(column: string, value: unknown) {
                filters.push([column, value]);
                return builder;
              },
              async select() {
                if (failWith) return { data: null, error: { message: failWith } };
                const matched = rows.filter(row => filters.every(([column, value]) => row[column] === value));
                for (const row of matched) Object.assign(row, fields);
                return { data: matched.map(row => ({ ...row })), error: null };
              }
            };
            return builder;
          }
        };
      }
    } as unknown as SupabaseClient;
  }

  test('[NORMAL] [SG2-39:AC1] [SG2-39:AC4] updateEventPlanningFields updates fields and returns updated record', async () => {
    const rows: Record<string, unknown>[] = [{
      event_id: 101, status: 'approved', coordinator_id: 'coord-uuid-1', organiser_id: 'org-uuid-1',
      expected_attendance: 150, arrangements_recheck_needed: false, outstanding_arrangements: []
    }];
    const updates: UpdatePlanningFieldsInput = {
      expected_attendance: 250,
      registration_capacity: 250,
      arrangements_recheck_needed: true,
      outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
      status: 'planning'
    };

    const result = await updateEventPlanningFields(fakeEventsTable(rows), 101, updates, 'coord-uuid-1');

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.expected_attendance, 250);
      assert.equal(result.event.status, 'planning');
      assert.equal(result.event.arrangements_recheck_needed, true);
      assert.deepEqual(result.event.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
    }
    assert.equal(rows[0].registration_capacity, 250);
  });

  test('[CONFLICT] [SG2-90:AC3] updateEventPlanningFields changes nothing for a coordinator the event was reassigned away from', async () => {
    const rows = [{ event_id: 101, status: 'planning', coordinator_id: 'coord-new', planning_notes: 'kept' }];

    const stale = await updateEventPlanningFields(fakeEventsTable(rows), 101, { planning_notes: 'stale write' }, 'coord-old');
    assert.deepEqual(stale, { ok: false, reason: 'not_found', message: 'Event not found.' });
    assert.equal(rows[0].planning_notes, 'kept');

    const current = await updateEventPlanningFields(fakeEventsTable(rows), 101, { planning_notes: 'current write' }, 'coord-new');
    assert.equal(current.ok, true);
    assert.equal(rows[0].planning_notes, 'current write');
  });

  test('[CONFLICT] [SG2-90:AC4] updateEventPlanningFields changes nothing on an unassigned event, whoever asks', async () => {
    const rows = [{ event_id: 102, status: 'submitted', coordinator_id: null, planning_notes: null }];

    const result = await updateEventPlanningFields(fakeEventsTable(rows), 102, { planning_notes: 'x' }, 'coord-uuid-1');

    assert.equal(result.ok, false);
    assert.equal(rows[0].planning_notes, null);
  });

  test('[BOUNDARY] [SG2-39:AC3] updateEventPlanningFields falls back to empty array when outstanding_arrangements is null', async () => {
    const rows = [{ event_id: 108, coordinator_id: 'coord-uuid-1', outstanding_arrangements: null }];

    const result = await updateEventPlanningFields(fakeEventsTable(rows), 108, { planning_notes: 'note' }, 'coord-uuid-1');

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.event.outstanding_arrangements, []);
    }
  });

  test('[FAILURE] [SG2-39:AC1] updateEventPlanningFields returns not_found if no rows matched', async () => {
    const result = await updateEventPlanningFields(fakeEventsTable([]), 999, { planning_notes: 'note' }, 'coord-uuid-1');
    assert.deepEqual(result, { ok: false, reason: 'not_found', message: 'Event not found.' });
  });

  test('[FAILURE] [SG2-39:AC1] updateEventPlanningFields returns unavailable on database error', async () => {
    const rows = [{ event_id: 101, coordinator_id: 'coord-uuid-1' }];
    const result = await updateEventPlanningFields(fakeEventsTable(rows, 'Write lock timeout'), 101, { planning_notes: 'note' }, 'coord-uuid-1');
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'Write lock timeout' });
  });
});
