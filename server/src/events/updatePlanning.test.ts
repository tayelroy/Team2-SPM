import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from '../app';
import { createAuthorization } from '../auth';
import { PERMISSIONS, permissionsFor, type Principal, type Role } from '../auth/policy';
import { dbConfig } from '../db/config';
import {
  createUpdateEventPlanningHandler,
  validatePlanningUpdateInput,
  detectArrangementImpact,
  computePlanningDiffs,
  formatAuditValue,
  AUDITED_PLANNING_FIELDS,
  type UpdateEventPlanningDependencies
} from './updatePlanning';
import type {
  EventPlanningRecord,
  FetchEventPlanningResult,
  UpdateEventPlanningResult,
  UpdatePlanningFieldsInput
} from '../db/eventPlanning';
import type { InsertAuditLogInput, InsertAuditLogsResult } from '../db/auditLogs';

const COORDINATOR_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_COORDINATOR_ID = '20000000-0000-4000-8000-000000000002';
const COORDINATOR: Principal = { userId: COORDINATOR_ID, role: 'event_coordinator' };

const BASE_EVENT: EventPlanningRecord = {
  event_id: 10,
  status: 'approved',
  coordinator_id: COORDINATOR_ID,
  coordinator_name: 'Alex Coordinator',
  organiser_id: 'org-user-1',
  expected_attendance: 100,
  proposed_date: '2026-11-15T09:00:00.000Z',
  venue_requirements: 'Large hall with projector',
  accessibility_needs: 'Wheelchair access',
  equipment_requirements: 'Wireless mics',
  registration_needed: true,
  registration_capacity: 100,
  registration_opens_at: '2026-10-01T09:00:00.000Z',
  registration_closes_at: '2026-11-01T18:00:00.000Z',
  planning_notes: 'Initial planning notes',
  arrangements_recheck_needed: false,
  outstanding_arrangements: []
};

