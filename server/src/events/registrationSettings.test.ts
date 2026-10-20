import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  belowRegisteredMessage,
  clearedOnceConfirmed,
  capacityWarnings,
  isRegistrationSettingField,
  placesRemaining,
  validateRegistrationSchedule,
  validateRegistrationSettings
} from './registrationSettings';

describe('validateRegistrationSettings (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC5] capacity and opening and closing times are accepted and times normalised', () => {
    assert.deepEqual(validateRegistrationSettings({
      registration_capacity: 150, registration_opens_at: '2030-06-01T09:00:00+08:00', registration_closes_at: '2030-06-10T01:00:00Z'
    }), { valid: true, values: {
      registration_capacity: 150, registration_opens_at: '2030-06-01T01:00:00.000Z', registration_closes_at: '2030-06-10T01:00:00.000Z'
    } });
  });

  test('[NORMAL] [SG2-63:AC5] [SG2-63:AC6] one setting alone may change, and null clears it', () => {
    assert.deepEqual(validateRegistrationSettings({ registration_closes_at: '2030-06-12T01:00:00Z' }),
      { valid: true, values: { registration_closes_at: '2030-06-12T01:00:00.000Z' } });
    assert.deepEqual(validateRegistrationSettings({ registration_capacity: null, registration_opens_at: null }),
      { valid: true, values: { registration_capacity: null, registration_opens_at: null } });
  });

  test('[BOUNDARY] [SG2-63:AC5] capacity runs from 1 to the largest stored whole number', () => {
    for (const capacity of [1, 2_147_483_647]) {
      assert.deepEqual(validateRegistrationSettings({ registration_capacity: capacity }),
        { valid: true, values: { registration_capacity: capacity } });
    }
    for (const capacity of [0, -1, 2_147_483_648, 1.5, '9', true]) {
      assert.deepEqual(validateRegistrationSettings({ registration_capacity: capacity }),
        { valid: false, errors: ['registration_capacity must be a whole number from 1 to 2147483647.'] }, String(capacity));
    }
  });

  test('[FAILURE] [SG2-63:AC5] times that are not dates are refused, each named', () => {
    assert.deepEqual(validateRegistrationSettings({ registration_opens_at: 'soon', registration_closes_at: 5 }), {
      valid: false,
      errors: ['registration_opens_at must be a valid date and time.', 'registration_closes_at must be a valid date and time.']
    });
  });

  test('[FAILURE] [SG2-63:AC5] [SG2-63:AC8] a body that is not an object, is empty, or carries other fields is refused', () => {
    for (const body of [null, [], 'capacity']) {
      assert.deepEqual(validateRegistrationSettings(body), { valid: false, errors: ['Request body must be a JSON object.'] });
    }
    assert.deepEqual(validateRegistrationSettings({}),
      { valid: false, errors: ['Send at least one registration setting to change.'] });
    assert.deepEqual(validateRegistrationSettings({ registration_capacity: 10, registration_needed: false }), {
      valid: false,
      errors: ['Only registration_capacity, registration_opens_at, registration_closes_at can be changed here.']
    });
  });

  test('[NORMAL] [SG2-63:AC8] only capacity and the two times are registration settings', () => {
    assert.deepEqual(['registration_capacity', 'registration_opens_at', 'registration_closes_at', 'registration_needed', 'planning_notes']
      .map(isRegistrationSettingField), [true, true, true, false, false]);
  });
});

