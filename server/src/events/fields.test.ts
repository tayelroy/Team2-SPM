import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_STATUSES, STATUS_TRANSITIONS, canTransition, type EventStatus } from './fields';

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
