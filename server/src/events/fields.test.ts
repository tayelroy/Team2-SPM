import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_CATEGORIES,
  SUBMISSION_REQUIRED_FIELDS,
  isEventCategory,
  missingForSubmission,
  validateDraftInput,
  type DraftValues
} from './fields';

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
    registration_needed: false, category: 'conference'
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

describe('the event category (SG2-70)', () => {
  test('[NORMAL] [SG2-70:AC2] a draft keeps any of the seven categories', () => {
    assert.deepEqual([...EVENT_CATEGORIES], ['conference', 'workshop', 'seminar', 'training', 'networking', 'social', 'other']);
    for (const category of EVENT_CATEGORIES) {
      assert.deepEqual(validateDraftInput({ category }), { valid: true, values: { ...emptyDraft(), category } });
      assert.equal(isEventCategory(category), true);
    }
  });

  test('[BOUNDARY] [SG2-70:AC2] a blank or missing category saves as none and does not hold up submission', () => {
    for (const body of [{}, { category: '' }, { category: null }]) {
      const result = validateDraftInput(body);
      assert.deepEqual(result, { valid: true, values: emptyDraft() });
      assert.equal(missingForSubmission(result.valid ? result.values : {}).includes('category'), false);
    }
  });

  test('[FAILURE] [SG2-70:AC2] a category outside the list, in another case or not text is refused by name', () => {
    const message = 'category must be one of: conference, workshop, seminar, training, networking, social, other.';
    for (const category of ['party', 'Conference', ' social', 3, true]) {
      assert.deepEqual(validateDraftInput({ category }), { valid: false, errors: [message] });
      assert.equal(isEventCategory(category), false);
    }
  });
});

function emptyDraft(): DraftValues {
  return {
    name: null, purpose: null, description: null, proposed_date: null, expected_attendance: null,
    venue_requirements: null, preferred_layout: null, accessibility_needs: null, equipment_requirements: null,
    registration_needed: null, category: null
  };
}
