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
  type UpdateEventPlanningDependencies
} from './updatePlanning';
import type {
  EventPlanningRecord,
  FetchEventPlanningResult,
  UpdateEventPlanningResult,
  UpdatePlanningFieldsInput
} from '../db/eventPlanning';
import type { InsertAuditLogInput, InsertAuditLogsResult } from '../db/auditLogs';
import { computeEventStage } from './stageCalculator';

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
  test('[FAILURE] [SG2-39:AC4] rejects non-object request bodies across various data types', () => {
    // null, undefined, primitives, arrays, symbols, and functions
    assert.deepEqual(validatePlanningUpdateInput(null), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput(undefined), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput('not an object'), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput(12345), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput(0), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput(true), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput(false), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput([1, 2, 3]), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput([]), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput(Symbol('invalid')), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
    assert.deepEqual(validatePlanningUpdateInput(() => {}), {
      valid: false,
      errors: ['Request body must be a JSON object.']
    });
  });

  test('[FAILURE] [SG2-39:AC4] validates fields against invalid and mixed data types', () => {
    // expected_attendance: boolean, array, object
    for (const badType of [true, false, [100], { count: 100 }]) {
      const res = validatePlanningUpdateInput({ expected_attendance: badType });
      assert.equal(res.valid, false);
      if (!res.valid) {
        assert.deepEqual(res.errors, ['expected_attendance must be a whole number.']);
      }
    }

    // proposed_date: number, boolean, array, object
    for (const badType of [12345, true, ['2026-11-20'], { date: '2026-11-20' }]) {
      const res = validatePlanningUpdateInput({ proposed_date: badType });
      assert.equal(res.valid, false);
      if (!res.valid) {
        assert.deepEqual(res.errors, ['proposed_date must be an ISO 8601 date-time string.']);
      }
    }

    // text fields: number, boolean, array, object
    for (const field of ['venue_requirements', 'equipment_requirements', 'accessibility_needs', 'planning_notes'] as const) {
      for (const badType of [123, true, ['hall'], { note: 'hall' }]) {
        const res = validatePlanningUpdateInput({ [field]: badType });
        assert.equal(res.valid, false);
        if (!res.valid) {
          assert.deepEqual(res.errors, [`${field} must be text.`]);
        }
      }
    }

    // registration_needed: string, number, array, object
    for (const badType of ['true', 1, [true], { needed: true }]) {
      const res = validatePlanningUpdateInput({ registration_needed: badType });
      assert.equal(res.valid, false);
      if (!res.valid) {
        assert.deepEqual(res.errors, ['registration_needed must be true or false.']);
      }
    }

    // registration_capacity: boolean, array, object
    for (const badType of [true, [50], { cap: 50 }]) {
      const res = validatePlanningUpdateInput({ registration_capacity: badType });
      assert.equal(res.valid, false);
      if (!res.valid) {
        assert.deepEqual(res.errors, ['registration_capacity must be a whole number.']);
      }
    }

    // registration dates: number, boolean, array, object
    for (const field of ['registration_opens_at', 'registration_closes_at'] as const) {
      for (const badType of [12345, false, ['2026-10-01'], {}]) {
        const res = validatePlanningUpdateInput({ [field]: badType });
        assert.equal(res.valid, false);
        if (!res.valid) {
          assert.deepEqual(res.errors, [`${field} must be an ISO 8601 date-time string.`]);
        }
      }
    }
  });

  test('[BOUNDARY] [SG2-39:AC1] validates expected_attendance including boundaries', () => {
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

    // Boundary test lower: 0 and negative (invalid)
    const zeroAtt = validatePlanningUpdateInput({ expected_attendance: 0 });
    assert.equal(zeroAtt.valid, false);
    if (!zeroAtt.valid) {
      assert.deepEqual(zeroAtt.errors, ['expected_attendance must be at least 1.']);
    }

    const negAtt = validatePlanningUpdateInput({ expected_attendance: -1 });
    assert.equal(negAtt.valid, false);
    if (!negAtt.valid) {
      assert.deepEqual(negAtt.errors, ['expected_attendance must be at least 1.']);
    }

    const negLargeAtt = validatePlanningUpdateInput({ expected_attendance: -500 });
    assert.equal(negLargeAtt.valid, false);
    if (!negLargeAtt.valid) {
      assert.deepEqual(negLargeAtt.errors, ['expected_attendance must be at least 1.']);
    }

    // Boundary test lower: 1 (valid minimum whole number)
    const minValidAtt = validatePlanningUpdateInput({ expected_attendance: 1 });
    assert.equal(minValidAtt.valid, true);
    if (minValidAtt.valid) {
      assert.equal(minValidAtt.values.expected_attendance, 1);
    }

    // Boundary test lower: 2 (just above minimum)
    const justAboveMinAtt = validatePlanningUpdateInput({ expected_attendance: 2 });
    assert.equal(justAboveMinAtt.valid, true);
    if (justAboveMinAtt.valid) {
      assert.equal(justAboveMinAtt.values.expected_attendance, 2);
    }

    // Mid-range valid integer
    const validAtt = validatePlanningUpdateInput({ expected_attendance: 250 });
    assert.equal(validAtt.valid, true);
    if (validAtt.valid) {
      assert.equal(validAtt.values.expected_attendance, 250);
    }

    // Boundary test upper: MAX_ATTENDANCE - 1 (2147483646, valid)
    const justBelowMaxAtt = validatePlanningUpdateInput({ expected_attendance: 2_147_483_646 });
    assert.equal(justBelowMaxAtt.valid, true);
    if (justBelowMaxAtt.valid) {
      assert.equal(justBelowMaxAtt.values.expected_attendance, 2_147_483_646);
    }

    // Boundary test upper: MAX_ATTENDANCE (2147483647, valid maximum)
    const maxValidAtt = validatePlanningUpdateInput({ expected_attendance: 2_147_483_647 });
    assert.equal(maxValidAtt.valid, true);
    if (maxValidAtt.valid) {
      assert.equal(maxValidAtt.values.expected_attendance, 2_147_483_647);
    }

    // Boundary test upper: MAX_ATTENDANCE + 1 (2147483648, invalid)
    const justOverMaxAtt = validatePlanningUpdateInput({ expected_attendance: 2_147_483_648 });
    assert.equal(justOverMaxAtt.valid, false);
    if (!justOverMaxAtt.valid) {
      assert.deepEqual(justOverMaxAtt.errors, ['expected_attendance must be at most 2147483647.']);
    }

    // Extreme overflow
    const overAtt = validatePlanningUpdateInput({ expected_attendance: 3_000_000_000 });
    assert.equal(overAtt.valid, false);
    if (!overAtt.valid) {
      assert.deepEqual(overAtt.errors, ['expected_attendance must be at most 2147483647.']);
    }
  });

  test('[NORMAL] [FAILURE] [SG2-39:AC1] validates proposed_date', () => {
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

  test('[BOUNDARY] [SG2-39:AC1] validates free-text fields and text length limits including boundaries', () => {
    for (const field of ['venue_requirements', 'equipment_requirements', 'accessibility_needs', 'planning_notes'] as const) {
      // null is allowed
      assert.equal(validatePlanningUpdateInput({ [field]: null }).valid, true);

      // non-string
      const nonString = validatePlanningUpdateInput({ [field]: 123 });
      assert.equal(nonString.valid, false);
      if (!nonString.valid) {
        assert.deepEqual(nonString.errors, [`${field} must be text.`]);
      }

      // Boundary: 0 characters / empty string -> maps to null
      const emptyRes = validatePlanningUpdateInput({ [field]: '' });
      assert.equal(emptyRes.valid, true);
      if (emptyRes.valid) {
        assert.equal(emptyRes.values[field], null);
      }

      // Boundary: whitespace only -> maps to null
      const blank = validatePlanningUpdateInput({ [field]: '   ' });
      assert.equal(blank.valid, true);
      if (blank.valid) {
        assert.equal(blank.values[field], null);
      }

      // Boundary: 1 character (lower boundary)
      const oneChar = validatePlanningUpdateInput({ [field]: 'a' });
      assert.equal(oneChar.valid, true);
      if (oneChar.valid) {
        assert.equal(oneChar.values[field], 'a');
      }

      // Boundary: 1 character with surrounding whitespace
      const oneCharPadded = validatePlanningUpdateInput({ [field]: '  a  ' });
      assert.equal(oneCharPadded.valid, true);
      if (oneCharPadded.valid) {
        assert.equal(oneCharPadded.values[field], 'a');
      }

      // Boundary: 4999 characters (just below limit)
      const justBelowLimit = validatePlanningUpdateInput({ [field]: 'x'.repeat(4999) });
      assert.equal(justBelowLimit.valid, true);
      if (justBelowLimit.valid) {
        assert.equal(justBelowLimit.values[field]?.length, 4999);
      }

      // Boundary: 5000 characters (exact upper boundary)
      const maxLimit = validatePlanningUpdateInput({ [field]: 'x'.repeat(5000) });
      assert.equal(maxLimit.valid, true);
      if (maxLimit.valid) {
        assert.equal(maxLimit.values[field], 'x'.repeat(5000));
        assert.equal(maxLimit.values[field]?.length, 5000);
      }

      // Boundary: 5000 characters with surrounding whitespace (trims to 5000)
      const maxLimitPadded = validatePlanningUpdateInput({ [field]: '  ' + 'x'.repeat(5000) + '  ' });
      assert.equal(maxLimitPadded.valid, true);
      if (maxLimitPadded.valid) {
        assert.equal(maxLimitPadded.values[field], 'x'.repeat(5000));
        assert.equal(maxLimitPadded.values[field]?.length, 5000);
      }

      // Boundary: 5001 characters (just above limit, invalid)
      const tooLong = validatePlanningUpdateInput({ [field]: 'x'.repeat(5001) });
      assert.equal(tooLong.valid, false);
      if (!tooLong.valid) {
        assert.deepEqual(tooLong.errors, [`${field} must be 5000 characters or fewer.`]);
      }

      // Boundary: 5001 characters with surrounding whitespace (trims to 5001, invalid)
      const tooLongPadded = validatePlanningUpdateInput({ [field]: '  ' + 'x'.repeat(5001) + '  ' });
      assert.equal(tooLongPadded.valid, false);
      if (!tooLongPadded.valid) {
        assert.deepEqual(tooLongPadded.errors, [`${field} must be 5000 characters or fewer.`]);
      }

      // valid string trimmed
      const valid = validatePlanningUpdateInput({ [field]: '  some text  ' });
      assert.equal(valid.valid, true);
      if (valid.valid) {
        assert.equal(valid.values[field], 'some text');
      }
    }
  });

  test('[NORMAL] [FAILURE] [SG2-39:AC4] validates registration_needed', () => {
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

  test('[BOUNDARY] [SG2-39:AC4] validates registration_capacity including boundaries', () => {
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

    // Boundary test lower: 0 and negative (invalid)
    const zeroCap = validatePlanningUpdateInput({ registration_capacity: 0 });
    assert.equal(zeroCap.valid, false);
    if (!zeroCap.valid) {
      assert.deepEqual(zeroCap.errors, ['registration_capacity must be a positive integer.']);
    }

    const negCap = validatePlanningUpdateInput({ registration_capacity: -1 });
    assert.equal(negCap.valid, false);
    if (!negCap.valid) {
      assert.deepEqual(negCap.errors, ['registration_capacity must be a positive integer.']);
    }

    const negLargeCap = validatePlanningUpdateInput({ registration_capacity: -500 });
    assert.equal(negLargeCap.valid, false);
    if (!negLargeCap.valid) {
      assert.deepEqual(negLargeCap.errors, ['registration_capacity must be a positive integer.']);
    }

    // Boundary test lower: 1 (valid minimum positive integer)
    const minValidCap = validatePlanningUpdateInput({ registration_capacity: 1 });
    assert.equal(minValidCap.valid, true);
    if (minValidCap.valid) {
      assert.equal(minValidCap.values.registration_capacity, 1);
    }

    // Boundary test lower: 2 (just above minimum)
    const justAboveMinCap = validatePlanningUpdateInput({ registration_capacity: 2 });
    assert.equal(justAboveMinCap.valid, true);
    if (justAboveMinCap.valid) {
      assert.equal(justAboveMinCap.values.registration_capacity, 2);
    }

    // Mid-range valid integer
    const validCap = validatePlanningUpdateInput({ registration_capacity: 150 });
    assert.equal(validCap.valid, true);
    if (validCap.valid) {
      assert.equal(validCap.values.registration_capacity, 150);
    }

    // Boundary test upper: MAX_ATTENDANCE - 1 (2147483646, valid)
    const justBelowMaxCap = validatePlanningUpdateInput({ registration_capacity: 2_147_483_646 });
    assert.equal(justBelowMaxCap.valid, true);
    if (justBelowMaxCap.valid) {
      assert.equal(justBelowMaxCap.values.registration_capacity, 2_147_483_646);
    }

    // Boundary test upper: MAX_ATTENDANCE (2147483647, valid maximum)
    const maxValidCap = validatePlanningUpdateInput({ registration_capacity: 2_147_483_647 });
    assert.equal(maxValidCap.valid, true);
    if (maxValidCap.valid) {
      assert.equal(maxValidCap.values.registration_capacity, 2_147_483_647);
    }

    // Boundary test upper: MAX_ATTENDANCE + 1 (2147483648, invalid)
    const justOverMaxCap = validatePlanningUpdateInput({ registration_capacity: 2_147_483_648 });
    assert.equal(justOverMaxCap.valid, false);
    if (!justOverMaxCap.valid) {
      assert.deepEqual(justOverMaxCap.errors, ['registration_capacity must be at most 2147483647.']);
    }

    // Extreme overflow
    const overCap = validatePlanningUpdateInput({ registration_capacity: 3_000_000_000 });
    assert.equal(overCap.valid, false);
    if (!overCap.valid) {
      assert.deepEqual(overCap.errors, ['registration_capacity must be at most 2147483647.']);
    }
  });

  test('[BOUNDARY] [NORMAL] [FAILURE] [SG2-39:AC4] validates registration_opens_at and registration_closes_at', () => {
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

  test('[NORMAL] [SG2-39:AC2] parses confirm_impact flag', () => {
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
  test('[BOUNDARY] [SG2-39:AC2] one extra attendee or registration place triggers a recheck at the existing capacity', () => {
    for (const [count, hasImpact, affected] of [
      [99, false, []], [100, false, []], [101, true, ['venue_recheck', 'equipment_recheck']]
    ] as const) {
      const impact = detectArrangementImpact(BASE_EVENT, { expected_attendance: count });
      assert.equal(impact.has_impact, hasImpact);
      assert.deepEqual(impact.affected_arrangements, affected);
    }
    for (const [count, hasImpact, affected] of [
      [99, false, []], [100, false, []], [101, true, ['registration_recheck']]
    ] as const) {
      const impact = detectArrangementImpact(BASE_EVENT, { registration_capacity: count });
      assert.equal(impact.has_impact, hasImpact);
      assert.deepEqual(impact.affected_arrangements, affected);
    }
  });

  test('[NORMAL] [SG2-39:AC2] returns no impact when no triggering fields are modified', () => {
    const impact = detectArrangementImpact(BASE_EVENT, {
      planning_notes: 'Updated notes only',
      venue_requirements: 'Added flower bouquet'
    });
    assert.equal(impact.has_impact, false);
    assert.deepEqual(impact.affected_arrangements, []);
    assert.deepEqual(impact.impact_notes, []);
  });

  test('[NORMAL] [SG2-39:AC2] detects date shift when proposed_date changes', () => {
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

  test('[BOUNDARY] [SG2-39:AC2] detects attendance increase', () => {
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

  test('[BOUNDARY] [SG2-39:AC2] detects registration capacity increase', () => {
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

  test('[NORMAL] [SG2-39:AC2] [SG2-39:AC3] combines and deduplicates multiple impacts', () => {
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
  test('[NORMAL] [SG2-39:AC1] formatAuditValue formats values or returns null', () => {
    assert.equal(formatAuditValue(null), null);
    assert.equal(formatAuditValue(undefined), null);
    assert.equal(formatAuditValue('hello'), 'hello');
    assert.equal(formatAuditValue(123), '123');
    assert.equal(formatAuditValue(true), 'true');
    assert.equal(formatAuditValue(false), 'false');
  });

  test('[NORMAL] [SG2-39:AC1] computePlanningDiffs computes field-level differences for updated fields only', () => {
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

  test('[BOUNDARY] [SG2-39:AC1] computePlanningDiffs handles initially null fields transitioning to value', () => {
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

  test('[BOUNDARY] [SG2-39:AC1] computePlanningDiffs ignores omitted or undefined fields', () => {
    const diffs = computePlanningDiffs(10, COORDINATOR_ID, BASE_EVENT, {});
    assert.deepEqual(diffs, []);
    assert.deepEqual(computePlanningDiffs(10, COORDINATOR_ID, BASE_EVENT, { expected_attendance: undefined, planning_notes: undefined }), []);
  });
});

interface HandlerHarnessOptions {
  principal?: Principal | undefined;
  admin?: SupabaseClient | null;
  expectedEventId?: number;
  fetchResult?: FetchEventPlanningResult;
  updateResult?: UpdateEventPlanningResult;
  insertAuditResult?: InsertAuditLogsResult;
  captureFetchEventId?: (eventId: number) => void;
  captureUpdateEventId?: (eventId: number) => void;
  captureUpdateFields?: (fields: UpdatePlanningFieldsInput) => void;
  captureAuditEntries?: (entries: InsertAuditLogInput[]) => void;
  fetchPlanningRecord?: (
    client: SupabaseClient,
    eventId: number
  ) => Promise<FetchEventPlanningResult>;
  updatePlanningFields?: (
    admin: SupabaseClient,
    eventId: number,
    fields: UpdatePlanningFieldsInput,
    coordinatorId: string
  ) => Promise<UpdateEventPlanningResult>;
}

function buildApp(options: HandlerHarnessOptions = {}) {
  const app = express();
  app.use(express.json());
  app.patch(
    '/api/event-requests/:eventId/planning',
    createUpdateEventPlanningHandler({
      getPrincipal: () => ('principal' in options ? options.principal : COORDINATOR),
      getAdminClient: () => (options.admin === undefined ? ({} as SupabaseClient) : options.admin),
      fetchPlanningRecord: async (client, eventId) => {
        options.captureFetchEventId?.(eventId);
        if (options.fetchPlanningRecord) {
          return options.fetchPlanningRecord(client, eventId);
        }
        if (options.fetchResult) {
          return options.fetchResult;
        }
        const expectedId = options.expectedEventId ?? BASE_EVENT.event_id;
        if (eventId !== expectedId) {
          return { ok: false, reason: 'not_found', message: `Event ${eventId} not found.` };
        }
        return { ok: true, event: { ...BASE_EVENT, event_id: eventId } };
      },
      updatePlanningFields: async (admin, eventId, fields, coordinatorId) => {
        options.captureUpdateEventId?.(eventId);
        options.captureUpdateFields?.(fields);
        if (options.updatePlanningFields) {
          return options.updatePlanningFields(admin, eventId, fields, coordinatorId);
        }
        if (options.updateResult) {
          return options.updateResult;
        }
        const expectedId = options.expectedEventId ?? BASE_EVENT.event_id;
        if (eventId !== expectedId) {
          return { ok: false, reason: 'not_found', message: `Event ${eventId} not found.` };
        }
        // Base the returned updated event on the fetched event to preserve current status and existing fields
        const currentEvent = options.fetchResult?.ok ? options.fetchResult.event : BASE_EVENT;
        return {
          ok: true,
          event: { ...currentEvent, ...fields, event_id: eventId }
        };
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
  test('[NORMAL] [SG2-39:AC4] registration capacity and opening window can be updated while planning', async () => {
    let saved: UpdatePlanningFieldsInput | undefined;
    let history: InsertAuditLogInput[] | undefined;
    const app = buildApp({ fetchResult: { ok: true, event: { ...BASE_EVENT, status: 'planning' } },
      captureUpdateFields: fields => { saved = fields; }, captureAuditEntries: entries => { history = entries; } });
    const response = await request(app).patch('/api/event-requests/10/planning').send({
      registration_capacity: 90, registration_opens_at: '2026-10-02T09:00:00.000Z', registration_closes_at: '2026-10-03T09:00:00.000Z'
    });
    assert.equal(response.status, 200);
    assert.deepEqual(saved, { registration_capacity: 90,
      registration_opens_at: '2026-10-02T09:00:00.000Z', registration_closes_at: '2026-10-03T09:00:00.000Z' });
    assert.equal(response.body.event.status, 'planning');
    assert.equal(response.body.event.registration_capacity, 90);
    assert.equal(response.body.event.registration_opens_at, '2026-10-02T09:00:00.000Z');
    assert.equal(response.body.event.registration_closes_at, '2026-10-03T09:00:00.000Z');
    assert.deepEqual(history, [
      { event_id: 10, actor_id: COORDINATOR_ID, field_name: 'registration_capacity', old_value: '100', new_value: '90' },
      { event_id: 10, actor_id: COORDINATOR_ID, field_name: 'registration_opens_at', old_value: '2026-10-01T09:00:00.000Z', new_value: '2026-10-02T09:00:00.000Z' },
      { event_id: 10, actor_id: COORDINATOR_ID, field_name: 'registration_closes_at', old_value: '2026-11-01T18:00:00.000Z', new_value: '2026-10-03T09:00:00.000Z' }
    ]);
  });

  test('[FAILURE] [SG2-25:AC3] [SG2-39:AC1] rejects unauthenticated requests with 401', async () => {
    const response = await request(buildApp({ principal: undefined })).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Authentication required' });
  });

  test('[FAILURE] [SG2-25:AC1] [SG2-39:AC1] rejects non-coordinator principals with 403', async () => {
    const response = await request(
      buildApp({ principal: { userId: COORDINATOR_ID, role: 'event_organiser' } })
    ).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Access denied' });
  });

  for (const badId of ['abc', '0', '-5', '1.5']) {
    test(`${badId === '0' ? '[BOUNDARY]' : '[FAILURE]'} [SG2-39:AC1] rejects invalid eventId (${badId}) with 400`, async () => {
      const response = await request(buildApp()).patch(`/api/event-requests/${badId}/planning`);
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, { error: 'eventId must be a positive integer.' });
    });
  }

  test('[FAILURE] [SG2-39:AC1] a missing event returns 404 without updating planning details or adding history', async () => {
    let capturedFetchId: number | undefined;
    let updateCalled = false;
    let auditCalled = false;

    const response = await request(
      buildApp({
        captureFetchEventId: (id) => (capturedFetchId = id),
        captureUpdateFields: () => (updateCalled = true),
        captureAuditEntries: () => (auditCalled = true)
      })
    )
      .patch('/api/event-requests/999/planning')
      .send({ planning_notes: 'Notes for wrong event' });

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Event request not found.' });
    assert.equal(capturedFetchId, 999);
    assert.equal(updateCalled, false);
    assert.equal(auditCalled, false);
  });

  test('[FAILURE] [SG2-39:AC1] returns 400 when input validation fails', async () => {
    let updates = 0;
    let audits = 0;
    const response = await request(buildApp({ captureUpdateFields: () => { updates++; }, captureAuditEntries: () => { audits++; } }))
      .patch('/api/event-requests/10/planning')
      .send({ expected_attendance: -10 });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Invalid planning details', details: ['expected_attendance must be at least 1.'] });
    assert.equal(updates, 0);
    assert.equal(audits, 0);
  });

  test('[BOUNDARY] [SG2-39:AC1] an absent request body preserves existing planning fields and adds no history', async () => {
    // No express.json() here, so req.body is undefined rather than {}.
    const original = { ...BASE_EVENT, status: 'planning' };
    let stored = { ...original };
    const updates: { eventId: number; fields: UpdatePlanningFieldsInput; coordinatorId: string }[] = [];
    const audits: InsertAuditLogInput[][] = [];
    const bare = express();
    bare.patch(
      '/api/event-requests/:eventId/planning',
      createUpdateEventPlanningHandler({
        getPrincipal: () => COORDINATOR,
        getAdminClient: () => ({}) as SupabaseClient,
        fetchPlanningRecord: async () => ({ ok: true, event: { ...stored } }),
        updatePlanningFields: async (_admin, eventId, fields, coordinatorId) => {
          updates.push({ eventId, fields, coordinatorId });
          stored = { ...stored, ...fields };
          return { ok: true, event: { ...stored } };
        },
        insertAudit: async (_admin, entries) => { audits.push(entries); return { ok: true, logs: [] }; }
      })
    );
    const response = await request(bare).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 200);
    assert.deepEqual(updates, [{ eventId: 10, fields: {}, coordinatorId: COORDINATOR_ID }]);
    assert.deepEqual(stored, original);
    assert.deepEqual(audits, []);
    assert.deepEqual(response.body, { event: original, arrangements_recheck_needed: false, outstanding_arrangements: [] });
  });

  test('[FAILURE] [SG2-39:AC1] returns 503 when admin database client is unavailable', async () => {
    const response = await request(buildApp({ admin: null })).patch('/api/event-requests/10/planning').send({});
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'Event requests are temporarily unavailable. Please try again later.' });
  });

  test('[FAILURE] [SG2-39:AC1] returns 404 when event record is not found', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'not_found', message: 'Event not found.' } })
    )
      .patch('/api/event-requests/10/planning')
      .send({});
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Event request not found.' });
  });

  test('[FAILURE] [SG2-39:AC1] returns 503 when fetching event record fails', async () => {
    const response = await request(
      buildApp({ fetchResult: { ok: false, reason: 'unavailable', message: 'DB down' } })
    )
      .patch('/api/event-requests/10/planning')
      .send({});
    assert.equal(response.status, 503);
  });

  test('[FAILURE] [SG2-39:AC1] [SG2-25:AC1] returns 403 when caller is not the assigned coordinator and asserts zero update or audit calls', async () => {
    let updateCalled = false;
    let auditCalled = false;

    const response = await request(
      buildApp({
        fetchResult: {
          ok: true,
          event: { ...BASE_EVENT, coordinator_id: OTHER_COORDINATOR_ID }
        },
        captureUpdateFields: () => (updateCalled = true),
        captureAuditEntries: () => (auditCalled = true)
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({ planning_notes: 'Unauthorized change attempt' });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, {
      error: 'Only the assigned event coordinator can update planning details.'
    });
    assert.equal(updateCalled, false);
    assert.equal(auditCalled, false);
  });

  test('[CONFLICT] [SG2-90:AC3] a coordinator reassigned between reading and writing is refused with 409 and leaves no history', async () => {
    let writtenFor: string | undefined;
    let auditCalled = false;
    // The read still shows the caller as coordinator; by the time the write
    // runs the event belongs to someone else, so the guarded write matches no row.
    const response = await request(
      buildApp({
        fetchResult: { ok: true, event: { ...BASE_EVENT, coordinator_id: COORDINATOR.userId } },
        updatePlanningFields: async (_admin, _eventId, _fields, coordinatorId) => {
          writtenFor = coordinatorId;
          return { ok: false, reason: 'not_found', message: 'Event not found.' };
        },
        captureAuditEntries: () => (auditCalled = true)
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({ planning_notes: 'Written after losing the event' });

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: 'This event is no longer assigned to you. Refresh and try again.' });
    assert.equal(writtenFor, COORDINATOR.userId);
    assert.equal(auditCalled, false);
  });

  test('[CONFLICT] [SG2-39:AC5] [SG2-100:AC7] AC 5: refuses update on cancelled, completed, and rejected events with 409 without executing updates or audits', async () => {
    for (const status of ['cancelled', 'completed', 'rejected']) {
      let updateCalled = false;
      let auditCalled = false;

      const response = await request(
        buildApp({
          fetchResult: {
            ok: true,
            event: { ...BASE_EVENT, status }
          },
          captureUpdateFields: () => (updateCalled = true),
          captureAuditEntries: () => (auditCalled = true)
        })
      )
        .patch('/api/event-requests/10/planning')
        .send({ planning_notes: 'trying to update terminal' });

      assert.equal(response.status, 409);
      assert.deepEqual(response.body, {
        error: `Cannot update planning information for a ${status} event.`
      });
      assert.equal(updateCalled, false);
      assert.equal(auditCalled, false);
    }
  });

  test('[BOUNDARY] [SG2-39:AC4] cross-validates registration window against existing event dates with 400', async () => {
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

  test('[CONFLICT] [SG2-39:AC2] AC 2: returns 409 requires_confirmation when arrangement impact detected without confirm_impact', async () => {
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
    assert.deepEqual(response.body.impact_notes, [
      'Expected attendance increased from 100 to 250. Existing venue suitability and equipment requirements must be rechecked.'
    ]);
    assert.equal(updateCalled, false);
    assert.equal(auditCalled, false);
  });

  test('[NORMAL] [CONFLICT] [SG2-38:AC2] [SG2-38:AC3] [SG2-39:AC1] [SG2-39:AC2] [SG2-39:AC3] [SG2-40:AC2] an attendance change invalidates arrangements; confirming saves the change, records approved → planning and keeps the displayed stage in planning with rechecks outstanding', async () => {
    let capturedFetchEventId: number | undefined;
    let capturedUpdateEventId: number | undefined;
    let capturedFields: UpdatePlanningFieldsInput | undefined;
    let capturedAudit: InsertAuditLogInput[] | undefined;

    const response = await request(
      buildApp({
        captureFetchEventId: (id) => (capturedFetchEventId = id),
        captureUpdateEventId: (id) => (capturedUpdateEventId = id),
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
    assert.equal(capturedFetchEventId, 10);
    assert.equal(capturedUpdateEventId, 10);
    assert.equal(response.body.event.event_id, 10);
    assert.equal(response.body.arrangements_recheck_needed, true);
    assert.deepEqual(response.body.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);

    // Check captured DB fields
    assert.ok(capturedFields);
    assert.equal(capturedFields.expected_attendance, 250);
    assert.equal(capturedFields.arrangements_recheck_needed, true);
    assert.deepEqual(capturedFields.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
    assert.equal(capturedFields.status, 'planning');

    // The stage reads the saved response, including the newly stale arrangements.
    const stage = computeEventStage(response.body.event);
    assert.equal(stage.raw_status, 'planning');
    assert.equal(stage.stage, 'Arrangements');
    assert.equal(stage.stage_key, 'in_planning');
    assert.equal(stage.arrangements_recheck_needed, true);
    assert.deepEqual(stage.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
    assert.deepEqual(stage.waiting_on, {
      persona: 'Event Coordinator (Alex Coordinator)',
      action: 'Complete venue suitability check and equipment reservation',
      user_id: COORDINATOR_ID
    });
    assert.deepEqual(stage.stepper_steps.map(step => [step.key, step.status]), [
      ['draft', 'completed'], ['unassigned', 'completed'], ['under_review', 'completed'],
      ['in_planning', 'current'], ['safety_check', 'upcoming'], ['preparation', 'upcoming'],
      ['confirmed', 'upcoming']
    ]);

    // Check captured audit diffs
    assert.ok(capturedAudit);
    assert.deepEqual(capturedAudit, [
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
        field_name: 'status',
        old_value: 'approved',
        new_value: 'planning'
      }
    ]);
  });

  test('[NORMAL] [SG2-39:AC1] [SG2-39:AC3] [SG2-40:AC1] [SG2-40:AC2] AC 3: transitions approved event to planning on non-impacting update and persists diffs, including the status change by the coordinator', async () => {
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
      },
      {
        event_id: 10,
        actor_id: COORDINATOR_ID,
        field_name: 'status',
        old_value: 'approved',
        new_value: 'planning'
      }
    ]);
  });

  test('[NORMAL] [SG2-39:AC3] preserves existing planning status when event is already in planning without impact', async () => {
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
    assert.equal(response.body.event.status, 'planning');
    assert.equal(response.body.event.planning_notes, 'Another note');
    assert.ok(capturedFields);
    assert.equal(capturedFields.status, undefined);
  });

  test('[BOUNDARY] [SG2-39:AC1] does not insert audit logs when no audited fields changed', async () => {
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

  test('[FAILURE] [SG2-39:AC1] handles updatePlanningFields failure', async () => {
    // not_found: the write matched no row, because the assignment moved on (SG2-90)
    const notFoundRes = await request(
      buildApp({
        updateResult: { ok: false, reason: 'not_found', message: 'Missing' }
      })
    )
      .patch('/api/event-requests/10/planning')
      .send({ planning_notes: 'Notes' });
    assert.equal(notFoundRes.status, 409);

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

  test('[FAILURE] [SG2-39:AC1] handles insertAudit failure with 503 and verifies event state after failed audit write', async () => {
    let capturedFields: UpdatePlanningFieldsInput | undefined;
    let storedEvent: EventPlanningRecord = { ...BASE_EVENT };

    const app = buildApp({
      fetchResult: { ok: true, event: storedEvent },
      updatePlanningFields: async (_admin, _eventId, fields) => {
        capturedFields = fields;
        storedEvent = { ...storedEvent, ...fields };
        return { ok: true, event: storedEvent };
      },
      insertAuditResult: { ok: false, reason: 'unavailable', message: 'Audit insert failed' }
    });

    const auditFailRes = await request(app)
      .patch('/api/event-requests/10/planning')
      .send({ planning_notes: 'Notes after audit fail test' });

    assert.equal(auditFailRes.status, 503);
    assert.deepEqual(auditFailRes.body, {
      error: 'Event requests are temporarily unavailable. Please try again later.'
    });

    // Verify the event's state: the planning fields were updated in storage before the audit write failed
    assert.ok(capturedFields);
    assert.equal(capturedFields.planning_notes, 'Notes after audit fail test');
    assert.equal(capturedFields.status, 'planning');
    assert.equal(storedEvent.planning_notes, 'Notes after audit fail test');
    assert.equal(storedEvent.status, 'planning');
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

  test('[NORMAL] [FAILURE] [SG2-25:AC1] [SG2-39:AC1] policy grants event_request.planning.update only to event_coordinator', () => {
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
      undefined,
      undefined,
      (_req, res) => {
        res.status(200).json({ reached: true });
      }
    );

  test('[FAILURE] [SG2-25:AC3] [SG2-39:AC1] rejects unauthenticated request on app route', async () => {
    const response = await request(appForRole('event_coordinator')).patch('/api/event-requests/10/planning');
    assert.equal(response.status, 401);
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  });

  for (const role of ['event_organiser', 'venue_staff', 'technical_support_staff', 'attendee'] as const) {
    test(`[FAILURE] [SG2-25:AC1] [SG2-39:AC1] denies role ${role} with 403 on app route`, async () => {
      const response = await request(appForRole(role))
        .patch('/api/event-requests/10/planning')
        .set('Authorization', 'Bearer test-token');
      assert.equal(response.status, 403);
    });
  }

  test('[NORMAL] [SG2-39:AC1] allows event_coordinator to reach mounted planning handler on app route', async () => {
    const response = await request(appForRole('event_coordinator'))
      .patch('/api/event-requests/10/planning')
      .set('Authorization', 'Bearer test-token');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { reached: true });
  });
});