describe('validatePlanningUpdateInput (AC 4)', () => {
  test('rejects non-object request bodies', () => {
    assert.deepEqual(validatePlanningUpdateInput(null), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput('not an object'), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput([1, 2, 3]), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
  });

  test('validates expected_attendance', () => {
    // null is allowed
    assert.equal(validatePlanningUpdateInput({ expected_attendance: null }).valid, true);

    // non-numbers / floats
    const stringAtt = validatePlanningUpdateInput({ expected_attendance: '100' });
    assert.equal(stringAtt.valid, false);
    if (!stringAtt.valid) {
      assert.deepEqual(stringAtt.errors, ['expected_attendance must be a whole number.']);
    }

    const floatAtt = validatePlanningUpdateInput({ expected_attendance: 50.5 });
    assert.equal(floatAtt.valid, false);
    if (!floatAtt.valid) {
      assert.deepEqual(floatAtt.errors, ['expected_attendance must be a whole number.']);
    }

    // less than 1
    const zeroAtt = validatePlanningUpdateInput({ expected_attendance: 0 });
    assert.equal(zeroAtt.valid, false);
    if (!zeroAtt.valid) {
      assert.deepEqual(zeroAtt.errors, ['expected_attendance must be at least 1.']);
    }

    const negAtt = validatePlanningUpdateInput({ expected_attendance: -5 });
    assert.equal(negAtt.valid, false);
    if (!negAtt.valid) {
      assert.deepEqual(negAtt.errors, ['expected_attendance must be at least 1.']);
    }

    // overflow
    const overAtt = validatePlanningUpdateInput({ expected_attendance: 3_000_000_000 });
    assert.equal(overAtt.valid, false);
    if (!overAtt.valid) {
      assert.deepEqual(overAtt.errors, ['expected_attendance must be at most 2147483647.']);
    }

    // valid integer
    const validAtt = validatePlanningUpdateInput({ expected_attendance: 250 });
    assert.equal(validAtt.valid, true);
    if (validAtt.valid) {
      assert.equal(validAtt.values.expected_attendance, 250);
    }
  });

  test('validates proposed_date', () => {
    assert.equal(validatePlanningUpdateInput({ proposed_date: null }).valid, true);

    const nonString = validatePlanningUpdateInput({ proposed_date: 12345 });
    assert.equal(nonString.valid, false);
    if (!nonString.valid) {
      assert.deepEqual(nonString.errors, ['proposed_date must be an ISO 8601 date-time string.']);
    }

    const empty = validatePlanningUpdateInput({ proposed_date: '   ' });
    assert.equal(empty.valid, false);
    if (!empty.valid) {
      assert.deepEqual(empty.errors, ['proposed_date must be an ISO 8601 date-time string.']);
    }

    const invalidDate = validatePlanningUpdateInput({ proposed_date: 'not-a-date' });
    assert.equal(invalidDate.valid, false);
    if (!invalidDate.valid) {
      assert.deepEqual(invalidDate.errors, ['proposed_date must be a valid date and time.']);
    }

    const validDate = validatePlanningUpdateInput({ proposed_date: '2026-11-20T10:00:00Z' });
    assert.equal(validDate.valid, true);
    if (validDate.valid) {
      assert.equal(validDate.values.proposed_date, '2026-11-20T10:00:00.000Z');
    }
  });

  test('validates free-text fields and text length limits', () => {
    for (const field of ['venue_requirements', 'equipment_requirements', 'accessibility_needs', 'planning_notes'] as const) {
      // null is allowed
      assert.equal(validatePlanningUpdateInput({ [field]: null }).valid, true);

      // non-string
      const nonString = validatePlanningUpdateInput({ [field]: 123 });
      assert.equal(nonString.valid, false);
      if (!nonString.valid) {
        assert.deepEqual(nonString.errors, [`${field} must be text.`]);
      }

      // over limit
      const tooLong = validatePlanningUpdateInput({ [field]: 'x'.repeat(5001) });
      assert.equal(tooLong.valid, false);
      if (!tooLong.valid) {
        assert.deepEqual(tooLong.errors, [`${field} must be 5000 characters or fewer.`]);
      }

      // empty / whitespace maps to null
      const blank = validatePlanningUpdateInput({ [field]: '   ' });
      assert.equal(blank.valid, true);
      if (blank.valid) {
        assert.equal(blank.values[field], null);
      }

      // valid string trimmed
      const valid = validatePlanningUpdateInput({ [field]: '  some text  ' });
      assert.equal(valid.valid, true);
      if (valid.valid) {
        assert.equal(valid.values[field], 'some text');
      }
    }
  });

  test('validates registration_needed', () => {
    assert.equal(validatePlanningUpdateInput({ registration_needed: null }).valid, true);

    const nonBool = validatePlanningUpdateInput({ registration_needed: 'true' });
    assert.equal(nonBool.valid, false);
    if (!nonBool.valid) {
      assert.deepEqual(nonBool.errors, ['registration_needed must be true or false.']);
    }

    const validTrue = validatePlanningUpdateInput({ registration_needed: true });
    assert.equal(validTrue.valid, true);
    if (validTrue.valid) assert.equal(validTrue.values.registration_needed, true);

    const validFalse = validatePlanningUpdateInput({ registration_needed: false });
    assert.equal(validFalse.valid, true);
    if (validFalse.valid) assert.equal(validFalse.values.registration_needed, false);
  });

  test('validates registration_capacity', () => {
    assert.equal(validatePlanningUpdateInput({ registration_capacity: null }).valid, true);

    const nonNum = validatePlanningUpdateInput({ registration_capacity: '100' });
    assert.equal(nonNum.valid, false);
    if (!nonNum.valid) {
      assert.deepEqual(nonNum.errors, ['registration_capacity must be a whole number.']);
    }

    const floatCap = validatePlanningUpdateInput({ registration_capacity: 10.5 });
    assert.equal(floatCap.valid, false);
    if (!floatCap.valid) {
      assert.deepEqual(floatCap.errors, ['registration_capacity must be a whole number.']);
    }

    const zeroCap = validatePlanningUpdateInput({ registration_capacity: 0 });
    assert.equal(zeroCap.valid, false);
    if (!zeroCap.valid) {
      assert.deepEqual(zeroCap.errors, ['registration_capacity must be a positive integer.']);
    }

    const negCap = validatePlanningUpdateInput({ registration_capacity: -10 });
    assert.equal(negCap.valid, false);
    if (!negCap.valid) {
      assert.deepEqual(negCap.errors, ['registration_capacity must be a positive integer.']);
    }

    const overCap = validatePlanningUpdateInput({ registration_capacity: 3_000_000_000 });
    assert.equal(overCap.valid, false);
    if (!overCap.valid) {
      assert.deepEqual(overCap.errors, ['registration_capacity must be at most 2147483647.']);
    }

    const validCap = validatePlanningUpdateInput({ registration_capacity: 150 });
    assert.equal(validCap.valid, true);
    if (validCap.valid) {
      assert.equal(validCap.values.registration_capacity, 150);
    }
  });

  test('validates registration_opens_at and registration_closes_at', () => {
    assert.equal(validatePlanningUpdateInput({ registration_opens_at: null, registration_closes_at: null }).valid, true);

    // opens_at errors
    const nonStringOpen = validatePlanningUpdateInput({ registration_opens_at: 12345 });
    assert.equal(nonStringOpen.valid, false);
    if (!nonStringOpen.valid) {
      assert.deepEqual(nonStringOpen.errors, ['registration_opens_at must be an ISO 8601 date-time string.']);
    }

    const emptyOpen = validatePlanningUpdateInput({ registration_opens_at: '   ' });
    assert.equal(emptyOpen.valid, false);
    if (!emptyOpen.valid) {
      assert.deepEqual(emptyOpen.errors, ['registration_opens_at must be an ISO 8601 date-time string.']);
    }

    const invalidOpen = validatePlanningUpdateInput({ registration_opens_at: 'not-a-date' });
    assert.equal(invalidOpen.valid, false);
    if (!invalidOpen.valid) {
      assert.deepEqual(invalidOpen.errors, ['registration_opens_at must be a valid date and time.']);
    }

    // closes_at errors
    const nonStringClose = validatePlanningUpdateInput({ registration_closes_at: 12345 });
    assert.equal(nonStringClose.valid, false);
    if (!nonStringClose.valid) {
      assert.deepEqual(nonStringClose.errors, ['registration_closes_at must be an ISO 8601 date-time string.']);
    }

    const emptyClose = validatePlanningUpdateInput({ registration_closes_at: '   ' });
    assert.equal(emptyClose.valid, false);
    if (!emptyClose.valid) {
      assert.deepEqual(emptyClose.errors, ['registration_closes_at must be an ISO 8601 date-time string.']);
    }

    const invalidClose = validatePlanningUpdateInput({ registration_closes_at: 'not-a-date' });
    assert.equal(invalidClose.valid, false);
    if (!invalidClose.valid) {
      assert.deepEqual(invalidClose.errors, ['registration_closes_at must be a valid date and time.']);
    }

    // window: closes_at must be after opens_at
    const equalDates = validatePlanningUpdateInput({
      registration_opens_at: '2026-10-01T09:00:00Z',
      registration_closes_at: '2026-10-01T09:00:00Z'
    });
    assert.equal(equalDates.valid, false);
    if (!equalDates.valid) {
      assert.deepEqual(equalDates.errors, ['registration_closes_at must be after registration_opens_at.']);
    }

    const invertedDates = validatePlanningUpdateInput({
      registration_opens_at: '2026-10-15T09:00:00Z',
      registration_closes_at: '2026-10-01T09:00:00Z'
    });
    assert.equal(invertedDates.valid, false);
    if (!invertedDates.valid) {
      assert.deepEqual(invertedDates.errors, ['registration_closes_at must be after registration_opens_at.']);
    }

    const validWindow = validatePlanningUpdateInput({
      registration_opens_at: '2026-10-01T09:00:00Z',
      registration_closes_at: '2026-10-15T09:00:00Z'
    });
    assert.equal(validWindow.valid, true);
    if (validWindow.valid) {
      assert.equal(validWindow.values.registration_opens_at, '2026-10-01T09:00:00.000Z');
      assert.equal(validWindow.values.registration_closes_at, '2026-10-15T09:00:00.000Z');
    }
  });

  test('parses confirm_impact flag', () => {
    const withTrue = validatePlanningUpdateInput({ confirm_impact: true });
    assert.equal(withTrue.valid, true);
    if (withTrue.valid) assert.equal(withTrue.confirm_impact, true);

    const withFalse = validatePlanningUpdateInput({ confirm_impact: false });
    assert.equal(withFalse.valid, true);
    if (withFalse.valid) assert.equal(withFalse.confirm_impact, false);

    const withUndefined = validatePlanningUpdateInput({});
    assert.equal(withUndefined.valid, true);
    if (withUndefined.valid) assert.equal(withUndefined.confirm_impact, false);
  });
});

describe('detectArrangementImpact (AC 2)', () => {
  test('returns no impact when no triggering fields are modified', () => {
    const impact = detectArrangementImpact(BASE_EVENT, {
      planning_notes: 'Updated notes only',
      venue_requirements: 'Added flower bouquet'
    });
    assert.equal(impact.has_impact, false);
    assert.deepEqual(impact.affected_arrangements, []);
    assert.deepEqual(impact.impact_notes, []);
  });

  test('detects date shift when proposed_date changes', () => {
    // Same date -> no impact
    const same = detectArrangementImpact(BASE_EVENT, {
      proposed_date: '2026-11-15T09:00:00.000Z'
    });
    assert.equal(same.has_impact, false);

    // Shifted date -> venue_recheck and equipment_recheck
    const shifted = detectArrangementImpact(BASE_EVENT, {
      proposed_date: '2026-11-20T09:00:00.000Z'
    });
    assert.equal(shifted.has_impact, true);
    assert.deepEqual(shifted.affected_arrangements, ['venue_recheck', 'equipment_recheck']);
    assert.equal(shifted.impact_notes.length, 1);
    assert.match(shifted.impact_notes[0], /Proposed date changed from 2026-11-15T09:00:00.000Z to 2026-11-20T09:00:00.000Z/);

    // Current proposed_date is null -> no shift
    const nullCurrent = detectArrangementImpact(
      { ...BASE_EVENT, proposed_date: null },
      { proposed_date: '2026-11-20T09:00:00.000Z' }
    );
    assert.equal(nullCurrent.has_impact, false);
  });

  test('detects attendance increase', () => {
    // Same or decreased attendance -> no impact
    const same = detectArrangementImpact(BASE_EVENT, { expected_attendance: 100 });
    assert.equal(same.has_impact, false);

    const decreased = detectArrangementImpact(BASE_EVENT, { expected_attendance: 80 });
    assert.equal(decreased.has_impact, false);

    // Increased attendance -> venue_recheck and equipment_recheck
    const increased = detectArrangementImpact(BASE_EVENT, { expected_attendance: 250 });
    assert.equal(increased.has_impact, true);
    assert.deepEqual(increased.affected_arrangements, ['venue_recheck', 'equipment_recheck']);
    assert.equal(increased.impact_notes.length, 1);
    assert.match(increased.impact_notes[0], /Expected attendance increased from 100 to 250/);

    // Current expected_attendance is null -> no impact
    const nullCurrent = detectArrangementImpact(
      { ...BASE_EVENT, expected_attendance: null },
      { expected_attendance: 150 }
    );
    assert.equal(nullCurrent.has_impact, false);
  });

  test('detects registration capacity increase', () => {
    // Same or decreased capacity -> no impact
    const same = detectArrangementImpact(BASE_EVENT, { registration_capacity: 100 });
    assert.equal(same.has_impact, false);

    const decreased = detectArrangementImpact(BASE_EVENT, { registration_capacity: 50 });
    assert.equal(decreased.has_impact, false);

    // Increased capacity -> registration_recheck
    const increased = detectArrangementImpact(BASE_EVENT, { registration_capacity: 300 });
    assert.equal(increased.has_impact, true);
    assert.deepEqual(increased.affected_arrangements, ['registration_recheck']);
    assert.equal(increased.impact_notes.length, 1);
    assert.match(increased.impact_notes[0], /Registration capacity increased from 100 to 300/);

    // Current registration_capacity is null -> no impact
    const nullCurrent = detectArrangementImpact(
      { ...BASE_EVENT, registration_capacity: null },
      { registration_capacity: 200 }
    );
    assert.equal(nullCurrent.has_impact, false);
  });

  test('combines and deduplicates multiple impacts', () => {
    const multi = detectArrangementImpact(BASE_EVENT, {
      proposed_date: '2026-11-20T09:00:00.000Z',
      expected_attendance: 200,
      registration_capacity: 200
    });

    assert.equal(multi.has_impact, true);
    assert.deepEqual(multi.affected_arrangements.sort(), ['equipment_recheck', 'registration_recheck', 'venue_recheck'].sort());
    assert.equal(multi.impact_notes.length, 3);
  });
});

describe('formatAuditValue & computePlanningDiffs (AC 1)', () => {
  test('formatAuditValue formats values or returns null', () => {
    assert.equal(formatAuditValue(null), null);
    assert.equal(formatAuditValue(undefined), null);
    assert.equal(formatAuditValue('hello'), 'hello');
    assert.equal(formatAuditValue(123), '123');
    assert.equal(formatAuditValue(true), 'true');
    assert.equal(formatAuditValue(false), 'false');
  });

  test('computePlanningDiffs computes field-level differences for updated fields only', () => {
    const diffs = computePlanningDiffs(
      10,
      COORDINATOR_ID,
      BASE_EVENT,
      {
        expected_attendance: 250,
        planning_notes: 'New notes',
        // Unchanged field should not generate diff
        proposed_date: '2026-11-15T09:00:00.000Z',
        // Setting an existing string to null
        accessibility_needs: null
      }
    );

    assert.deepEqual(diffs, [
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'expected_attendance',
        old_value: '100',
        new_value: '250'
      },
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'accessibility_needs',
        old_value: 'Wheelchair access',
        new_value: null
      },
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'planning_notes',
        old_value: 'Initial planning notes',
        new_value: 'New notes'
      }
    ]);
  });

  test('computePlanningDiffs handles initially null fields transitioning to value', () => {
    const eventWithNulls: EventPlanningRecord = {
      ...BASE_EVENT,
      planning_notes: null,
      registration_opens_at: null
    };

    const diffs = computePlanningDiffs(
      10,
      COORDINATOR_ID,
      eventWithNulls,
      {
        planning_notes: 'Initial notes now set',
        registration_opens_at: '2026-10-05T09:00:00.000Z'
      }
    );

    assert.deepEqual(diffs, [
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'registration_opens_at',
        old_value: null,
        new_value: '2026-10-05T09:00:00.000Z'
      },
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'planning_notes',
        old_value: null,
        new_value: 'Initial notes now set'
      }
    ]);
  });

  test('computePlanningDiffs ignores omitted or undefined fields', () => {
    const diffs = computePlanningDiffs(10, COORDINATOR_ID, BASE_EVENT, {});
    assert.deepEqual(diffs, []);
  });
});

