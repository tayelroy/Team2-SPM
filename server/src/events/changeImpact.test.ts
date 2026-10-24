import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGEABLE_FIELDS,
  CHANGEABLE_STATUSES,
  CHANGE_FIELD_LABELS,
  RECHECK_KEYS,
  REGISTRATION_SETTINGS,
  RETURNS_TO_PLANNING,
  SIGNIFICANT_CHANGE_FIELDS,
  assessChangeImpact,
  formatInstant,
  isChangeableStatus,
  isRecheckKey,
  isSignificantField,
  recheckBlockers,
  type ChangeImpact,
  type ChangeImpactEventFacts,
  type ChangeImpactFacts,
  type ChangeRequestChange,
  type EquipmentArrangementFact,
  type VenueArrangementFact
} from './changeImpact';

const START = '2030-06-20T02:00:00.000Z';
const END = '2030-06-20T06:00:00.000Z';

const booking: VenueArrangementFact = {
  kind: 'venue_booking', id: 5, venue_name: 'The Kelp Room', capacity: 150,
  starts_at: START, ends_at: END, exception_attendance: null
};
const venueRequest: VenueArrangementFact = {
  kind: 'venue_request', id: 9, venue_name: 'Harbour Hall', capacity: null,
  starts_at: START, ends_at: END, exception_attendance: null
};
const reservation: EquipmentArrangementFact = {
  kind: 'equipment_reservation', id: 3, equipment_name: 'Wireless microphones', quantity: 12, starts_at: START, ends_at: END
};
const equipmentRequest: EquipmentArrangementFact = {
  kind: 'equipment_request', id: 4, equipment_name: 'Projectors', quantity: 2, starts_at: null, ends_at: null
};
const event: ChangeImpactEventFacts = {
  proposed_date: START, expected_attendance: 120, registration_needed: true,
  registration_capacity: 150, registration_closes_at: '2030-06-19T16:00:00.000Z'
};
const facts: ChangeImpactFacts = { venues: [booking, venueRequest], equipment: [reservation, equipmentRequest], registrations: 42 };

const attendance = (from: number | null, to: number | null): ChangeRequestChange =>
  ({ field: 'expected_attendance', label: 'Expected attendance', from, to });
const date = (to: string | null): ChangeRequestChange => ({ field: 'proposed_date', label: 'Event date and time', from: START, to });
const description: ChangeRequestChange = { field: 'description', label: 'Description', from: 'Old', to: 'New' };

const codes = (impact: ChangeImpact) =>
  impact.arrangements.map(item => [item.kind, item.id, item.reasons.map(reason => reason.code)]);

describe('shared SG2-66 vocabulary', () => {
  test('[NORMAL] [SG2-66:AC1] [SG2-66:AC4] statuses, significant fields, recheck keys and registration settings are fixed', () => {
    assert.deepEqual([...CHANGEABLE_STATUSES], ['approved', 'planning', 'awaiting_safety_check', 'preparation', 'confirmed']);
    assert.deepEqual([...RETURNS_TO_PLANNING], ['awaiting_safety_check', 'preparation', 'confirmed']);
    assert.deepEqual([...SIGNIFICANT_CHANGE_FIELDS],
      ['proposed_date', 'expected_attendance', 'venue_requirements', 'accessibility_needs', 'equipment_requirements']);
    assert.deepEqual([...CHANGEABLE_FIELDS], [...SIGNIFICANT_CHANGE_FIELDS, 'name', 'purpose', 'description']);
    assert.deepEqual([...RECHECK_KEYS], ['venue_recheck', 'equipment_recheck', 'registration_recheck',
      'safety_venue_recheck', 'safety_equipment_recheck', 'safety_other_recheck']);
    assert.deepEqual([...REGISTRATION_SETTINGS],
      ['registration_needed', 'registration_capacity', 'registration_opens_at', 'registration_closes_at']);
    assert.deepEqual(Object.keys(CHANGE_FIELD_LABELS), [...CHANGEABLE_FIELDS]);
  });

  test('[BOUNDARY] [SG2-66:AC4] guards accept exactly the listed values', () => {
    assert.equal(isChangeableStatus('confirmed'), true);
    assert.equal(isChangeableStatus('completed'), false);
    assert.equal(isRecheckKey('venue_recheck'), true);
    assert.equal(isRecheckKey('venue'), false);
    assert.equal(isSignificantField('accessibility_needs'), true);
    assert.equal(isSignificantField('name'), false);
    assert.equal(formatInstant('2030-06-20T10:05:00+08:00'), '20 Jun 2030 10:05 SGT');
    // Crossing midnight and the year in Singapore time.
    assert.equal(formatInstant('2030-12-31T16:30:00Z'), '01 Jan 2031 00:30 SGT');
  });
});