describe('validateRegistrationSchedule (SG2-63)', () => {
  const NOW = Date.parse('2030-06-05T00:00:00.000Z');
  const STORED = {
    proposed_date: '2030-06-20T01:00:00.000Z', registration_capacity: 100,
    registration_opens_at: '2030-06-01T01:00:00.000Z', registration_closes_at: '2030-06-10T01:00:00.000Z'
  };

  test('[NORMAL] [SG2-63:AC5] a consistent change has no problems', () => {
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_capacity: 120 }, NOW), []);
    assert.deepEqual(validateRegistrationSchedule(STORED, {
      registration_opens_at: '2030-06-02T01:00:00.000Z', registration_closes_at: '2030-06-15T01:00:00.000Z'
    }, NOW), []);
  });

  test('[NORMAL] [SG2-63:AC6] registration that has closed is reopened, and open registration extended, by a later closing time', () => {
    const closed = { ...STORED, registration_closes_at: '2030-06-04T01:00:00.000Z' };
    assert.deepEqual(validateRegistrationSchedule(closed, { registration_closes_at: '2030-06-12T01:00:00.000Z' }, NOW), []);
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_closes_at: '2030-06-19T01:00:00.000Z' }, NOW), []);
  });

  test('[BOUNDARY] [SG2-63:AC5] [SG2-63:AC6] a new closing time must be after now, one millisecond later is enough', () => {
    const message = 'A new closing time must be in the future. Use Close registration now to close it immediately.';
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_closes_at: '2030-06-05T00:00:00.000Z' }, NOW), [message]);
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_closes_at: '2030-06-05T00:00:00.001Z' }, NOW), []);
    // A stored closing time already past is not re-judged when something else changes.
    assert.deepEqual(validateRegistrationSchedule({ ...STORED, registration_closes_at: '2030-06-04T01:00:00.000Z' },
      { registration_capacity: 90 }, NOW), []);
  });

  test('[BOUNDARY] [SG2-63:AC5] registration must close after it opens, judged with the stored value', () => {
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_opens_at: '2030-06-10T01:00:00.000Z' }, NOW),
      ['Registration must close after it opens.']);
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_opens_at: '2030-06-10T00:59:59.999Z' }, NOW), []);
  });

  test('[BOUNDARY] [SG2-63:AC5] registration opens and closes before the event starts', () => {
    assert.deepEqual(validateRegistrationSchedule(STORED, {
      registration_opens_at: '2030-06-20T01:00:00.000Z', registration_closes_at: '2030-06-21T01:00:00.000Z'
    }, NOW), ['Registration must open before the event starts.', 'Registration must close before the event starts.']);
    // Closing exactly as the event starts is refused; a millisecond before is not.
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_closes_at: '2030-06-20T01:00:00.000Z' }, NOW),
      ['Registration must close before the event starts.']);
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_closes_at: '2030-06-20T00:59:59.999Z' }, NOW), []);
  });

  test('[BOUNDARY] [SG2-63:AC5] without a date or a time there is nothing to compare', () => {
    assert.deepEqual(validateRegistrationSchedule({ ...STORED, proposed_date: null },
      { registration_closes_at: '2031-01-01T00:00:00.000Z' }, NOW), []);
    assert.deepEqual(validateRegistrationSchedule(STORED, { registration_opens_at: null, registration_closes_at: null }, NOW), []);
  });
});

describe('capacity warnings and places remaining (SG2-63)', () => {
  const VENUES = [
    { venue_id: 1, name: 'Main hall', capacity: 120 },
    { venue_id: 2, name: 'Annex', capacity: 40 },
    { venue_id: 3, name: 'Lawn', capacity: null }
  ];

  test('[BOUNDARY] [SG2-63:AC7] a capacity above a booked venue warns, naming each venue it exceeds, and equal does not', () => {
    assert.deepEqual(capacityWarnings(40, VENUES), []);
    assert.deepEqual(capacityWarnings(41, VENUES), ['A capacity of 41 is more than Annex holds (40).']);
    assert.deepEqual(capacityWarnings(121, VENUES), [
      'A capacity of 121 is more than Main hall holds (120).', 'A capacity of 121 is more than Annex holds (40).'
    ]);
  });

  test('[BOUNDARY] [SG2-63:AC7] no capacity or no booked venue gives no warning', () => {
    assert.deepEqual(capacityWarnings(null, VENUES), []);
    assert.deepEqual(capacityWarnings(500, []), []);
  });

  test('[FAILURE] [SG2-63:AC10] once confirmed, no setting can be cleared; before that, or when only changed, it can', () => {
    const message = 'Capacity and opening and closing times cannot be cleared once the event is confirmed. Close registration early instead.';
    for (const field of ['registration_capacity', 'registration_opens_at', 'registration_closes_at'] as const) {
      assert.deepEqual(clearedOnceConfirmed('confirmed', { [field]: null }), [message], field);
      assert.deepEqual(clearedOnceConfirmed('planning', { [field]: null }), [], field);
    }
    assert.deepEqual(clearedOnceConfirmed('confirmed', { registration_capacity: 9, registration_closes_at: '2030-06-12T01:00:00.000Z' }), []);
  });

  test('[NORMAL] [SG2-63:AC5] a capacity below the registered count is explained with the count', () => {
    assert.equal(belowRegisteredMessage(2), '2 people are already registered, so the capacity cannot be lower than 2.');
  });

  test('[BOUNDARY] [SG2-63:AC1] places remaining never drop below zero and are unknown without a capacity', () => {
    assert.deepEqual([placesRemaining(10, 3), placesRemaining(10, 10), placesRemaining(10, 12), placesRemaining(null, 3)],
      [7, 0, 0, null]);
  });
});