interface HandlerHarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  fetchResult?: FetchEventPlanningResult;
  updateResult?: UpdateEventPlanningResult;
  insertAuditResult?: InsertAuditLogsResult;
  captureUpdateFields?: (fields: UpdatePlanningFieldsInput) => void;
  captureAuditEntries?: (entries: InsertAuditLogInput[]) => void;
}

function buildApp(options: HandlerHarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId/planning',
    createUpdateEventPlanningHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchPlanningRecord: async () => options.fetchResult ?? { ok: true, event: { ...BASE_EVENT } },
      updatePlanningFields: async (_admin, _eventId, fields) => {
        options.captureUpdateFields?.(fields);
        return (
          options.updateResult ?? {
            ok: true,
            event: { ...BASE_EVENT, ...fields }
          }
        );
      },
      insertAudit: async (_admin, entries) => {
        options.captureAuditEntries?.(entries);
        return options.insertAuditResult ?? { ok: true, logs: [] };
      }
    })
  );
  return app;
}

describe('createUpdateEventPlanningHandler business logic and AC verification', () => {
  test('rejects unauthenticated requests with 401', async () => {
    const response = await request(buildApp({ principal: undefined })).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Authentication required' });
  });

  test('rejects non-coordinator principals with 403', async () => {
    const response = await request(
      buildApp({ principal: { userId: COORDINATOR_ID, role: 'event_organiser' } })
    ).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Access denied' });
  });

  for (const badId of ['abc', '0', '-5', '1.5']) {
    test(`rejects invalid eventId (${badId}) with 400`, async () => {
      const response = await request(buildApp()).patch(`/api/event-requests/${badId}/planning`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, { error: 'eventId must be a positive integer.' });
    });
  }

  test('returns 400 when input validation fails', async () => {
    const response = await request(buildApp())
      .patch('/api/event-requests/10/planning')
      .send({ expected_attendance: -10 });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Invalid planning details');
    assert.ok(Array.isArray(response.body.details));
  });

  test('treats an absent request body as an empty update', async () => {
    // No express.json() here, so req.body is undefined rather than {}.
    const bare = express();
    bare.patch(
      '/api/event-requests/:eventId/planning',
      createUpdateEventPlanningHandler({
        getPrincipal: () => COORDINATOR,
        getAdminClient: () => ({}) as SupabaseClient,
        fetchPlanningRecord: async () => ({ ok: true, event: { ...BASE_EVENT } }),
        updatePlanningFields: async (_admin, _eventId, fields) => ({
          ok: true,
          event: { ...BASE_EVENT, ...fields }
        }),
        insertAudit: async () => ({ ok: true, logs: [] })
      })
    );
    const response = await request(bare).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 200);
  });

  test('returns 503 when admin database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).patch('/api/event-requests/10/planning').send({});
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Event requests are temporarily unavailable. Please try again later.' });
  });

  test('returns 404 when event record is not found', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'Event not found.' } })
    )
      .patch('/api/event-requests/10/planning')
      .send({});
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Event request not found.' });
  });

  test('returns 503 when fetching event record fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'DB down' } })
    )
      .patch('/api/event-requests/10/planning')
      .send({});
    assert.equal(response.status, 503);
  });

  test('returns 403 when caller is not the assigned coordinator', async () => {
    const response = await request(
      buildApp({
        fetchResult: {
          ok: true,
          event: { ...BASE_EVENT, coordinator_id: OTHER_COORDINATOR_ID }
        }
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({});
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, {
      error: 'Only the assigned event coordinator can update planning details.'
    });
  });

  test('AC 5: refuses update on cancelled, completed, and rejected events with 409', async () => {
    for (const status of ['cancelled', 'completed', 'rejected']) {
      const response = await request(
        buildApp({
          fetchResult: {
            ok: true,
            event: { ...BASE_EVENT, status }
          }
        })
      )
        .patch('/api/event-requests/10/planning')
        .send({ planning_notes: 'trying to update terminal' });

      assert.equal(response.status, 409);
      assert.deepEqual(response.body, {
        error: `Cannot update planning information for a ${status} event.`
      });
    }
  });

  test('cross-validates registration window against existing event dates with 400', async () => {
    // Existing opens_at: 2026-10-01T09:00:00.000Z. Updating closes_at to 2026-09-15
    const responseClose = await request(buildApp())
      .patch('/api/event-requests/10/planning')
      .send({ registration_closes_at: '2026-09-15T18:00:00.000Z' });
    assert.equal(responseClose.status, 400);
    assert.deepEqual(responseClose.body, {
      error: 'Invalid planning details',
      details: ['registration_closes_at must be after registration_opens_at.']
    });

    // Existing closes_at: 2026-11-01T18:00:00.000Z. Updating opens_at to 2026-11-10
    const responseOpen = await request(buildApp())
      .patch('/api/event-requests/10/planning')
      .send({ registration_opens_at: '2026-11-10T09:00:00.000Z' });
    assert.equal(responseOpen.status, 400);
    assert.deepEqual(responseOpen.body, {
      error: 'Invalid planning details',
      details: ['registration_closes_at must be after registration_opens_at.']
    });
  });

  test('AC 2: returns 409 requires_confirmation when arrangement impact detected without confirm_impact', async () => {
    let updateCalled = false;
    let auditCalled = false;

    const response = await request(
      buildApp({
        captureUpdateFields: () => (updateCalled = true),
        captureAuditEntries: () => (auditCalled = true)
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({ expected_attendance: 250 });

    assert.equal(response.status, 409);
    assert.equal(response.body.requires_confirmation, true);
    assert.deepEqual(response.body.affected_arrangements, ['venue_recheck', 'equipment_recheck']);
    assert.ok(Array.isArray(response.body.impact_notes));
    assert.equal(updateCalled, false);
    assert.equal(auditCalled, false);
  });

  test('AC 1, AC 2 & AC 3: saves with confirm_impact: true, sets arrangements_recheck_needed, transitions to planning, and persists audit logs', async () => {
    let capturedFields: UpdatePlanningFieldsInput | undefined;
    let capturedAudit: InsertAuditLogInput[] | undefined;

    const response = await request(
      buildApp({
        captureUpdateFields: (fields) => (capturedFields = fields),
        captureAuditEntries: (entries) => (capturedAudit = entries)
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({
        expected_attendance: 250,
        confirm_impact: true
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.arrangements_recheck_needed, true);
    assert.deepEqual(response.body.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);

    // Check captured DB fields
    assert.ok(capturedFields);
    assert.equal(capturedFields.expected_attendance, 250);
    assert.equal(capturedFields.arrangements_recheck_needed, true);
    assert.deepEqual(capturedFields.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
    assert.equal(capturedFields.status, 'planning');

    // Check captured audit diffs
    assert.ok(capturedAudit);
    assert.deepEqual(capturedAudit, [
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'expected_attendance',
        old_value: '100',
        new_value: '250'
      }
    ]);
  });

  test('AC 3: transitions approved event to planning on non-impacting update and persists diffs', async () => {
    let capturedFields: UpdatePlanningFieldsInput | undefined;
    let capturedAudit: InsertAuditLogInput[] | undefined;

    const response = await request(
      buildApp({
        captureUpdateFields: (fields) => (capturedFields = fields),
        captureAuditEntries: (entries) => (capturedAudit = entries)
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({
        planning_notes: 'Updated vendor details'
      });

    assert.equal(response.status, 200);
    assert.ok(capturedFields);
    assert.equal(capturedFields.planning_notes, 'Updated vendor details');
    assert.equal(capturedFields.status, 'planning');

    assert.ok(capturedAudit);
    assert.deepEqual(capturedAudit, [
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'planning_notes',
        old_value: 'Initial planning notes',
        new_value: 'Updated vendor details'
      }
    ]);
  });

  test('preserves existing planning status when event is already in planning without impact', async () => {
    let capturedFields: UpdatePlanningFieldsInput | undefined;

    const response = await request(
      buildApp({
        fetchResult: {
          ok: true,
          event: { ...BASE_EVENT, status: 'planning' }
        },
        captureUpdateFields: (fields) => (capturedFields = fields)
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({
        planning_notes: 'Another note'
      });

    assert.equal(response.status, 200);
    assert.ok(capturedFields);
    assert.equal(capturedFields.status, undefined);
  });

  test('does not insert audit logs when no audited fields changed', async () => {
    let auditCalled = false;

    const response = await request(
      buildApp({
        fetchResult: {
          ok: true,
          event: { ...BASE_EVENT, status: 'planning' }
        },
        captureAuditEntries: () => (auditCalled = true)
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({});

    assert.equal(response.status, 200);
    assert.equal(auditCalled, false);
  });

  test('handles updatePlanningFields failure', async () => {
    // not_found
    const notFoundRes = await request(
      buildApp({
        updateResult: { ok: false, reason: 'not_found', message: 'Missing' }
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({ planning_notes: 'Notes' });
    assert.equal(notFoundRes.status, 404);

    // unavailable
    const unavailRes = await request(
      buildApp({
        updateResult: { ok: false, reason: 'unavailable', message: 'DB error' }
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({ planning_notes: 'Notes' });
    assert.equal(unavailRes.status, 503);
  });

  test('handles insertAudit failure with 503', async () => {
    const auditFailRes = await request(
      buildApp({
        insertAuditResult: { ok: false, reason: 'unavailable', message: 'Audit insert failed' }
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({ planning_notes: 'Notes' });

    assert.equal(auditFailRes.status, 503);
  });
});

describe('PATCH /api/event-requests/:eventId/planning integration & authorization wiring', () => {
  const userId = COORDINATOR_ID;
  const originalConfig = { ...dbConfig };

  beforeEach(() => {
    dbConfig.supabaseUrl = 'https://auth-test.supabase.co';
    dbConfig.supabaseAnonKey = 'sb_publishable_test';
    dbConfig.supabaseServiceRoleKey = 'test-service-role';
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('Unexpected network request');
    });
  });

  afterEach(() => {
    mock.restoreAll();
    Object.assign(dbConfig, originalConfig);
  });

  test('policy grants event_request.planning.update only to event_coordinator', () => {
    assert.deepEqual(PERMISSIONS['event_request.planning.update'], ['event_coordinator']);
    assert.ok(permissionsFor('event_coordinator', PERMISSIONS).includes('event_request.planning.update'));
    assert.ok(!permissionsFor('event_organiser', PERMISSIONS).includes('event_request.planning.update'));
    assert.ok(!permissionsFor('venue_staff', PERMISSIONS).includes('event_request.planning.update'));
    assert.ok(!permissionsFor('technical_support_staff', PERMISSIONS).includes('event_request.planning.update'));
    assert.ok(!permissionsFor('attendee', PERMISSIONS).includes('event_request.planning.update'));
  });

  const appForRole = (role: Role) =>
    createApp(
      undefined,
      createAuthorization({ resolvePrincipal: async () => ({ userId, role }) }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('rejects unauthenticated request on app route', async () => {
    const response = await request(appForRole('event_coordinator')).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  for (const role of ['event_organiser', 'venue_staff', 'technical_support_staff', 'attendee'] as const) {
    test(`denies role ${role} with 403 on app route`, async () => {
      const response = await request(appForRole(role))
        .patch('/api/event-requests/10/planning')
        .set('Authorization', 'Bearer test-token');
      assert.equal(response.status, 403);
    });
  }

  test('allows event_coordinator to reach mounted planning handler on app route', async () => {
    const response = await request(appForRole('event_coordinator'))
      .patch('/api/event-requests/10/planning')
      .set('Authorization', 'Bearer test-token');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { reached: true });
  });
});