describe('assessChangeImpact (SG2-66 AC1-AC3)', () => {
  test('[NORMAL] [SG2-66:AC1] a significant change lists every arrangement for revalidation, in kind order with recheck keys', () => {
    const impact = assessChangeImpact(event, [{ field: 'venue_requirements', label: 'Venue requirements', from: 'A', to: 'B' }], facts);
    assert.equal(impact.requires_revalidation, true);
    assert.deepEqual(impact.outstanding_arrangements, ['venue_recheck', 'equipment_recheck', 'registration_recheck']);
    assert.deepEqual(codes(impact), [
      ['venue_booking', 5, ['revalidate']], ['venue_request', 9, ['revalidate']],
      ['equipment_reservation', 3, ['revalidate']], ['equipment_request', 4, ['revalidate']],
      ['registrations', null, ['revalidate']]
    ]);
    assert.deepEqual(impact.arrangements[0], {
      kind: 'venue_booking', id: 5, label: 'The Kelp Room', starts_at: START, ends_at: END,
      reasons: [{ code: 'revalidate', message: 'This venue booking must be revalidated against the changed event details.' }]
    });
    assert.equal(impact.arrangements[2].label, 'Wireless microphones × 12');
    assert.deepEqual(impact.arrangements[4], {
      kind: 'registrations', id: null, label: 'Registrations (42 received)',
      reasons: [{ code: 'revalidate', message: 'The registrations must be revalidated against the changed event details.' }]
    });
    assert.equal('starts_at' in impact.arrangements[4], false);
  });

  test('[NORMAL] [SG2-66:AC1] a name, purpose or description change needs no revalidation', () => {
    assert.deepEqual(assessChangeImpact(event, [description, { field: 'name', label: 'Event name', from: 'A', to: 'B' }], facts),
      { requires_revalidation: false, outstanding_arrangements: [], arrangements: [] });
  });

  test('[BOUNDARY] [SG2-66:AC1] only the kinds the event has are listed; registrations count only when needed or received', () => {
    const none = assessChangeImpact({ ...event, registration_needed: false }, [description, attendance(1, 2)],
      { venues: [], equipment: [], registrations: 0 });
    assert.deepEqual(none, { requires_revalidation: true, outstanding_arrangements: [], arrangements: [] });
    const received = assessChangeImpact({ ...event, registration_needed: null }, [attendance(1, 2)],
      { venues: [], equipment: [reservation], registrations: 1 });
    assert.deepEqual(received.outstanding_arrangements, ['equipment_recheck', 'registration_recheck']);
    const venueOnly = assessChangeImpact({ ...event, registration_needed: false }, [attendance(1, 2)],
      { venues: [booking], equipment: [], registrations: 0 });
    assert.deepEqual(venueOnly.outstanding_arrangements, ['venue_recheck']);
  });

  test('[NORMAL] [SG2-66:AC2] attendance above a venue capacity adds a capacity check only Venue Staff can clear', () => {
    const impact = assessChangeImpact(event, [attendance(120, 180)], facts);
    assert.deepEqual(codes(impact).slice(0, 2), [
      ['venue_booking', 5, ['revalidate', 'capacity_check']], ['venue_request', 9, ['revalidate', 'capacity_check']]
    ]);
    assert.deepEqual(impact.arrangements[0].reasons[1], { code: 'capacity_check', message:
      "The revised attendance of 180 is above The Kelp Room's capacity of 150. A new capacity check is needed: "
      + 'only Venue Staff can approve a capacity exception for the revised attendance.' });
    assert.equal(impact.arrangements[1].reasons[1].message,
      'Harbour Hall has no recorded capacity, so it cannot be shown to fit the revised attendance of 180. '
      + 'A new capacity check is needed: only Venue Staff can approve a capacity exception for the revised attendance.');
    // Equipment and registrations are never capacity checked.
    assert.deepEqual(codes(impact).slice(2).map(([, , reasons]) => reasons), [['revalidate'], ['revalidate'], ['revalidate']]);
  });

  test('[BOUNDARY] [SG2-66:AC2] attendance equal to capacity, or covered by a Venue Staff exception, needs no capacity check', () => {
    const equal = assessChangeImpact(event, [attendance(120, 150)], { ...facts, venues: [booking] });
    assert.deepEqual(codes(equal)[0], ['venue_booking', 5, ['revalidate']]);
    const covered = assessChangeImpact(event, [attendance(120, 180)],
      { ...facts, venues: [{ ...booking, exception_attendance: 180 }, { ...venueRequest, exception_attendance: 200 }] });
    assert.deepEqual(codes(covered).slice(0, 2).map(([, , reasons]) => reasons), [['revalidate'], ['revalidate']]);
    const short = assessChangeImpact(event, [attendance(120, 181)], { ...facts, venues: [{ ...booking, exception_attendance: 180 }] });
    assert.deepEqual(codes(short)[0], ['venue_booking', 5, ['revalidate', 'capacity_check']]);
    const cleared = assessChangeImpact(event, [attendance(120, null)], { ...facts, venues: [venueRequest] });
    assert.deepEqual(codes(cleared)[0], ['venue_request', 9, ['revalidate']]);
  });

  test('[NORMAL] [SG2-66:AC3] a new date flags every venue and equipment item for a period recheck', () => {
    const impact = assessChangeImpact(event, [date('2030-06-27T02:00:00.000Z')], facts);
    assert.deepEqual(codes(impact), [
      ['venue_booking', 5, ['revalidate', 'period_recheck']], ['venue_request', 9, ['revalidate', 'period_recheck']],
      ['equipment_reservation', 3, ['revalidate', 'period_recheck']], ['equipment_request', 4, ['revalidate', 'period_recheck']],
      ['registrations', null, ['revalidate']]
    ]);
    const messages = impact.arrangements.slice(0, 4).map(item => item.reasons[1].message);
    assert.deepEqual(messages, [
      'Booked from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT; recheck it against the new start of 27 Jun 2030 10:00 SGT.',
      'Requested from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT; recheck it against the new start of 27 Jun 2030 10:00 SGT.',
      'Reserved from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT; recheck it against the new start of 27 Jun 2030 10:00 SGT.',
      'No period is recorded for it; recheck it against the new start of 27 Jun 2030 10:00 SGT.'
    ]);
  });

  test('[BOUNDARY] [SG2-66:AC3] a cleared date still asks for a period recheck, and both changes together add both reasons', () => {
    const cleared = assessChangeImpact(event, [date(null)], { ...facts, equipment: [] });
    assert.equal(cleared.arrangements[0].reasons[1].message,
      'Booked from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT; recheck it against the event, which no longer has a date.');
    const both = assessChangeImpact(event, [attendance(120, 400), date('2030-06-27T02:00:00.000Z')], { ...facts, venues: [booking] });
    assert.deepEqual(codes(both)[0], ['venue_booking', 5, ['revalidate', 'capacity_check', 'period_recheck']]);
  });
});

