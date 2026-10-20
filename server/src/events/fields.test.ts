import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_STATUSES,
  STATUS_TRANSITIONS,
  SUBMISSION_REQUIRED_FIELDS,
  canTransition,
  missingForSubmission,
  validateDraftInput,
  type DraftValues,
  type EventStatus
} from './fields';

describe('STATUS_TRANSITIONS / canTransition (SG2-100 Unit 1)', () => {
  test('[NORMAL] [SG2-100:AC4] unassigned legally transitions to submitted once a coordinator is assigned', () => {
    assert.equal(canTransition('unassigned', 'submitted'), true);
  });

  test('[NORMAL] [SG2-100:AC4] awaiting_safety_check legally transitions to preparation once safety passes', () => {
    assert.equal(canTransition('awaiting_safety_check', 'preparation'), true);
  });

  test('[BOUNDARY] [SG2-100:AC4] completed accepts no outgoing transition, to any status, proving it is terminal', () => {
    for (const to of EVENT_STATUSES) {
      assert.equal(canTransition('completed', to), false, `completed -> ${to} should be illegal`);
    }
  });

  test('[CONFLICT] [SG2-100:AC4] awaiting_safety_check cannot skip Preparation straight to confirmed', () => {
    assert.equal(canTransition('awaiting_safety_check', 'confirmed'), false);
  });

  test('[FAILURE] [SG2-100:AC4] draft cannot jump straight to confirmed', () => {
    assert.equal(canTransition('draft', 'confirmed'), false);
  });

  test('[NORMAL] [SG2-100:AC4] cancellation is reachable from preparation, awaiting_safety_check and safety_rejected', () => {
    assert.equal(canTransition('preparation', 'cancelled'), true);
    assert.equal(canTransition('awaiting_safety_check', 'cancelled'), true);
    assert.equal(canTransition('safety_rejected', 'cancelled'), true);
  });

  test('[NORMAL] [SG2-81:AC6] a Preparation or Confirmed event can move back to Planning when its venue becomes unavailable', () => {
    assert.equal(canTransition('preparation', 'planning'), true);
    assert.equal(canTransition('confirmed', 'planning'), true);
  });

  test('[BOUNDARY] [SG2-81:AC6] Planning is reachable only from approved (the normal way in), the safety check, Preparation and Confirmed, never from the earlier stages or the terminal ones', () => {
    const back = EVENT_STATUSES.filter(from => canTransition(from, 'planning'));
    assert.deepEqual([...back].sort(), ['approved', 'awaiting_safety_check', 'confirmed', 'preparation']);
  });

  test('[FAILURE] [SG2-81:AC6] a completed or cancelled event still cannot go back to Planning', () => {
    assert.equal(canTransition('completed', 'planning'), false);
    assert.equal(canTransition('cancelled', 'planning'), false);
  });

  test('[NORMAL] [SG2-91:AC1] an Approved or Planning event whose arrangements are in place can move to Awaiting Safety Check', () => {
    assert.equal(canTransition('approved', 'awaiting_safety_check'), true);
    assert.equal(canTransition('planning', 'awaiting_safety_check'), true);
  });

  test('[BOUNDARY] [SG2-91:AC1] only Approved and Planning events enter the safety check', () => {
    const into = EVENT_STATUSES.filter(from => canTransition(from, 'awaiting_safety_check'));
    assert.deepEqual([...into].sort(), ['approved', 'planning']);
  });

  test('[BOUNDARY] [SG2-100:AC4] every EVENT_STATUSES member has a STATUS_TRANSITIONS entry', () => {
    for (const status of EVENT_STATUSES) {
      assert.ok(
        Array.isArray(STATUS_TRANSITIONS[status as EventStatus]),
        `${status} is missing a STATUS_TRANSITIONS entry`
      );
    }
  });

  test('[BOUNDARY] [SG2-100:AC4] cancelled accepts no outgoing transition, proving it is terminal alongside completed', () => {
    for (const to of EVENT_STATUSES) {
      assert.equal(canTransition('cancelled', to), false, `cancelled -> ${to} should be illegal`);
    }
  });

  test('[FAILURE] [SG2-100:AC4] an unrecognised from-status falls back to no legal transitions instead of throwing', () => {
    assert.equal(canTransition('not_a_real_status' as EventStatus, 'confirmed'), false);
  });
});

