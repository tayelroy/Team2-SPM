import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeArrangementReadiness,
  isSafetyApproved,
  type ArrangementReadinessInput,
  type ArrangementKey,
  type ArrangementState
} from './arrangementReadiness';

/** A base event with every arrangement in place, in Preparation on the
 * Safety Officer's approval; tests override one facet. */
function baseInput(overrides: Partial<ArrangementReadinessInput> = {}): ArrangementReadinessInput {
  return {
    event_id: 101,
    status: 'preparation',
    latest_safety_decision: 'approve',
    registration_needed: true,
    registration_capacity: 120,
    registration_opens_at: '2026-11-01T00:00:00.000Z',
    registration_closes_at: '2026-11-03T00:00:00.000Z',
    venue_requests: [{ status: 'approved', booked: true }],
    equipment_requests: [{ status: 'approved', shortfall: 0, placement_venue_id: 7, reserved: true }],
    ...overrides
  };
}

function stateOf(result: ReturnType<typeof computeArrangementReadiness>, key: ArrangementKey): ArrangementState {
  return result.arrangements.find(a => a.key === key)!.state;
}

describe('computeArrangementReadiness (SG2-57)', () => {
  test('[NORMAL] [SG2-39:AC2] [SG2-57:AC2] affected ready arrangements require rechecking while unaffected registration stays ready', () => {
    const input = baseInput({ arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck', 'equipment_recheck'] });
    const result = computeArrangementReadiness(input);
    assert.deepEqual(result.outstanding, ['venue', 'equipment']);
    assert.deepEqual(result.arrangements.map(item => item.state), ['outstanding', 'outstanding', 'ready', 'ready']);
    assert.match(result.arrangements[0].detail, /approved.*recheck.*planning/i);
    assert.match(result.arrangements[1].detail, /reserved and placed.*recheck.*planning/i);
    assert.equal(result.ready_for_confirmation, false);
    assert.equal(result.venue_requested, true);
    assert.equal(input.venue_requests[0].booked, true);
    assert.equal(input.equipment_requests[0].reserved, true);
  });

  test('[NORMAL] [SG2-93:AC1] [SG2-93:AC3] changes the Safety Officer asked for make only those arrangements outstanding, and say so', () => {
    const result = computeArrangementReadiness(baseInput({ status: 'planning', latest_safety_decision: 'request_changes',
      arrangements_recheck_needed: true, outstanding_arrangements: ['safety_venue_recheck', 'safety_other_recheck', 'venue_recheck'] }));
    assert.deepEqual(result.outstanding, ['venue', 'safety']);
    assert.equal(result.arrangements[0].detail, '1 venue booking approved. The Safety Officer asked for changes.');
    assert.deepEqual(result.arrangements.slice(1, 3).map(item => [item.key, item.state]), [['equipment', 'ready'], ['registration', 'ready']]);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[BOUNDARY] [SG2-93:AC4] a safety change no longer flagged as needing a recheck leaves the arrangement ready', () => {
    const result = computeArrangementReadiness(baseInput({ arrangements_recheck_needed: false,
      outstanding_arrangements: ['safety_equipment_recheck'] }));
    assert.deepEqual([result.outstanding, result.ready_for_confirmation], [[], true]);
  });

  test('[BOUNDARY] [SG2-39:AC2] false, null, absent, empty or unknown recheck metadata preserves ordinary readiness', () => {
    for (const metadata of [
      {}, { arrangements_recheck_needed: false, outstanding_arrangements: ['venue_recheck'] },
      { arrangements_recheck_needed: null, outstanding_arrangements: ['equipment_recheck'] },
      { arrangements_recheck_needed: true, outstanding_arrangements: null },
      { arrangements_recheck_needed: true, outstanding_arrangements: [] },
      { arrangements_recheck_needed: true, outstanding_arrangements: ['unknown_recheck'] },
      { arrangements_recheck_needed: true },
    ]) {
      const result = computeArrangementReadiness(baseInput(metadata));
      assert.deepEqual(result.outstanding, []);
      assert.equal(result.ready_for_confirmation, true);
    }
  });

  test('[CONFLICT] [SG2-39:AC2] duplicate and unknown markers cannot hide known rechecks, including a legacy reservation with no request', () => {
    const result = computeArrangementReadiness(baseInput({ equipment_requests: [], registration_needed: false,
      arrangements_recheck_needed: true, outstanding_arrangements: ['registration_recheck', 'unknown', 'equipment_recheck', 'venue_recheck', 'venue_recheck'] }));
    assert.deepEqual(result.outstanding, ['venue', 'equipment', 'registration']);
    assert.equal(result.ready_for_confirmation, false);
    assert.deepEqual(result.arrangements.map(item => item.state), ['outstanding', 'outstanding', 'outstanding', 'ready']);
  });

  test('[CONFLICT] [SG2-39:AC2] [SG2-81:AC2] venue disruptions and planning impacts remain outstanding together without hiding either explanation', () => {
    const result = computeArrangementReadiness(baseInput({ affected_bookings: 1,
      arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck', 'equipment_recheck'] }));
    assert.deepEqual(result.outstanding, ['venue', 'equipment']);
    assert.match(result.arrangements[0].detail, /affected by venue unavailability/);
    assert.match(result.arrangements[0].detail, /recheck.*planning/i);
    assert.equal(stateOf(result, 'registration'), 'ready');
    assert.equal(result.ready_for_confirmation, false);
  });

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
      baseInput({ venue_requests: [{ status: 'approved', booked: true }, { status: 'approved', booked: true }, { status: 'approved', booked: true }] })
    );

    assert.equal(stateOf(result, 'venue'), 'ready');
    assert.match(result.arrangements.find(a => a.key === 'venue')!.detail, /3 venue bookings approved/);
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[FAILURE] [SG2-57:AC1] a pending venue booking leaves the venue outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'approved', booked: true }, { status: 'pending', booked: false }] })
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

  test('[BOUNDARY] [SG2-39:AC2] a venue counts as requested only while a pending or approved request is live', () => {
    for (const [requests, requested] of [
      [[], false],
      [[{ status: 'rejected', booked: false }, { status: 'cancelled', booked: false }], false],
      [[{ status: 'cancelled', booked: false }, { status: 'pending', booked: false }], true],
      [[{ status: 'approved', booked: true }], true],
      // A released booking leaves the request approved; it still counts as requested.
      [[{ status: 'approved', booked: false }], true]
    ] as const) {
      assert.equal(computeArrangementReadiness(baseInput({ venue_requests: [...requests] })).venue_requested, requested);
    }
  });

  test('[CONFLICT] [SG2-57:AC2] [SG2-82:AC5] a rejected venue request holds the venue back beside an approved one until it is withdrawn', () => {
    const rejected = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'rejected', booked: false }, { status: 'approved', booked: true }] })
    );
    assert.equal(stateOf(rejected, 'venue'), 'outstanding');
    assert.equal(rejected.arrangements.find(a => a.key === 'venue')!.detail,
      '1 venue booking rejected: request a replacement if the event still needs one, then withdraw the rejected request.');
    assert.deepEqual(rejected.outstanding, ['venue']);
    assert.equal(rejected.ready_for_confirmation, false);

    // Withdrawing it cancels the request, and the approved venue alone is ready.
    const withdrawn = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'cancelled', booked: false }, { status: 'approved', booked: true }] })
    );
    assert.equal(stateOf(withdrawn, 'venue'), 'ready');
    assert.equal(withdrawn.ready_for_confirmation, true);
  });

  test('[BOUNDARY] [SG2-82:AC5] rejected venue requests are counted, an event with only a rejected one is outstanding, and pending ones are reported first', () => {
    const several = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'Rejected', booked: false }, { status: 'rejected', booked: false }, { status: 'approved', booked: true }] })
    );
    assert.equal(several.arrangements.find(a => a.key === 'venue')!.detail,
      '2 venue bookings rejected: request replacements if the event still needs them, then withdraw the rejected requests.');

    const onlyRejected = computeArrangementReadiness(baseInput({ venue_requests: [{ status: 'rejected', booked: false }] }));
    assert.equal(stateOf(onlyRejected, 'venue'), 'outstanding');
    assert.match(onlyRejected.arrangements.find(a => a.key === 'venue')!.detail, /^1 venue booking rejected/);
    // A rejected request is not a venue being requested, for SG2-39's next step.
    assert.equal(onlyRejected.venue_requested, false);

    const pendingFirst = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'rejected', booked: false }, { status: 'pending', booked: false }] })
    );
    assert.match(pendingFirst.arrangements.find(a => a.key === 'venue')!.detail, /awaiting approval/);
  });

  test('[CONFLICT] [SG2-58:AC2] an approved venue request whose booking was released leaves the venue outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'approved', booked: true }, { status: 'approved', booked: false }] })
    );

    assert.equal(stateOf(result, 'venue'), 'outstanding');
    assert.equal(
      result.arrangements.find(a => a.key === 'venue')!.detail,
      '1 approved venue request no longer has a confirmed booking.'
    );
    assert.deepEqual(result.outstanding, ['venue']);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[BOUNDARY] [SG2-58:AC2] several unbooked approved requests are counted, and a pending request is reported first', () => {
    const unbooked = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'approved', booked: false }, { status: 'APPROVED', booked: false }] })
    );
    assert.equal(
      unbooked.arrangements.find(a => a.key === 'venue')!.detail,
      '2 approved venue requests no longer have a confirmed booking.'
    );

    const pendingFirst = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'approved', booked: false }, { status: 'pending', booked: false }] })
    );
    assert.equal(stateOf(pendingFirst, 'venue'), 'outstanding');
    assert.match(pendingFirst.arrangements.find(a => a.key === 'venue')!.detail, /awaiting approval/);
  });

  test('[BOUNDARY] [SG2-58:AC2] [SG2-82:AC5] an unbooked request that was cancelled (withdrawn or released) does not hold the venue back', () => {
    const result = computeArrangementReadiness(
      baseInput({ venue_requests: [{ status: 'cancelled', booked: false }, { status: 'approved', booked: true }] })
    );

    assert.equal(stateOf(result, 'venue'), 'ready');
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[FAILURE] [SG2-57:AC1] [SG2-58:AC2] equipment with a remaining shortfall is outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ equipment_requests: [{ status: 'approved', shortfall: 2, placement_venue_id: 7, reserved: true }] })
    );

    assert.equal(stateOf(result, 'equipment'), 'outstanding');
    assert.deepEqual(result.outstanding, ['equipment']);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[FAILURE] [SG2-57:AC1] equipment not yet arranged (no placement) is outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ equipment_requests: [{ status: 'pending', shortfall: null, placement_venue_id: null, reserved: false }] })
    );

    assert.equal(stateOf(result, 'equipment'), 'outstanding');
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[FAILURE] [SG2-57:AC1] [SG2-58:AC2] equipment placed with no shortfall but never reserved is outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ equipment_requests: [{ status: 'pending', shortfall: 0, placement_venue_id: 7, reserved: false }] })
    );

    assert.deepEqual(result.arrangements.find(a => a.key === 'equipment'), {
      key: 'equipment',
      label: 'Equipment',
      state: 'outstanding',
      detail: '1 equipment request not yet reserved and placed with no shortfall.'
    });
    assert.deepEqual(result.outstanding, ['equipment']);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[FAILURE] [SG2-57:AC1] [SG2-58:AC2] equipment reserved but not yet placed is outstanding', () => {
    const result = computeArrangementReadiness(
      baseInput({ equipment_requests: [{ status: 'approved', shortfall: 0, placement_venue_id: null, reserved: true }] })
    );

    assert.equal(stateOf(result, 'equipment'), 'outstanding');
    assert.deepEqual(result.outstanding, ['equipment']);
  });

  test('[BOUNDARY] [SG2-57:AC1] [SG2-58:AC1] reserved and placed requests read ready while an unreserved rejected one is ignored', () => {
    const result = computeArrangementReadiness(
      baseInput({
        equipment_requests: [
          { status: 'approved', shortfall: 0, placement_venue_id: 7, reserved: true },
          { status: 'APPROVED', shortfall: 0, placement_venue_id: 8, reserved: true },
          { status: 'Rejected', shortfall: null, placement_venue_id: null, reserved: false }
        ]
      })
    );

    assert.deepEqual(result.arrangements.find(a => a.key === 'equipment'), {
      key: 'equipment',
      label: 'Equipment',
      state: 'ready',
      detail: '2 equipment requests reserved and placed.'
    });
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[NORMAL] [SG2-94:AC6] registration needed with a time unset does not hold confirmation up, and names the gap for the organiser', () => {
    const result = computeArrangementReadiness(
      baseInput({ registration_closes_at: null })
    );

    assert.equal(stateOf(result, 'registration'), 'ready');
    assert.match(result.arrangements.find(a => a.key === 'registration')!.detail, /closing time not set yet\. The Event Organiser sets them/);
    assert.deepEqual(result.outstanding, []);
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[BOUNDARY] [SG2-94:AC6] registration with capacity and both times unset is still ready and names each gap', () => {
    const result = computeArrangementReadiness(
      baseInput({ registration_capacity: null, registration_opens_at: null, registration_closes_at: null })
    );

    assert.equal(stateOf(result, 'registration'), 'ready');
    assert.match(result.arrangements.find(a => a.key === 'registration')!.detail, /^Registration capacity, opening time, closing time not set yet\./);
    assert.equal(result.ready_for_confirmation, true);
  });

  test('[CONFLICT] [SG2-94:AC6] [SG2-66:AC4] a registration recheck still holds confirmation up when the settings are unset', () => {
    const result = computeArrangementReadiness(baseInput({ registration_capacity: null,
      arrangements_recheck_needed: true, outstanding_arrangements: ['registration_recheck'] }));
    assert.deepEqual(result.outstanding, ['registration']);
    assert.match(result.arrangements.find(a => a.key === 'registration')!.detail, /not set yet.*Recheck required after planning changes/);
  });

  test('[NORMAL] [SG2-57:AC2] [SG2-94:AC4] [SG2-100:AC3] every outstanding item is listed in order, the safety check last', () => {
    const result = computeArrangementReadiness(
      baseInput({
        status: 'planning',
        latest_safety_decision: null,
        venue_requests: [{ status: 'pending', booked: false }],
        equipment_requests: [{ status: 'pending', shortfall: null, placement_venue_id: null, reserved: false }],
        arrangements_recheck_needed: true,
        outstanding_arrangements: ['registration_recheck']
      })
    );

    assert.deepEqual(result.outstanding, ['venue', 'equipment', 'registration', 'safety']);
    assert.deepEqual(result.arrangements.map(item => item.label), ['Venue booking', 'Equipment', 'Registration', 'Safety check']);
    assert.equal(result.ready_for_confirmation, false);
  });

  test('[NORMAL] [SG2-81:AC2] a booking a venue\'s unavailability affects leaves the venue arrangement outstanding, and says alternatives are required', () => {
    const result = computeArrangementReadiness(baseInput({ affected_bookings: 2 }));

    assert.equal(stateOf(result, 'venue'), 'outstanding');
    assert.equal(result.arrangements.find(a => a.key === 'venue')!.detail,
      '2 venue bookings affected by venue unavailability: alternative venue arrangements are required.');
    assert.deepEqual(result.outstanding, ['venue']);
    assert.equal(result.ready_for_confirmation, false);
    assert.match(computeArrangementReadiness(baseInput({ affected_bookings: 1 })).arrangements[0].detail, /^1 venue booking affected/);
  });

  test('[BOUNDARY] [SG2-81:AC5] with none affected, or the count absent, the venue arrangement is ready again', () => {
    for (const affected_bookings of [0, undefined]) {
      const result = computeArrangementReadiness(baseInput({ affected_bookings }));
      assert.equal(stateOf(result, 'venue'), 'ready', String(affected_bookings));
      assert.equal(result.ready_for_confirmation, true);
    }
  });

  test('[CONFLICT] [SG2-81:AC2] a pending or rejected request is still reported first; an affected booking is reported before an unbooked approval', () => {
    const detail = (input: Partial<ArrangementReadinessInput>) =>
      computeArrangementReadiness(baseInput({ affected_bookings: 1, ...input })).arrangements[0].detail;
    assert.match(detail({ venue_requests: [{ status: 'approved', booked: true }, { status: 'pending', booked: false }] }), /awaiting approval/);
    assert.match(detail({ venue_requests: [{ status: 'approved', booked: true }, { status: 'rejected', booked: false }] }), /rejected/);
    assert.match(detail({ venue_requests: [{ status: 'approved', booked: false }] }), /affected by venue unavailability/);
  });
});

