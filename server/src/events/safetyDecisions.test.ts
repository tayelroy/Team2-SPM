import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFETY_DECISION_NEXT_STATUS,
  safetyArrangementList,
  validateSafetyDecision
} from './safetyDecisions';

/** The safety_check_revision SG2-91's list showed with the event. */
const R = { safety_check_revision: 3 };

describe('validateSafetyDecision (SG2-92)', () => {
  test('[NORMAL] [SG2-92:AC1] [SG2-92:AC2] each of the three decisions is accepted with what it needs, trimmed, on the reviewed revision', () => {
    assert.deepEqual(validateSafetyDecision({ decision: 'approve', ...R }),
      { valid: true, value: { decision: 'approve', reason: null, arrangements: [], expectedRevision: 3 } });
    assert.deepEqual(validateSafetyDecision({ decision: 'approve', reason: '  Keep the east exit clear  ', arrangements: [], ...R }),
      { valid: true, value: { decision: 'approve', reason: 'Keep the east exit clear', arrangements: [], expectedRevision: 3 } });
    assert.deepEqual(validateSafetyDecision({ decision: 'reject', reason: ' Fire exit blocked ', ...R }),
      { valid: true, value: { decision: 'reject', reason: 'Fire exit blocked', arrangements: [], expectedRevision: 3 } });
    assert.deepEqual(validateSafetyDecision({ decision: 'request_changes', reason: 'Move the stage', arrangements: ['equipment', 'venue'], ...R }),
      { valid: true, value: { decision: 'request_changes', reason: 'Move the stage', arrangements: ['equipment', 'venue'], expectedRevision: 3 } });
  });

  test('[BOUNDARY] [SG2-92:AC1] the reviewed revision must be a whole number from 0 to the largest safe integer', () => {
    for (const safety_check_revision of [0, Number.MAX_SAFE_INTEGER]) {
      const accepted = validateSafetyDecision({ decision: 'approve', safety_check_revision });
      assert.equal(accepted.valid && accepted.value.expectedRevision, safety_check_revision);
    }
    for (const safety_check_revision of [undefined, null, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      assert.deepEqual(validateSafetyDecision({ decision: 'approve', safety_check_revision }),
        { valid: false, errors: ['safety_check_revision must be the whole-number revision shown with the event.'] }, String(safety_check_revision));
    }
  });

  test('[FAILURE] [SG2-92:AC1] an unknown or missing decision, or a body that is not an object, is refused', () => {
    for (const body of [{}, { decision: 'approved' }, { decision: 7 }, null, 'approve', ['approve']]) {
      assert.deepEqual(validateSafetyDecision(body), { valid: false, errors: ['decision must be one of approve, reject, request_changes.'] }, JSON.stringify(body));
    }
  });

  test('[FAILURE] [SG2-92:AC2] Reject and Request Changes without a reason, or with a blank one, are refused', () => {
    for (const reason of [undefined, null, '', '   ']) {
      assert.deepEqual(validateSafetyDecision({ decision: 'reject', reason, ...R }),
        { valid: false, errors: ['A reason is required to reject.'] });
      assert.deepEqual(validateSafetyDecision({ decision: 'request_changes', reason, arrangements: ['venue'], ...R }),
        { valid: false, errors: ['A reason is required to request changes.'] });
    }
  });

  test('[BOUNDARY] [SG2-92:AC2] a 2000-character reason is accepted and 2001 refused, counted in characters', () => {
    const emoji = '🔥'.repeat(2000);
    const accepted = validateSafetyDecision({ decision: 'reject', reason: emoji, ...R });
    assert.equal(accepted.valid && accepted.value.reason, emoji);
    assert.deepEqual(validateSafetyDecision({ decision: 'reject', reason: 'x'.repeat(2001), ...R }),
      { valid: false, errors: ['reason must be at most 2000 characters.'] });
  });

  test('[FAILURE] [SG2-92:AC2] a reason that is not text is refused without asking for one again', () => {
    assert.deepEqual(validateSafetyDecision({ decision: 'reject', reason: 42, ...R }), { valid: false, errors: ['reason must be text.'] });
  });

  test('[FAILURE] [SG2-92:AC2] Request Changes must name at least one known arrangement, each once', () => {
    const base = { decision: 'request_changes', reason: 'Move the stage', ...R };
    for (const arrangements of [undefined, null, [], 'venue']) {
      assert.deepEqual(validateSafetyDecision({ ...base, arrangements }), { valid: false, errors: ['Name at least one arrangement to change.'] });
    }
    assert.deepEqual(validateSafetyDecision({ ...base, arrangements: ['venue', 'catering'] }),
      { valid: false, errors: ['arrangements must be drawn from venue, equipment, other.'] });
    assert.deepEqual(validateSafetyDecision({ ...base, arrangements: ['venue', 'venue'] }),
      { valid: false, errors: ['Each arrangement may be named only once.'] });
  });

  test('[CONFLICT] [SG2-92:AC2] Approve and Reject cannot name arrangements to change', () => {
    for (const decision of ['approve', 'reject']) {
      assert.deepEqual(validateSafetyDecision({ decision, reason: 'Fine', arrangements: ['venue'], ...R }),
        { valid: false, errors: ['Arrangements are named only when requesting changes.'] });
    }
  });

  test('[NORMAL] [SG2-92:AC2] every problem with a request is reported together', () => {
    assert.deepEqual(validateSafetyDecision({ decision: 'request_changes', reason: 3, arrangements: [] }), { valid: false, errors: [
      'reason must be text.', 'Name at least one arrangement to change.',
      'safety_check_revision must be the whole-number revision shown with the event.'
    ] });
  });
});

describe('safety decision vocabulary (SG2-92)', () => {
  test('[NORMAL] [SG2-92:AC3] [SG2-92:AC4] Approve leads to Preparation, Reject to Safety Rejected and Request Changes to Planning', () => {
    assert.deepEqual(SAFETY_DECISION_NEXT_STATUS, { approve: 'preparation', reject: 'safety_rejected', request_changes: 'planning' });
  });

  test('[NORMAL] [SG2-92:AC2] named arrangements read in the order given', () => {
    assert.equal(safetyArrangementList(['other', 'venue', 'equipment']), 'Other, Venue, Equipment and technical');
    assert.equal(safetyArrangementList([]), '');
  });
});
