import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { registrationWindow, type RegistrationWindowEvent } from './registrationWindow';

const OPENS = '2030-06-01T00:00:00.000Z';
const CLOSES = '2030-06-19T16:00:00.000Z';
const CONFIRMED: RegistrationWindowEvent = {
  status: 'confirmed', registration_needed: true, registration_opens_at: OPENS, registration_closes_at: CLOSES
};

describe('registrationWindow (SG2-58 AC3)', () => {
  test('[NORMAL] [SG2-58:AC3] a confirmed event needing registration is open between its opening and closing times', () => {
    assert.equal(registrationWindow(CONFIRMED, new Date('2030-06-10T00:00:00.000Z')), 'open');
    assert.equal(registrationWindow({ ...CONFIRMED, status: 'Confirmed' }, new Date('2030-06-10T00:00:00.000Z')), 'open');
  });

  test('[BOUNDARY] [SG2-58:AC3] opens exactly at opens_at and closes exactly at closes_at', () => {
    assert.equal(registrationWindow(CONFIRMED, new Date('2030-05-31T23:59:59.999Z')), 'not_yet_open');
    assert.equal(registrationWindow(CONFIRMED, new Date(OPENS)), 'open');
    assert.equal(registrationWindow(CONFIRMED, new Date('2030-06-19T15:59:59.999Z')), 'open');
    assert.equal(registrationWindow(CONFIRMED, new Date(CLOSES)), 'closed');
  });

  test('[FAILURE] [SG2-58:AC3] an event that is not confirmed never opens, even inside its window', () => {
    const inside = new Date('2030-06-10T00:00:00.000Z');
    for (const status of ['preparation', 'planning', 'approved', 'awaiting_safety_check', 'cancelled']) {
      assert.equal(registrationWindow({ ...CONFIRMED, status }, inside), 'not_confirmed', status);
    }
  });

  test('[BOUNDARY] [SG2-58:AC3] no registration needed is not_required whatever the status or times', () => {
    const inside = new Date('2030-06-10T00:00:00.000Z');
    assert.equal(registrationWindow({ ...CONFIRMED, registration_needed: false }, inside), 'not_required');
    assert.equal(registrationWindow({ ...CONFIRMED, registration_needed: null, status: 'preparation' }, inside), 'not_required');
  });

  test('[CONFLICT] [SG2-58:AC3] a completed event is closed and a confirmed event missing a time is not yet open', () => {
    const inside = new Date('2030-06-10T00:00:00.000Z');
    assert.equal(registrationWindow({ ...CONFIRMED, status: 'completed' }, inside), 'closed');
    assert.equal(registrationWindow({ ...CONFIRMED, registration_opens_at: null }, inside), 'not_yet_open');
    assert.equal(registrationWindow({ ...CONFIRMED, registration_closes_at: null }, inside), 'not_yet_open');
  });
});