describe('the safety check as an outstanding item (SG2-94)', () => {
  const safety = (input: Partial<ArrangementReadinessInput>) => {
    const result = computeArrangementReadiness(baseInput(input));
    return { result, item: result.arrangements.find(a => a.key === 'safety')! };
  };

  test('[NORMAL] [SG2-94:AC2] [SG2-94:AC4] an event in Preparation or Confirmed whose latest decision is Approve has the safety check ready', () => {
    for (const status of ['preparation', 'confirmed']) {
      const { result, item } = safety({ status });
      assert.deepEqual(item, { key: 'safety', label: 'Safety check', state: 'ready', detail: 'Approved by the Safety Officer.' });
      assert.equal(result.ready_for_confirmation, true, status);
    }
  });

  test('[FAILURE] [SG2-94:AC5] without a current approval the safety check is outstanding with the reason, even with everything else in place', () => {
    for (const [status, latest, reason] of [
      ['awaiting_safety_check', null, /^Awaiting the Safety Officer's operational safety check\.$/],
      ['safety_rejected', 'reject', /rejected the safety check\. Rework the arrangements/],
      ['planning', 'request_changes', /requested changes\. The event goes back to the safety check once they are confirmed again/],
      ['planning', null, /^Not approved yet\. The event goes to the Safety Officer once its venue and equipment are in place\.$/],
      ['preparation', null, /^Not approved yet\./],
      ['preparation', 'request_changes', /requested changes/],
    ] as const) {
      const { result, item } = safety({ status, latest_safety_decision: latest });
      assert.equal(item.state, 'outstanding', `${status}/${latest}`);
      assert.match(item.detail, reason);
      assert.deepEqual(result.outstanding, ['safety']);
      assert.equal(result.ready_for_confirmation, false);
    }
  });

  test('[CONFLICT] [SG2-94:AC3] an Approve that is still the latest decision no longer counts once the event is back in Planning', () => {
    for (const status of ['planning', 'approved']) {
      const { result, item } = safety({ status, latest_safety_decision: 'approve' });
      assert.equal(item.state, 'outstanding');
      assert.match(item.detail, /^The approval was withdrawn after the event changed\. It must pass the safety check again/);
      assert.equal(result.ready_for_confirmation, false);
    }
  });

  test('[BOUNDARY] [SG2-94:AC2] Approve on an event waiting for its next check is not yet an approval of that check', () => {
    const { item } = safety({ status: 'awaiting_safety_check', latest_safety_decision: 'approve' });
    assert.equal(item.state, 'outstanding');
    assert.equal(isSafetyApproved('awaiting_safety_check', 'approve'), false);
    assert.equal(isSafetyApproved('confirmed', 'approve'), true);
    assert.equal(isSafetyApproved('confirmed', 'reject'), false);
  });
});
