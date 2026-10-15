import { expect, test } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import { EMPTY_SEARCH } from './searchApi';
import { accessibilityKeywords, prefillFromEvent } from './searchPrefill';

const event: WorkItem = { kind: 'event', item_id: 10, event_id: 10, title: 'Meridian Capital Q4 Forum', event_name: 'Meridian Capital Q4 Forum',
  status: 'approved', starts_at: '2026-10-11T16:00:00.000Z', ends_at: null, category: 'assigned', assigned_to_me: true,
  details: { expected_attendance: 180, accessibility_needs: '  Step-free access to the main room; a hearing loop in the hall. ', venue_requirements: ' A stage ' } };

test('[NORMAL] [SG2-46:AC1] recognised accessibility features become keywords; unrecognised text yields none', () => {
  expect(accessibilityKeywords('Step free entrance, wheelchair spaces, lifts to every floor, a ramp and an accessible restroom'))
    .toEqual(['step-free', 'wheelchair', 'lift', 'ramp', 'accessible toilet']);
  expect(accessibilityKeywords('hi')).toEqual([]);
});

test('[NORMAL] [SG2-46:AC1] AC1: an approved event pre-fills its whole Singapore day, attendance and accessibility keywords', () => {
  expect(prefillFromEvent(event)).toEqual({
    eventId: 10, eventName: 'Meridian Capital Q4 Forum',
    accessibilityNeeds: 'Step-free access to the main room; a hearing loop in the hall.',
    venueRequirements: 'A stage',
    values: { ...EMPTY_SEARCH, from: '2026-10-12T00:00', until: '2026-10-12T23:59', attendance: '180', facilities: 'stage', accessibility: 'step-free, hearing loop' }
  });
});

test('[BOUNDARY] [SG2-46:AC3] AC3: an event without accessibility needs leaves accessibility unfiltered', () => {
  for (const accessibility_needs of [null, '   ']) {
    const prefill = prefillFromEvent({ ...event, details: { ...event.details, accessibility_needs } });
    expect(prefill.accessibilityNeeds).toBeNull();
    expect(prefill.values.accessibility).toBe('');
  }
});

test('[BOUNDARY] [SG2-46:AC1] missing date or attendance are left for the coordinator to enter', () => {
  const prefill = prefillFromEvent({ ...event, starts_at: null, details: {} });
  expect(prefill.values).toEqual(EMPTY_SEARCH);
  // SG2-48 AC1: a request then carries no venue requirements.
  expect(prefill.venueRequirements).toBeNull();
  for (const venue_requirements of [null, '  ']) {
    const emptyRequirements = prefillFromEvent({ ...event, details: { venue_requirements } });
    expect(emptyRequirements.venueRequirements).toBeNull();
    expect(emptyRequirements.values.facilities).toBe('');
  }
});

test('[NORMAL] [SG2-46:AC1] an event requiring a projector pre-fills the facility filter without losing its requirement text', () => {
  const requirement = 'QA room, 14 seats and projector';
  const prefill = prefillFromEvent({ ...event, details: { ...event.details, venue_requirements: requirement } });
  expect(prefill.values.facilities).toBe('projector');
  expect(prefill.venueRequirements).toBe(requirement);
});

test('[NORMAL] [SG2-46:AC1] multiple recognised facilities survive mixed case and prose separators in event prefill', () => {
  const requirement = '  A STAGE / PROJECTOR; microphones, plus Wi-Fi for guests.  ';
  const prefill = prefillFromEvent({ ...event, details: { ...event.details, venue_requirements: requirement } });
  expect(prefill.values.facilities.split(', ')).toEqual(['projector', 'microphone', 'stage', 'wifi']);
  expect(prefill.venueRequirements).toBe(requirement.trim());
  expect(prefill.values.attendance).toBe('180');
  expect(prefill.values.accessibility).toBe('step-free, hearing loop');
});

test('[BOUNDARY] [SG2-46:AC1] unrecognised venue prose remains visible without inventing facility filters', () => {
  const requirement = 'A quiet room, 14 seats and a welcoming atmosphere';
  const prefill = prefillFromEvent({ ...event, details: { ...event.details, venue_requirements: requirement } });
  expect(prefill.values.facilities).toBe('');
  expect(prefill.venueRequirements).toBe(requirement);
});

test('[BOUNDARY] [SG2-46:AC1] an event can pre-fill all twelve supported facility requirements without truncation', () => {
  const requirement = 'Projector, screen, PA system, microphone, stage, whiteboard, Wi-Fi, kitchen, bar, power outlets, air-conditioning and video conferencing';
  const prefill = prefillFromEvent({ ...event, details: { ...event.details, venue_requirements: requirement } });
  expect(prefill.values.facilities.split(', ')).toEqual([
    'projector', 'screen', 'PA system', 'microphone', 'stage', 'whiteboard', 'wifi',
    'kitchen', 'bar', 'power outlets', 'air-conditioning', 'video conferencing'
  ]);
  expect(prefill.venueRequirements).toBe(requirement);
});
