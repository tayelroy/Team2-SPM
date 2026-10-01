import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSuitability, bookingReadiness, recognise, FACILITY_KEYWORDS, type SuitabilityEvent, type SuitabilityVenue } from './venues/suitability';

const event = (overrides: Partial<SuitabilityEvent> = {}): SuitabilityEvent =>
  ({ expected_attendance: 80, venue_requirements: null, accessibility_needs: null, ...overrides });
const venue = (overrides: Partial<SuitabilityVenue> = {}): SuitabilityVenue =>
  ({ capacity: 100, facilities: 'Stage, PA, projection', accessibility_features: 'Step-free, hearing loop', ...overrides });

// --- recognise -----------------------------------------------------------------

test('SG2-47: facility keywords are recognised from free text, whatever the wording', () => {
  assert.deepEqual(recognise('Needs a projector, a stage and two mics', FACILITY_KEYWORDS), ['projector', 'microphone', 'stage']);
  assert.deepEqual(recognise('Stage, PA, projection', FACILITY_KEYWORDS), ['projector', 'PA system', 'stage']);
  assert.deepEqual(recognise('Wi-Fi, aircon, video conferencing, catering', FACILITY_KEYWORDS), ['wifi', 'kitchen', 'air-conditioning', 'video conferencing']);
  assert.deepEqual(recognise('A room with seating', FACILITY_KEYWORDS), []);
  assert.deepEqual(recognise(null, FACILITY_KEYWORDS), []);
});

test('SG2-47: "PA" is only recognised in capitals, so ordinary words do not match it', () => {
  assert.deepEqual(recognise('a spa day, pa', FACILITY_KEYWORDS), []);
});

// --- assessSuitability ---------------------------------------------------------

test('SG2-47 AC1: attendance above capacity flags the venue and states the reason', () => {
  const result = assessSuitability(event({ expected_attendance: 150 }), venue());
  assert.equal(result.suitable, false);
  assert.deepEqual(result.issues, [{
    kind: 'capacity', expected_attendance: 150, capacity: 100,
    message: "Expected attendance of 150 is above this venue's capacity of 100."
  }]);
});

test('SG2-47 AC1: attendance equal to capacity fits', () => {
  assert.equal(assessSuitability(event({ expected_attendance: 100 }), venue()).suitable, true);
});

test('SG2-47 AC1: a venue with no recorded capacity is flagged when attendance is known', () => {
  const [issue] = assessSuitability(event({ expected_attendance: 10 }), venue({ capacity: null })).issues;
  assert.deepEqual(issue, {
    kind: 'capacity', expected_attendance: 10, capacity: null,
    message: "Expected attendance is 10, but this venue's capacity is not recorded."
  });
});

test('SG2-47 AC1: without an expected attendance, capacity is not checked', () => {
  assert.deepEqual(assessSuitability(event({ expected_attendance: null }), venue({ capacity: null })).issues, []);
});

test('SG2-47 AC2: each required facility the venue lacks is identified', () => {
  const result = assessSuitability(event({ venue_requirements: 'Stage, projector, whiteboard and kitchen' }), venue());
  assert.deepEqual(result.required_facilities, ['projector', 'stage', 'whiteboard', 'kitchen']);
  assert.deepEqual(result.issues, [{ kind: 'facility', missing: ['whiteboard', 'kitchen'], message: 'Missing required facilities: whiteboard, kitchen.' }]);
  const single = assessSuitability(event({ venue_requirements: 'A bar' }), venue({ facilities: null }));
  assert.equal(single.issues[0].message, 'Missing required facility: bar.');
});

test('SG2-47 AC4: with no accessibility needs, missing accessibility features do not count', () => {
  const result = assessSuitability(event({ accessibility_needs: null }), venue({ accessibility_features: null }));
  assert.equal(result.suitable, true);
  assert.deepEqual(result.required_accessibility, []);
  assert.equal(assessSuitability(event({ accessibility_needs: '   ' }), venue({ accessibility_features: null })).suitable, true);
});

test('SG2-47 AC4: with accessibility needs, every missing feature is identified', () => {
  const result = assessSuitability(event({ accessibility_needs: 'Wheelchair users; step-free entry and a hearing loop' }), venue({ accessibility_features: 'Step-free' }));
  assert.deepEqual(result.required_accessibility, ['step-free', 'wheelchair', 'hearing loop']);
  assert.deepEqual(result.issues, [{ kind: 'accessibility', missing: ['wheelchair', 'hearing loop'], message: 'Missing accessibility features: wheelchair, hearing loop.' }]);
  const single = assessSuitability(event({ accessibility_needs: 'Lift' }), venue({ accessibility_features: null }));
  assert.equal(single.issues[0].message, 'Missing accessibility feature: lift.');
});

test('SG2-47: every problem is reported together, capacity first', () => {
  const result = assessSuitability(
    event({ expected_attendance: 500, venue_requirements: 'Kitchen', accessibility_needs: 'Ramp' }), venue());
  assert.deepEqual(result.issues.map(issue => issue.kind), ['capacity', 'facility', 'accessibility']);
});

// --- bookingReadiness ----------------------------------------------------------

test('SG2-47 AC2: a missing required facility blocks booking, even with a capacity exception', () => {
  const result = assessSuitability(event({ expected_attendance: 150, venue_requirements: 'Kitchen' }), venue());
  assert.equal(bookingReadiness(result, [{ expected_attendance: 150 }]), 'blocked');
});

test('SG2-47 AC3: exceeding capacity needs an approved exception covering the attendance', () => {
  const result = assessSuitability(event({ expected_attendance: 150 }), venue());
  assert.equal(bookingReadiness(result), 'needs_capacity_exception');
  assert.equal(bookingReadiness(result, [{ expected_attendance: 120 }]), 'needs_capacity_exception');
  assert.equal(bookingReadiness(result, [{ expected_attendance: 120 }, { expected_attendance: 150 }]), 'allowed');
});

test('SG2-47: a suitable venue, or one missing only accessibility features, may be decided', () => {
  assert.equal(bookingReadiness(assessSuitability(event(), venue())), 'allowed');
  assert.equal(bookingReadiness(assessSuitability(event({ accessibility_needs: 'Ramp' }), venue())), 'allowed');
});
