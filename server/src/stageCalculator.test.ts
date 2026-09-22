import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEventStage, type EventStageInput } from './events/stageCalculator';

describe('computeEventStage (SG2-38)', () => {
  test('draft state returns plain-language "Draft" stage waiting on Event Organiser', () => {
    const input: EventStageInput = {
      event_id: 1,
      status: 'draft',
      organiser_id: 'org-123'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Draft');
    assert.equal(result.stage_key, 'draft');
    assert.ok(result.description.toLowerCase().includes('draft'));
    assert.deepEqual(result.waiting_on, {
      persona: 'Event Organiser',
      action: 'Complete and submit event request',
      user_id: 'org-123'
    });
    assert.equal(result.stepper_steps[0].key, 'draft');
    assert.equal(result.stepper_steps[0].status, 'current');
    assert.equal(result.stepper_steps[1].status, 'upcoming');
  });

  test('submitted state without coordinator returns "Submitted" stage waiting on ConnectSphere Staff', () => {
    const input: EventStageInput = {
      event_id: 2,
      status: 'submitted',
      organiser_id: 'org-123',
      coordinator_id: null
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Submitted');
    assert.equal(result.stage_key, 'submitted');
    assert.deepEqual(result.waiting_on, {
      persona: 'ConnectSphere Staff',
      action: 'Assign event coordinator',
      user_id: null
    });
    assert.equal(result.stepper_steps[0].status, 'completed');
    assert.equal(result.stepper_steps[1].status, 'current');
    assert.equal(result.stepper_steps[2].status, 'upcoming');
  });

  test('submitted state with coordinator assigned returns "Under Review" waiting on named coordinator', () => {
    const input: EventStageInput = {
      event_id: 3,
      status: 'submitted',
      organiser_id: 'org-123',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Under Review');
    assert.equal(result.stage_key, 'under_review');
    assert.deepEqual(result.waiting_on, {
      persona: 'Event Coordinator (Sarah Tan)',
      action: 'Review and assess event request',
      user_id: 'coord-456'
    });
    assert.equal(result.stepper_steps[0].status, 'completed');
    assert.equal(result.stepper_steps[1].status, 'completed');
    assert.equal(result.stepper_steps[2].status, 'current');
    assert.equal(result.stepper_steps[3].status, 'upcoming');
  });

  test('under_review status directly maps to "Under Review" stage', () => {
    const input: EventStageInput = {
      event_id: 4,
      status: 'under_review',
      organiser_id: 'org-123',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Under Review');
    assert.equal(result.stage_key, 'under_review');
    assert.equal(result.stepper_steps[2].status, 'current');
  });

  test('approved status returns unified "Approved — In Planning" stage waiting on coordinator arrangements', () => {
    const input: EventStageInput = {
      event_id: 5,
      status: 'approved',
      organiser_id: 'org-123',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Approved — In Planning');
    assert.equal(result.stage_key, 'in_planning');
    assert.deepEqual(result.waiting_on, {
      persona: 'Event Coordinator (Sarah Tan)',
      action: 'Complete venue suitability check and equipment reservation',
      user_id: 'coord-456'
    });
    assert.equal(result.stepper_steps[0].status, 'completed');
    assert.equal(result.stepper_steps[1].status, 'completed');
    assert.equal(result.stepper_steps[2].status, 'completed');
    assert.equal(result.stepper_steps[3].status, 'current');
    assert.equal(result.stepper_steps[4].status, 'upcoming');
  });

  test('planning status also maps to "Approved — In Planning" stage', () => {
    const input: EventStageInput = {
      event_id: 6,
      status: 'planning',
      organiser_id: 'org-123',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan',
      arrangements_recheck_needed: true,
      outstanding_arrangements: ['venue_recheck', 'equipment_recheck']
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Approved — In Planning');
    assert.equal(result.stage_key, 'in_planning');
    assert.equal(result.arrangements_recheck_needed, true);
    assert.deepEqual(result.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
  });

  test('confirmed status maps to "Confirmed" stage with no pending waiting-on', () => {
    const input: EventStageInput = {
      event_id: 7,
      status: 'confirmed',
      organiser_id: 'org-123',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Confirmed');
    assert.equal(result.stage_key, 'confirmed');
    assert.equal(result.waiting_on, null);
    assert.equal(result.stepper_steps.every((s) => s.status === 'completed'), true);
  });

  test('completed status maps to "Completed" terminal stage with all steps completed', () => {
    const input: EventStageInput = {
      event_id: 8,
      status: 'completed',
      organiser_id: 'org-123'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Completed');
    assert.equal(result.stage_key, 'completed');
    assert.equal(result.waiting_on, null);
    assert.equal(result.stepper_steps.every((s) => s.status === 'completed'), true);
  });

  test('cancelled status maps to "Cancelled" terminal stage with no pending waiting-on', () => {
    const input: EventStageInput = {
      event_id: 9,
      status: 'cancelled',
      organiser_id: 'org-123'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Cancelled');
    assert.equal(result.stage_key, 'cancelled');
    assert.equal(result.waiting_on, null);
  });

  test('rejected status maps to "Rejected" terminal stage with no pending waiting-on', () => {
    const input: EventStageInput = {
      event_id: 10,
      status: 'rejected',
      organiser_id: 'org-123'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Rejected');
    assert.equal(result.stage_key, 'rejected');
    assert.equal(result.waiting_on, null);
  });
});
