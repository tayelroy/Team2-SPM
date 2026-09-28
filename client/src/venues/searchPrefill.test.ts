import { expect, test } from 'vitest';
import type { WorkItem } from '../api/workQueue';
import { EMPTY_SEARCH } from './searchApi';
import { accessibilityKeywords, prefillFromEvent } from './searchPrefill';

const event: WorkItem = { kind: 'event', item_id: 10, event_id: 10, title: 'Meridian Capital Q4 Forum', event_name: 'Meridian Capital Q4 Forum',
  status: 'approved', starts_at: '2026-10-11T16:00:00.000Z', ends_at: null, category: 'assigned', assigned_to_me: true,
  details: { expected_attendance: 180, accessibility_needs: '  Step-free access to the main room; a hearing loop in the hall. ' } };

test('recognised accessibility features become keywords; unrecognised text yields none', () => {
  expect(accessibilityKeywords('Step free entrance, wheelchair spaces, lifts to every floor, a ramp and an accessible restroom'))
    .toEqual(['step-free', 'wheelchair', 'lift', 'ramp', 'accessible toilet']);
  expect(accessibilityKeywords('hi')).toEqual([]);
});

test('AC1: an approved event pre-fills its whole Singapore day, attendance and accessibility keywords', () => {
  expect(prefillFromEvent(event)).toEqual({
    eventId: 10, eventName: 'Meridian Capital Q4 Forum',
    accessibilityNeeds: 'Step-free access to the main room; a hearing loop in the hall.',
    values: { ...EMPTY_SEARCH, from: '2026-10-12T00:00', until: '2026-10-12T23:59', attendance: '180', accessibility: 'step-free, hearing loop' }
  });
});

test('AC3: an event without accessibility needs leaves accessibility unfiltered', () => {
  for (const accessibility_needs of [null, '   ']) {
    const prefill = prefillFromEvent({ ...event, details: { ...event.details, accessibility_needs } });
    expect(prefill.accessibilityNeeds).toBeNull();
    expect(prefill.values.accessibility).toBe('');
  }
});

test('missing date or attendance are left for the coordinator to enter', () => {
  const prefill = prefillFromEvent({ ...event, starts_at: null, details: {} });
  expect(prefill.values).toEqual(EMPTY_SEARCH);
});