describe('recheckBlockers (SG2-66 AC4)', () => {
  test('[NORMAL] [SG2-66:AC4] venues that cover the start and fit the attendance can be settled', () => {
    assert.deepEqual(recheckBlockers('venue_recheck', event, { ...facts, venues: [booking] }), []);
    assert.deepEqual(recheckBlockers('venue_recheck', { ...event, expected_attendance: null }, { ...facts, venues: [venueRequest] }), []);
    assert.deepEqual(recheckBlockers('venue_recheck', { ...event, expected_attendance: 300 },
      { ...facts, venues: [{ ...venueRequest, exception_attendance: 300 }] }), []);
  });

  test('[BOUNDARY] [SG2-66:AC4] the start may equal a booking start but not its end; capacity may equal attendance', () => {
    assert.deepEqual(recheckBlockers('venue_recheck', { ...event, expected_attendance: 150 }, { ...facts, venues: [booking] }), []);
    assert.deepEqual(recheckBlockers('venue_recheck', { ...event, proposed_date: END }, { ...facts, venues: [booking] }), [
      'The Kelp Room: Booked from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT, which does not cover the event start of 20 Jun 2030 14:00 SGT.'
    ]);
    assert.deepEqual(recheckBlockers('venue_recheck', { ...event, expected_attendance: 151 }, { ...facts, venues: [booking] }), [
      "The revised attendance of 151 is above The Kelp Room's capacity of 150. A new capacity check is needed: "
      + 'only Venue Staff can approve a capacity exception for the revised attendance.'
    ]);
  });

  test('[FAILURE] [SG2-66:AC4] an undated event, a missing period or a venue without capacity blocks the venue recheck', () => {
    assert.deepEqual(recheckBlockers('venue_recheck', { ...event, proposed_date: null, expected_attendance: null },
      { ...facts, venues: [booking] }), ['The Kelp Room cannot be checked against the event, which has no date.']);
    assert.deepEqual(recheckBlockers('venue_recheck', { ...event, expected_attendance: null },
      { ...facts, venues: [{ ...booking, ends_at: null }, { ...booking, venue_name: 'Annex', starts_at: null }] }), [
      'The Kelp Room: No period is recorded for it, which does not cover the event start of 20 Jun 2030 10:00 SGT.',
      'Annex: No period is recorded for it, which does not cover the event start of 20 Jun 2030 10:00 SGT.'
    ]);
    assert.equal(recheckBlockers('venue_recheck', event, { ...facts, venues: [venueRequest] }).length, 1);
  });

  test('[NORMAL] [SG2-66:AC4] equipment must cover the start; undated reservations are skipped, undated requests block', () => {
    assert.deepEqual(recheckBlockers('equipment_recheck', event, { ...facts, equipment: [reservation] }), []);
    assert.deepEqual(recheckBlockers('equipment_recheck', event,
      { ...facts, equipment: [{ ...reservation, starts_at: null, ends_at: null }, equipmentRequest] }), [
      'Projectors × 2: No period is recorded for it, which does not cover the event start of 20 Jun 2030 10:00 SGT.'
    ]);
    assert.deepEqual(recheckBlockers('equipment_recheck', { ...event, proposed_date: '2030-06-27T02:00:00.000Z' },
      { ...facts, equipment: [reservation] }), [
      'Wireless microphones × 12: Reserved from 20 Jun 2030 10:00 SGT to 20 Jun 2030 14:00 SGT, which does not cover the event start of 27 Jun 2030 10:00 SGT.'
    ]);
    assert.deepEqual(recheckBlockers('equipment_recheck', { ...event, proposed_date: null }, { ...facts, equipment: [reservation] }),
      ['Wireless microphones × 12 cannot be checked against the event, which has no date.']);
  });

  test('[NORMAL] [SG2-66:AC4] registration closes before the start and holds no more than its capacity', () => {
    assert.deepEqual(recheckBlockers('registration_recheck', event, facts), []);
    assert.deepEqual(recheckBlockers('registration_recheck', { ...event, registration_needed: false, registration_closes_at: null }, facts), []);
    assert.deepEqual(recheckBlockers('registration_recheck', { ...event, registration_capacity: 42 }, facts), []);
    assert.deepEqual(recheckBlockers('registration_recheck',
      { proposed_date: START, expected_attendance: null, registration_needed: true, registration_closes_at: '2030-06-01T00:00:00.000Z' }, facts), []);
  });

  test('[BOUNDARY] [SG2-66:AC4] closing at the start or one registration over capacity blocks', () => {
    assert.deepEqual(recheckBlockers('registration_recheck', { ...event, registration_closes_at: START, registration_capacity: 41 }, facts), [
      'Registration closes at 20 Jun 2030 10:00 SGT, which is not before the event start of 20 Jun 2030 10:00 SGT.',
      '42 registrations have been received, above the registration capacity of 41.'
    ]);
  });

  test('[FAILURE] [SG2-66:AC4] no closing time or no event date blocks the registration recheck', () => {
    assert.deepEqual(recheckBlockers('registration_recheck', { ...event, registration_closes_at: undefined }, facts),
      ['Registration has no closing time.']);
    assert.deepEqual(recheckBlockers('registration_recheck', { ...event, proposed_date: null }, facts),
      ['Registration cannot be checked against the event, which has no date.']);
  });

  test('[BOUNDARY] [SG2-93:AC4] a change the Safety Officer asked for has no SG2-66 blockers, even where the venue, equipment or registration would', () => {
    const failing = { ...event, proposed_date: null, registration_closes_at: undefined };
    for (const key of ['safety_venue_recheck', 'safety_equipment_recheck', 'safety_other_recheck'] as const) {
      assert.deepEqual(recheckBlockers(key, failing, { ...facts, venues: [booking] }), [], key);
    }
  });
});
