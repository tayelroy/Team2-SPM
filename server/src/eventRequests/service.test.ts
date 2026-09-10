import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createEventRequestDraft,
  getEventRequestForOrganiser,
  submitEventRequest,
  updateEventRequestDraft
} from './service';

const organiserId = '10000000-0000-4000-8000-000000000001';
const requestId = 'aaaaaaaa-0000-4000-8000-000000000001';

const completeRow = {
  id: requestId,
  organiser_id: organiserId,
  status: 'draft',
  event_name: 'Partner Forum',
  purpose: 'Strengthen institutional partnerships',
  description: 'A half-day forum with keynotes and a panel.',
  proposed_date_time: '2026-10-12T09:00:00Z',
  expected_attendance: 180,
  venue_requirements: 'Stage, step-free access, hearing loop',
  equipment_requirements: 'Lectern and PA system',
  registration_needed: true,
  accessibility_needs: null,
  submitted_at: null
};

const draftRow = { ...completeRow, event_name: null };

function fakeAdmin(options: {
  insert?: (row: any) => Promise<{ data: any; error: any }>;
  select?: (filters: Record<string, string>) => Promise<{ data: any; error: any }>;
  update?: (patch: any, filters: Record<string, string>) => Promise<{ data: any; error: any }>;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table !== 'event_requests') throw new Error(`Unexpected table: ${table}`);
      return {
        insert(row: any) {
          return { select: () => ({ single: () => options.insert!(row) }) };
        },
        select() {
          const filters: Record<string, string> = {};
          const builder = {
            eq(column: string, value: string) {
              filters[column] = value;
              return builder;
            },
            maybeSingle: () => options.select!(filters)
          };
          return builder;
        },
        update(patch: any) {
          const filters: Record<string, string> = {};
          const builder = {
            eq(column: string, value: string) {
              filters[column] = value;
              return builder;
            },
            select: () => ({ maybeSingle: () => options.update!(patch, filters) })
          };
          return builder;
        }
      };
    }
  } as unknown as SupabaseClient;
}

describe('createEventRequestDraft', () => {
  test('creates a draft and maps it back to record fields', async () => {
    let insertedRow: any;
    const admin = fakeAdmin({
      insert: async (row) => {
        insertedRow = row;
        return { data: draftRow, error: null };
      }
    });

    const result = await createEventRequestDraft(admin, organiserId);

    assert.deepEqual(insertedRow, { organiser_id: organiserId, status: 'draft' });
    assert.equal(result.outcome, 'created');
    assert.equal((result as any).request.status, 'draft');
    assert.equal((result as any).request.organiserId, organiserId);
    assert.equal((result as any).request.eventName, undefined);
  });

  test('maps every provided field onto its column', async () => {
    let insertedRow: any;
    const admin = fakeAdmin({
      insert: async (row) => {
        insertedRow = row;
        return { data: completeRow, error: null };
      }
    });

    await createEventRequestDraft(admin, organiserId, {
      eventName: completeRow.event_name,
      purpose: completeRow.purpose,
      description: completeRow.description,
      proposedDateTime: completeRow.proposed_date_time,
      expectedAttendance: completeRow.expected_attendance,
      venueRequirements: completeRow.venue_requirements,
      equipmentRequirements: completeRow.equipment_requirements,
      registrationNeeded: completeRow.registration_needed,
      accessibilityNeeds: completeRow.accessibility_needs
    });

    assert.deepEqual(insertedRow, {
      organiser_id: organiserId,
      status: 'draft',
      event_name: completeRow.event_name,
      purpose: completeRow.purpose,
      description: completeRow.description,
      proposed_date_time: completeRow.proposed_date_time,
      expected_attendance: completeRow.expected_attendance,
      venue_requirements: completeRow.venue_requirements,
      equipment_requirements: completeRow.equipment_requirements,
      registration_needed: completeRow.registration_needed,
      accessibility_needs: completeRow.accessibility_needs
    });
  });

  test('surfaces the database error message when the insert fails', async () => {
    const admin = fakeAdmin({ insert: async () => ({ data: null, error: { message: 'connection reset' } }) });
    const result = await createEventRequestDraft(admin, organiserId);
    assert.deepEqual(result, { outcome: 'unavailable', message: 'connection reset' });
  });

  test('falls back to a generic message when the insert reports no data and no error', async () => {
    const admin = fakeAdmin({ insert: async () => ({ data: null, error: null }) });
    const result = await createEventRequestDraft(admin, organiserId);
    assert.equal(result.outcome, 'unavailable');
    assert.match((result as any).message, /temporarily unavailable/);
  });
});

