import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEventStage, type EventStageInput } from './events/stageCalculator';

describe('computeEventStage (SG2-38)', () => {
  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] draft state returns plain-language "Draft" stage waiting on Event Organiser', () => {
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

  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] submitted state without coordinator returns "Submitted" stage waiting on ConnectSphere Staff', () => {
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
    assert.equal(result.stepper_steps[1].status, 'completed');
    assert.equal(result.stepper_steps[2].status, 'current');
    assert.equal(result.stepper_steps[3].status, 'upcoming');
  });

  test('[BOUNDARY] [SG2-100:AC2] submitted with coordinator_id null still lands at the under_review step, matching Unit 2\'s post-removal behaviour', () => {
    const result = computeEventStage({
      event_id: 2,
      status: 'submitted',
      coordinator_id: null
    });
    assert.equal(result.stepper_steps[2].status, 'current');
  });

  test('[NORMAL] [SG2-100:AC1] [SG2-100:AC5] unassigned status returns "Awaiting Assignment" stage waiting on the Event Coordinator Lead', () => {
    const result = computeEventStage({
      event_id: 20,
      status: 'unassigned',
      organiser_id: 'org-123'
    });

    assert.equal(result.stage, 'Awaiting Assignment');
    assert.equal(result.stage_key, 'unassigned');
    assert.deepEqual(result.waiting_on, {
      persona: 'Event Coordinator Lead',
      action: 'Assign an event coordinator',
      user_id: null
    });
    assert.equal(result.stepper_steps[0].status, 'completed');
    assert.equal(result.stepper_steps[1].status, 'current');
    assert.equal(result.stepper_steps[2].status, 'upcoming');
  });

  test('[NORMAL] [SG2-100:AC1] [SG2-100:AC5] awaiting_safety_check status waits on the Safety Officer at the safety_check step', () => {
    const result = computeEventStage({
      event_id: 21,
      status: 'awaiting_safety_check',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    });

    assert.equal(result.stage, 'Awaiting Safety Check');
    assert.equal(result.stage_key, 'awaiting_safety_check');
    assert.deepEqual(result.waiting_on, {
      persona: 'Safety Officer',
      action: 'Complete the operational safety check',
      user_id: null
    });
    assert.equal(result.stepper_steps[4].key, 'safety_check');
    assert.equal(result.stepper_steps[4].status, 'current');
  });

  test('[NORMAL] [SG2-100:AC1] [SG2-100:AC5] safety_rejected status has no waiting_on and stays at the safety_check step', () => {
    const result = computeEventStage({
      event_id: 22,
      status: 'safety_rejected',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    });

    assert.equal(result.stage, 'Safety Rejected');
    assert.equal(result.stage_key, 'safety_rejected');
    assert.equal(result.waiting_on, null);
    assert.equal(result.stepper_steps[4].key, 'safety_check');
    assert.equal(result.stepper_steps[4].status, 'current');
  });

  test('[NORMAL] [SG2-100:AC1] [SG2-100:AC5] preparation status waits on the named coordinator at the preparation step', () => {
    const result = computeEventStage({
      event_id: 23,
      status: 'preparation',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    });

    assert.equal(result.stage, 'Preparation');
    assert.equal(result.stage_key, 'preparation');
    assert.deepEqual(result.waiting_on, {
      persona: 'Event Coordinator (Sarah Tan)',
      action: 'Complete final preparations and confirm the event',
      user_id: 'coord-456'
    });
    assert.equal(result.stepper_steps[5].key, 'preparation');
    assert.equal(result.stepper_steps[5].status, 'current');
  });

  test('[BOUNDARY] [SG2-100:AC1] preparation status with no coordinator_id falls back to a null user_id', () => {
    const result = computeEventStage({
      event_id: 24,
      status: 'preparation'
    });

    assert.equal(result.waiting_on?.persona, 'Event Coordinator');
    assert.equal(result.waiting_on?.user_id, null);
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] submitted state with coordinator assigned returns "Under Review" waiting on named coordinator', () => {
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

  test('[NORMAL] [SG2-36:AC1] a request returned for clarification waits on the organiser at the review step', () => {
    const input: EventStageInput = {
      event_id: 4,
      status: 'needs_clarification',
      organiser_id: 'org-123',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Clarification Needed');
    assert.equal(result.stage_key, 'needs_clarification');
    // The organiser can see that a response is needed from them, not from staff.
    assert.deepEqual(result.waiting_on, {
      persona: 'Event Organiser',
      action: 'Answer the coordinator and resubmit the request',
      user_id: 'org-123'
    });
    // Still at review: the request is paused, not moved backwards or forwards.
    assert.equal(result.stepper_steps[2].status, 'current');
    assert.equal(result.stepper_steps[3].status, 'upcoming');
  });

  test('[BOUNDARY] [SG2-36:AC1] a returned request with no recorded organiser still names who it waits on', () => {
    const result = computeEventStage({
      event_id: 4,
      status: 'needs_clarification',
      organiser_id: undefined as unknown as string
    });
    assert.equal(result.waiting_on?.persona, 'Event Organiser');
    assert.equal(result.waiting_on?.user_id, null);
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] under_review status directly maps to "Under Review" stage', () => {
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

  test('[NORMAL] [SG2-100:D1] approved status returns relabelled "Arrangements" stage waiting on coordinator arrangements', () => {
    const input: EventStageInput = {
      event_id: 5,
      status: 'approved',
      organiser_id: 'org-123',
      coordinator_id: 'coord-456',
      coordinator_name: 'Sarah Tan'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Arrangements');
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

  test('[NORMAL] [SG2-100:D1] planning status also maps to "Arrangements" stage with stage_key unchanged at in_planning', () => {
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

    assert.equal(result.stage, 'Arrangements');
    assert.equal(result.stage_key, 'in_planning');
    assert.equal(result.arrangements_recheck_needed, true);
    assert.deepEqual(result.outstanding_arrangements, ['venue_recheck', 'equipment_recheck']);
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] confirmed status maps to "Confirmed" stage with no pending waiting-on', () => {
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
    assert.deepEqual(result.stepper_steps.map(step => [step.key, step.status]), [
      ['draft', 'completed'], ['unassigned', 'completed'], ['under_review', 'completed'],
      ['in_planning', 'completed'], ['safety_check', 'completed'], ['preparation', 'completed'],
      ['confirmed', 'completed']
    ]);
  });

  test('[BOUNDARY] [SG2-100:AC6] confirmed status produces a stepper array of exactly 7 steps, all completed', () => {
    const result = computeEventStage({ event_id: 7, status: 'confirmed' });
    assert.equal(result.stepper_steps.length, 7);
    assert.ok(result.stepper_steps.every(step => step.status === 'completed'));
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] completed status maps to "Completed" terminal stage with all steps completed', () => {
    const input: EventStageInput = {
      event_id: 8,
      status: 'completed',
      organiser_id: 'org-123'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Completed');
    assert.equal(result.stage_key, 'completed');
    assert.equal(result.waiting_on, null);
    assert.deepEqual(result.stepper_steps.map(step => [step.key, step.status]), [
      ['draft', 'completed'], ['unassigned', 'completed'], ['under_review', 'completed'],
      ['in_planning', 'completed'], ['safety_check', 'completed'], ['preparation', 'completed'],
      ['confirmed', 'completed']
    ]);
  });

  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] cancelled status maps to "Cancelled" terminal stage with no pending waiting-on', () => {
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

  test('[NORMAL] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] rejected status maps to "Rejected" terminal stage with no pending waiting-on', () => {
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

  test('[FAILURE] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] an unknown stage keeps a readable label and has no pending actor', () => {
    const input: EventStageInput = {
      event_id: 11,
      status: 'on_hold',
      organiser_id: 'org-123'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'On_hold');
    assert.equal(result.stage_key, 'on_hold');
    assert.equal(result.description, 'Event is currently on_hold.');
    assert.equal(result.waiting_on, null);
    assert.equal(result.stepper_steps[0].status, 'current');
  });

  test('[BOUNDARY] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] a coordinator with no recorded name keeps their responsibility and user id', () => {
    // submitted with coordinator_id but no coordinator_name
    const submittedInput: EventStageInput = {
      event_id: 12,
      status: 'submitted',
      coordinator_id: 'coord-789'
    };
    const submittedResult = computeEventStage(submittedInput);
    assert.deepEqual(submittedResult.waiting_on, {
      persona: 'Event Coordinator',
      action: 'Review and assess event request',
      user_id: 'coord-789'
    });

    // under_review with coordinator_id but no coordinator_name
    const underReviewInput: EventStageInput = {
      event_id: 13,
      status: 'under_review',
      coordinator_id: 'coord-789'
    };
    const underReviewResult = computeEventStage(underReviewInput);
    assert.deepEqual(underReviewResult.waiting_on, {
      persona: 'Event Coordinator',
      action: 'Review and assess event request',
      user_id: 'coord-789'
    });

    // approved with coordinator_id but no coordinator_name
    const approvedInput: EventStageInput = {
      event_id: 14,
      status: 'approved',
      coordinator_id: 'coord-789'
    };
    const approvedResult = computeEventStage(approvedInput);
    assert.deepEqual(approvedResult.waiting_on, {
      persona: 'Event Coordinator',
      action: 'Complete venue suitability check and equipment reservation',
      user_id: 'coord-789'
    });
  });

  test('[BOUNDARY] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] draft state when organiser_id is undefined returns waiting_on with null user_id', () => {
    const input: EventStageInput = {
      event_id: 15,
      status: 'draft'
    };

    const result = computeEventStage(input);

    assert.equal(result.stage, 'Draft');
    assert.deepEqual(result.waiting_on, {
      persona: 'Event Organiser',
      action: 'Complete and submit event request',
      user_id: null
    });
  });

  test('[BOUNDARY] [SG2-38:AC1] [SG2-38:AC2] [SG2-38:AC3] missing stage and coordinator values produce safe display defaults', () => {
    // empty status string
    const emptyStatusResult = computeEventStage({ event_id: 16, status: '' });
    assert.equal(emptyStatusResult.stage, 'Draft');

    // under_review without coordinator_id
    const underReviewNoCoord = computeEventStage({ event_id: 17, status: 'under_review' });
    assert.equal(underReviewNoCoord.waiting_on?.user_id, null);

    // approved without coordinator_id
    const approvedNoCoord = computeEventStage({ event_id: 18, status: 'approved' });
    assert.equal(approvedNoCoord.waiting_on?.user_id, null);
  });
});
