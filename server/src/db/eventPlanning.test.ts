import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchEventPlanningRecord,
  updateEventPlanningFields,
  type UpdatePlanningFieldsInput
} from './eventPlanning';

describe('Event Planning DB operations (SG2-38 / SG2-39)', () => {
  test('fetchEventPlanningRecord retrieves and parses planning details', async () => {
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

  test('fetchEventPlanningRecord returns not_found when event does not exist', async () => {
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

  test('fetchEventPlanningRecord returns unavailable on error', async () => {
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

  test('updateEventPlanningFields updates fields and returns updated record', async () => {
    let capturedUpdates: any = null;
    let capturedId: any = null;

    const updatedEvent = {
      event_id: 101,
      status: 'planning',
      coordinator_id: 'coord-uuid-1',
      organiser_id: 'org-uuid-1',
      expected_attendance: 250,
      proposed_date: '2026-11-01T09:00:00Z',
      venue_requirements: 'Auditorium',
      accessibility_needs: null,
      equipment_requirements: null,
      registration_needed: true,
      registration_capacity: 250,
      registration_opens_at: null,
      registration_closes_at: null,
      planning_notes: null,
      arrangements_recheck_needed: true,
      outstanding_arrangements: ['venue_recheck', 'equipment_recheck']
    };

    const fakeAdmin = {
      from(table: string) {
        assert.equal(table, 'events');
        return {
          update(fields: any) {
            capturedUpdates = fields;
            return {
              eq(col: string, val: any) {
                assert.equal(col, 'event_id');
                capturedId = val;
                return {
                  select: async () => ({ data: [updatedEvent], error: null })
                };
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const updates: UpdatePlanningFieldsInput = {
      expected_attendance: 250,
      registration_capacity: 250,
      arrangements_recheck_needed: true,
      outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
      status: 'planning'
    };

    const result = await updateEventPlanningFields(fakeAdmin, 101, updates);
    assert.deepEqual(capturedUpdates, updates);
    assert.equal(capturedId, 101);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.event.expected_attendance, 250);
      assert.equal(result.event.arrangements_recheck_needed, true);
      assert.deepEqual(result.event.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
    }
  });

  test('updateEventPlanningFields returns not_found if no rows matched', async () => {
    const fakeAdmin = {
      from() {
        return {
          update() {
            return {
              eq() {
                return {
                  select: async () => ({ data: [], error: null })
                };
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await updateEventPlanningFields(fakeAdmin, 999, { planning_notes: 'note' });
    assert.deepEqual(result, { ok: false, reason: 'not_found', message: 'Event not found.' });
  });

  test('updateEventPlanningFields returns unavailable on database error', async () => {
    const fakeAdmin = {
      from() {
        return {
          update() {
            return {
              eq() {
                return {
                  select: async () => ({ data: null, error: { message: 'Write lock timeout' } })
                };
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient;

    const result = await updateEventPlanningFields(fakeAdmin, 101, { planning_notes: 'note' });
    assert.deepEqual(result, { ok: false, reason: 'unavailable', message: 'Write lock timeout' });
  });
});