describe('getEventRequestForOrganiser', () => {
  test('returns the request scoped to the requesting organiser', async () => {
    const admin = fakeAdmin({
      select: async (filters) => {
        assert.deepEqual(filters, { id: requestId, organiser_id: organiserId });
        return { data: completeRow, error: null };
      }
    });
    const result = await getEventRequestForOrganiser(admin, organiserId, requestId);
    assert.equal(result.outcome, 'found');
    assert.equal((result as any).request.id, requestId);
  });

  test('reports not_found when no row matches', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: null }) });
    const result = await getEventRequestForOrganiser(admin, organiserId, requestId);
    assert.deepEqual(result, { outcome: 'not_found' });
  });

  test('surfaces a lookup failure', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: { message: 'timeout' } }) });
    const result = await getEventRequestForOrganiser(admin, organiserId, requestId);
    assert.deepEqual(result, { outcome: 'unavailable', message: 'timeout' });
  });

  test('maps a freshly created draft with every field still blank', async () => {
    const blankRow = {
      id: requestId,
      organiser_id: organiserId,
      status: 'draft',
      event_name: null,
      purpose: null,
      description: null,
      proposed_date_time: null,
      expected_attendance: null,
      venue_requirements: null,
      equipment_requirements: null,
      registration_needed: null,
      accessibility_needs: null,
      submitted_at: null
    };
    const admin = fakeAdmin({ select: async () => ({ data: blankRow, error: null }) });
    const result = await getEventRequestForOrganiser(admin, organiserId, requestId);
    assert.equal(result.outcome, 'found');
    assert.deepEqual((result as any).request, {
      id: requestId,
      organiserId,
      status: 'draft',
      eventName: undefined,
      purpose: undefined,
      description: undefined,
      proposedDateTime: undefined,
      expectedAttendance: undefined,
      venueRequirements: undefined,
      equipmentRequirements: undefined,
      registrationNeeded: undefined,
      accessibilityNeeds: null,
      submittedAt: null
    });
  });

  test('carries a provided accessibility needs value through', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: { ...completeRow, accessibility_needs: 'Wheelchair access required' }, error: null })
    });
    const result = await getEventRequestForOrganiser(admin, organiserId, requestId);
    assert.equal((result as any).request.accessibilityNeeds, 'Wheelchair access required');
  });
});

describe('updateEventRequestDraft', () => {
  test('updates a draft and returns the mapped record', async () => {
    let updatePatch: any;
    let updateFilters: any;
    const admin = fakeAdmin({
      select: async () => ({ data: draftRow, error: null }),
      update: async (patch, filters) => {
        updatePatch = patch;
        updateFilters = filters;
        return { data: { ...draftRow, event_name: 'Updated name' }, error: null };
      }
    });

    const result = await updateEventRequestDraft(admin, organiserId, requestId, { eventName: 'Updated name' });

    assert.deepEqual(updatePatch, { event_name: 'Updated name' });
    assert.deepEqual(updateFilters, { id: requestId, organiser_id: organiserId, status: 'draft' });
    assert.equal(result.outcome, 'updated');
    assert.equal((result as any).request.eventName, 'Updated name');
  });

  test('reports not_found without attempting an update', async () => {
    let updateCalled = false;
    const admin = fakeAdmin({
      select: async () => ({ data: null, error: null }),
      update: async () => {
        updateCalled = true;
        return { data: null, error: null };
      }
    });
    const result = await updateEventRequestDraft(admin, organiserId, requestId, {});
    assert.deepEqual(result, { outcome: 'not_found' });
    assert.equal(updateCalled, false);
  });

  test('surfaces a lookup failure without attempting an update', async () => {
    let updateCalled = false;
    const admin = fakeAdmin({
      select: async () => ({ data: null, error: { message: 'timeout' } }),
      update: async () => {
        updateCalled = true;
        return { data: null, error: null };
      }
    });
    const result = await updateEventRequestDraft(admin, organiserId, requestId, {});
    assert.deepEqual(result, { outcome: 'unavailable', message: 'timeout' });
    assert.equal(updateCalled, false);
  });

  test('refuses to edit a request that has already been submitted (SG2-30 AC3)', async () => {
    let updateCalled = false;
    const admin = fakeAdmin({
      select: async () => ({ data: { ...completeRow, status: 'submitted' }, error: null }),
      update: async () => {
        updateCalled = true;
        return { data: null, error: null };
      }
    });
    const result = await updateEventRequestDraft(admin, organiserId, requestId, { eventName: 'New name' });
    assert.deepEqual(result, { outcome: 'locked' });
    assert.equal(updateCalled, false);
  });

  test('surfaces a database error from the update', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: draftRow, error: null }),
      update: async () => ({ data: null, error: { message: 'write failed' } })
    });
    const result = await updateEventRequestDraft(admin, organiserId, requestId, {});
    assert.deepEqual(result, { outcome: 'unavailable', message: 'write failed' });
  });

  test('treats a lost race against a concurrent submit as locked', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: draftRow, error: null }),
      update: async () => ({ data: null, error: null })
    });
    const result = await updateEventRequestDraft(admin, organiserId, requestId, {});
    assert.deepEqual(result, { outcome: 'locked' });
  });
});

