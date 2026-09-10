import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventRequestFields, validateEventRequestForSubmission } from './validation';

const complete: EventRequestFields = {
  eventName: 'Partner Forum',
  purpose: 'Strengthen institutional partnerships',
  description: 'A half-day forum with keynotes and a panel.',
  proposedDateTime: '2026-10-12T09:00:00Z',
  expectedAttendance: 180,
  venueRequirements: 'Stage, step-free access, hearing loop',
  equipmentRequirements: 'Lectern and PA system',
  registrationNeeded: true,
  accessibilityNeeds: null
};

describe('validateEventRequestForSubmission', () => {
  test('accepts a draft with every mandatory field complete', () => {
    assert.deepEqual(validateEventRequestForSubmission(complete), { ok: true });
  });

  test('accepts a complete draft even when the optional accessibility field is blank', () => {
    const { accessibilityNeeds, ...rest } = complete;
    assert.deepEqual(validateEventRequestForSubmission(rest), { ok: true });
  });

  for (const [key, blankValue] of [
    ['eventName', ''],
    ['eventName', '   '],
    ['purpose', ''],
    ['description', ''],
    ['venueRequirements', ''],
    ['equipmentRequirements', '']
  ] as const) {
    test(`reports "${key}" missing when it is ${JSON.stringify(blankValue)}`, () => {
      const result = validateEventRequestForSubmission({ ...complete, [key]: blankValue });
      assert.equal(result.ok, false);
      assert.equal((result as { missingFields: string[] }).missingFields.length, 1);
    });
  }

  test('reports every blank string field as undefined too', () => {
    const result = validateEventRequestForSubmission({ ...complete, eventName: undefined });
    assert.equal(result.ok, false);
    assert.deepEqual((result as { missingFields: string[] }).missingFields, ['Event name']);
  });

  for (const value of [undefined, '', '   ', 'not-a-date']) {
    test(`reports proposed date and time missing for ${JSON.stringify(value)}`, () => {
      const result = validateEventRequestForSubmission({ ...complete, proposedDateTime: value });
      assert.equal(result.ok, false);
      assert.deepEqual((result as { missingFields: string[] }).missingFields, ['Proposed date and time']);
    });
  }

  test('accepts a valid but non-ISO date string', () => {
    assert.deepEqual(
      validateEventRequestForSubmission({ ...complete, proposedDateTime: '2026-10-12' }),
      { ok: true }
    );
  });

  for (const value of [undefined, 0, -5, 1.5, NaN, 'not-a-number' as unknown as number]) {
    test(`reports expected attendance missing for ${JSON.stringify(value)}`, () => {
      const result = validateEventRequestForSubmission({ ...complete, expectedAttendance: value });
      assert.equal(result.ok, false);
      assert.deepEqual((result as { missingFields: string[] }).missingFields, ['Expected attendance']);
    });
  }

  test('accepts the smallest valid expected attendance', () => {
    assert.deepEqual(validateEventRequestForSubmission({ ...complete, expectedAttendance: 1 }), { ok: true });
  });

  for (const value of [undefined, 'true' as unknown as boolean]) {
    test(`reports whether registration is needed as missing for ${JSON.stringify(value)}`, () => {
      const result = validateEventRequestForSubmission({ ...complete, registrationNeeded: value });
      assert.equal(result.ok, false);
      assert.deepEqual((result as { missingFields: string[] }).missingFields, ['Whether registration is needed']);
    });
  }

  test('accepts registration needed set to false', () => {
    assert.deepEqual(validateEventRequestForSubmission({ ...complete, registrationNeeded: false }), { ok: true });
  });

  test('lists every missing mandatory field, in a stable order, for an empty draft', () => {
    const result = validateEventRequestForSubmission({});
    assert.equal(result.ok, false);
    assert.deepEqual((result as { missingFields: string[] }).missingFields, [
      'Event name',
      'Purpose',
      'Description',
      'Proposed date and time',
      'Expected attendance',
      'Venue requirements',
      'Equipment requirements',
      'Whether registration is needed'
    ]);
  });
});