describe('the customer minimum for submission (SG2-105)', () => {
  // Customer clarification session 2 is the oracle, written out independently of the validator.
  const CUSTOMER_MINIMUM = [
    'name', 'purpose', 'description', 'proposed_date', 'expected_attendance', 'venue_requirements',
    'preferred_layout', 'accessibility_needs', 'equipment_requirements', 'registration_needed'
  ];
  const COMPLETE: DraftValues = {
    name: 'Partner Forum', purpose: 'Client relationship building', description: 'Quarterly forum.',
    proposed_date: '2026-11-04T09:00:00.000Z', expected_attendance: 120, venue_requirements: 'Stage',
    preferred_layout: 'Theatre', accessibility_needs: 'None', equipment_requirements: 'None',
    registration_needed: false
  };

  test('[NORMAL] [SG2-105:AC1] submission requires every field the customer listed, layout included', () => {
    assert.deepEqual([...SUBMISSION_REQUIRED_FIELDS], CUSTOMER_MINIMUM);
    assert.deepEqual(missingForSubmission(COMPLETE), []);
  });

  test('[BOUNDARY] [SG2-105:AC2] "None" answers accessibility needs and equipment requirements, but blank does not', () => {
    const blank = validateDraftInput({ ...COMPLETE, accessibility_needs: '   ', equipment_requirements: '' });
    assert.equal(blank.valid, true);
    assert.deepEqual(missingForSubmission(blank.valid ? blank.values : {}), ['accessibility_needs', 'equipment_requirements']);
    const none = validateDraftInput({ ...COMPLETE, accessibility_needs: ' None ', equipment_requirements: 'none' });
    assert.equal(none.valid, true);
    assert.deepEqual(missingForSubmission(none.valid ? none.values : {}), []);
  });

  test('[BOUNDARY] [SG2-105:AC1] "No" is an answer to whether registration is needed, but no answer is missing', () => {
    assert.deepEqual(missingForSubmission({ ...COMPLETE, registration_needed: false }), []);
    assert.deepEqual(missingForSubmission({ ...COMPLETE, registration_needed: null }), ['registration_needed']);
  });

  test('[NORMAL] [SG2-105:AC4] a draft keeps the preferred layout as trimmed text and may leave it out', () => {
    assert.deepEqual(validateDraftInput({ preferred_layout: '  Banquet rounds of ten  ' }),
      { valid: true, values: { ...emptyDraft(), preferred_layout: 'Banquet rounds of ten' } });
    const withoutLayout = validateDraftInput({ name: 'Partner Forum' });
    assert.deepEqual(withoutLayout, { valid: true, values: { ...emptyDraft(), name: 'Partner Forum' } });
    assert.ok(missingForSubmission(withoutLayout.valid ? withoutLayout.values : {}).includes('preferred_layout'));
  });

  test('[BOUNDARY] [SG2-105:AC1] the preferred layout takes up to 5000 characters, like the other requirements', () => {
    assert.equal(validateDraftInput({ preferred_layout: 'x'.repeat(5000) }).valid, true);
    assert.deepEqual(validateDraftInput({ preferred_layout: 'x'.repeat(5001) }),
      { valid: false, errors: ['preferred_layout must be 5000 characters or fewer.'] });
  });

  test('[FAILURE] [SG2-105:AC1] a preferred layout that is not text is refused', () => {
    assert.deepEqual(validateDraftInput({ preferred_layout: 3 }),
      { valid: false, errors: ['preferred_layout must be text.'] });
  });
});

function emptyDraft(): DraftValues {
  return {
    name: null, purpose: null, description: null, proposed_date: null, expected_attendance: null,
    venue_requirements: null, preferred_layout: null, accessibility_needs: null, equipment_requirements: null,
    registration_needed: null
  };
}