describe('submitEventRequest', () => {
  test('submits a complete draft and stamps submitted_at (SG2-30 AC1)', async () => {
    let updatePatch: any;
    let updateFilters: any;
    const admin = fakeAdmin({
      select: async () => ({ data: completeRow, error: null }),
      update: async (patch, filters) => {
        updatePatch = patch;
        updateFilters = filters;
        return { data: { ...completeRow, status: 'submitted', submitted_at: patch.submitted_at }, error: null };
      }
    });

    const result = await submitEventRequest(admin, organiserId, requestId);

    assert.equal(updatePatch.status, 'submitted');
    assert.equal(typeof updatePatch.submitted_at, 'string');
    assert.deepEqual(updateFilters, { id: requestId, organiser_id: organiserId, status: 'draft' });
    assert.equal(result.outcome, 'submitted');
    assert.equal((result as any).request.status, 'submitted');
    assert.equal(typeof (result as any).request.submittedAt, 'string');
  });

  test('refuses with the outstanding fields for an incomplete draft (SG2-30 AC2)', async () => {
    let updateCalled = false;
    const admin = fakeAdmin({
      select: async () => ({ data: draftRow, error: null }),
      update: async () => {
        updateCalled = true;
        return { data: null, error: null };
      }
    });

    const result = await submitEventRequest(admin, organiserId, requestId);

    assert.equal(result.outcome, 'invalid');
    assert.deepEqual((result as any).missingFields, ['Event name']);
    assert.equal(updateCalled, false);
  });

  test('reports not_found for a request the organiser does not own', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: null }) });
    const result = await submitEventRequest(admin, organiserId, requestId);
    assert.deepEqual(result, { outcome: 'not_found' });
  });

  test('surfaces a lookup failure', async () => {
    const admin = fakeAdmin({ select: async () => ({ data: null, error: { message: 'timeout' } }) });
    const result = await submitEventRequest(admin, organiserId, requestId);
    assert.deepEqual(result, { outcome: 'unavailable', message: 'timeout' });
  });

  test('refuses to resubmit an already submitted request (SG2-30 AC3)', async () => {
    let updateCalled = false;
    const admin = fakeAdmin({
      select: async () => ({ data: { ...completeRow, status: 'submitted', submitted_at: '2026-09-01T00:00:00Z' }, error: null }),
      update: async () => {
        updateCalled = true;
        return { data: null, error: null };
      }
    });
    const result = await submitEventRequest(admin, organiserId, requestId);
    assert.deepEqual(result, { outcome: 'already_submitted' });
    assert.equal(updateCalled, false);
  });

  test('surfaces a database error from the submit update', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: completeRow, error: null }),
      update: async () => ({ data: null, error: { message: 'write failed' } })
    });
    const result = await submitEventRequest(admin, organiserId, requestId);
    assert.deepEqual(result, { outcome: 'unavailable', message: 'write failed' });
  });

  test('treats a lost race against a concurrent submit as already submitted', async () => {
    const admin = fakeAdmin({
      select: async () => ({ data: completeRow, error: null }),
      update: async () => ({ data: null, error: null })
    });
    const result = await submitEventRequest(admin, organiserId, requestId);
    assert.deepEqual(result, { outcome: 'already_submitted' });
  });
});
