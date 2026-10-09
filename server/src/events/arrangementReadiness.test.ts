import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeArrangementReadiness,
  type ArrangementReadinessInput,
  type ArrangementKey,
  type ArrangementState
} from './arrangementReadiness';

/** A base event with every arrangement in place; tests override one facet. */
function baseInput(overrides: Partial<ArrangementReadinessInput> = {}): ArrangementReadinessInput {
  return {
    event_id: 101,
    registration_needed: true,
    registration_capacity: 120,
    registration_opens_at: '2026-11-01T00:00:00.000Z',
    registration_closes_at: '2026-11-03T00:00:00.000Z',
    venue_requests: [{ status: 'approved' }],
    equipment_requests: [{ status: 'pending', shortfall: 0, placement_venue_id: 7 }],
    ...overrides
  };
}

function stateOf(result: ReturnType<typeof computeArrangementReadiness>, key: ArrangementKey): ArrangementState {
  return result.arrangements.find(a => a.key === key)!.state;
}

describe('computeArrangementReadiness (SG2-57)', () => {
  test('[NORMAL] [SG2-57:AC1] [SG2-57:AC3] all required arrangements ready marks the event ready for confirmation', () => {
    const result = computeArrangementReadiness(baseInput());

    assert.equal(stateOf(result, 'venue'), 'ready');
    assert.equal(stateOf(result, 'equipment'), 'ready');
    assert.equal(stateOf(result, 'registration'), 'ready');
    assert.deepEqual(result.outstanding, []);
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[NORMAL] [SG2-57:AC2] equipment and registration are not required when none is needed', () => {
    const result = computeArrangementReadiness(
      baseInput({ equipment_requests: [], registration_needed: false, registration_capacity: null })
    );

    assert.equal(stateOf(result, 'equipment'), 'not_required');
    assert.equal(stateOf(result, 'registration'), 'not_required');
    // Not-required arrangements do not block confirmation.
    assert.equal(result.ready_for_confirmation, true);
    assert.deepEqual(result.outstanding, []);
  });

  test('[NORMAL] [SG2-57:AC1] [SG2-57:AC3] several venue bookings all approved count as ready', () => {
    const result = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'approved' }, { status: 'approved' }, { status: 'approved' }] })
    );

    assert.equal(stateOf(result, 'venue'), 'ready');
    assert.match(result.arrangements.find(a => a.key === 'venue')!.detail, /3 venue bookings approved/);
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[FAILURE] [SG2-57:AC1] a pending venue booking leaves the venue outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'approved' }, { status: 'pending' }] })
    );

    assert.equal(stateOf(result, 'venue'), 'outstanding');
    assert.deepEqual(result.outstanding, ['venue']);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[BOUNDARY] [SG2-57:AC1] an event with no venue booking requested is outstanding, not "not required"', () => {
    const result = computeArrangementReadiness(baseInput({ venue_requests: [] }));

    assert.equal(stateOf(result, 'venue'), 'outstanding');
    assert.match(result.arrangements.find(a => a.key === 'venue')!.detail, /No venue booking/i);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[BOUNDARY] [SG2-57:AC2] a rejected venue request is ignored, so an approved one still reads ready', () => {
    const result = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'rejected' }, { status: 'approved' }] })
    );

    assert.equal(stateOf(result, 'venue'), 'ready');
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[FAILURE] [SG2-57:AC1] equipment with a remaining shortfall is outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ equipment_requests: [{ status: 'pending', shortfall: 2, placement_venue_id: 7 }] })
    );

    assert.equal(stateOf(result, 'equipment'), 'outstanding');
    assert.deepEqual(result.outstanding, ['equipment']);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[FAILURE] [SG2-57:AC1] equipment not yet arranged (no placement) is outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ equipment_requests: [{ status: 'pending', shortfall: null, placement_venue_id: null }] })
    );

    assert.equal(stateOf(result, 'equipment'), 'outstanding');
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[FAILURE] [SG2-57:AC1] registration needed but a time is unset is outstanding and names the gap', () => {
    const result = computeArrangementReadiness(
      baseInput({ registration_closes_at: null })
    );

    assert.equal(stateOf(result, 'registration'), 'outstanding');
    assert.match(result.arrangements.find(a => a.key === 'registration')!.detail, /closing time/);
    assert.deepEqual(result.outstanding, ['registration']);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[BOUNDARY] [SG2-57:AC1] registration missing both capacity and opening time names each gap', () => {
    const result = computeArrangementReadiness(
      baseInput({ registration_capacity: null, registration_opens_at: null })
    );

    assert.equal(stateOf(result, 'registration'), 'outstanding');
    const detail = result.arrangements.find(a => a.key === 'registration')!.detail;
    assert.match(detail, /capacity/);
    assert.match(detail, /opening time/);
  });

  test('[NORMAL] [SG2-57:AC2] every outstanding arrangement is listed in order', () => {
    const result = computeArrangementReadiness(
      baseInput({
        venue_requests: [{ status: 'pending' }],
        equipment_requests: [{ status: 'pending', shortfall: null, placement_venue_id: null }],
        registration_capacity: null
      })
    );

    assert.deepEqual(result.outstanding, ['venue', 'equipment', 'registration']);
    assert.equal(result.ready_for_confirmation, false);
  });
});
