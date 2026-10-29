import { describe, expect, test } from 'vitest';
import {
  badgeStyle,
  navFor,
  primaryActionFor,
  statusLabel,
  eventActionLabel,
  lockedRequestNotice,
  STATUS_LABELS,
} from './viewModel';
import { color } from '../theme';

describe('badgeStyle', () => {

  test('[NORMAL] [SG2-20:prototype-view-model] matching is case-insensitive', () => {
    const confirmed = badgeStyle('Confirmed');
    for (const status of ['confirmed', 'CONFIRMED']) {
      expect(badgeStyle(status)).toEqual(confirmed);
    }
    expect(confirmed).not.toEqual(badgeStyle('Draft'));
    expect(confirmed).not.toEqual(badgeStyle('Under review'));
  });
});

describe('Find an event in the navigation (SG2-70)', () => {
  const granted = (role: string, permissions: string[]) => ({ userId: 'user-1', role, permissions });

  test.each(['Event Coordinator', 'Venue Staff', 'Technical Support Staff', 'Event Coordinator Lead', 'Safety Officer'] as const)(
    '[NORMAL] [SG2-70:AC3] %s is offered Find an event once the server grants event search',
    (role) => {
      expect(navFor(role, granted('internal', ['events.search'])).at(-1)).toEqual({ screen: 'findEvent', label: 'Find an event' });
    },
  );

  test.each(['Event Coordinator', 'Safety Officer'] as const)(
    '[FAILURE] [SG2-70:AC3] %s is not offered Find an event while permissions load or without the grant',
    (role) => {
      for (const access of [undefined, null, granted('internal', [])]) {
        expect(navFor(role, access).some((item) => item.screen === 'findEvent')).toBe(false);
      }
    },
  );

  test.each(['Event Organiser', 'Attendee'] as const)('[FAILURE] [SG2-70:AC3] %s is never offered Find an event, even with a forged grant', (role) => {
    expect(navFor(role, granted('event_organiser', ['events.search'])).some((item) => item.screen === 'findEvent')).toBe(false);
  });
});

describe('navFor / primaryActionFor (SG2-86)', () => {
  const leadAccess = (permissions: string[]) => ({ userId: 'user-lead', role: 'event_coordinator_lead', permissions });

  test('[NORMAL] [SG2-86:AC2] the Safety Officer is offered only its dashboard, not the organiser-only All events', () => {
    expect(navFor('Safety Officer', { userId: 'user-safety', role: 'safety_officer', permissions: ['event_request.stage.view'] }))
      .toEqual([{ screen: 'dashboard', label: 'Dashboard' }]);
  });

  test('[NORMAL] [SG2-86:AC2] the Lead is offered the queue and assignment screens once the server grants them', () => {
    expect(navFor('Event Coordinator Lead', leadAccess(['event_request.queue.view', 'event_request.assign_coordinator']))).toEqual([
      { screen: 'dashboard', label: 'Dashboard' },
      { screen: 'queue', label: 'Unassigned queue' },
      { screen: 'assign', label: 'Assign coordinators' },
    ]);
  });

  test.each([
    ['still loading', undefined, ['Dashboard']],
    ['unavailable', null, ['Dashboard']],
    ['granted only the queue', leadAccess(['event_request.queue.view']), ['Dashboard', 'Unassigned queue']],
  ] as const)('[FAILURE] [SG2-86:AC2] a Lead whose permissions are %s is not offered the screens they would be refused', (_, access, labels) => {
    expect(navFor('Event Coordinator Lead', access).map((item) => item.label)).toEqual(labels);
  });

  test.each(['Event Organiser', 'Event Coordinator', 'Venue Staff', 'Technical Support Staff'] as const)(
    '[NORMAL] [SG2-86:AC4] %s navigation does not wait on loaded permissions',
    (role) => {
      expect(navFor(role)).toEqual(navFor(role, { userId: 'user-1', role: 'any', permissions: [] }));
      expect(navFor(role).length).toBeGreaterThan(1);
    },
  );

  test('[NORMAL] [FAILURE] [SG2-86:AC4] attendee navigation exposes only authenticated grants', () => {
    expect(navFor('Attendee')).toEqual([]);
    expect(navFor('Attendee', { userId: 'attendee-1', role: 'attendee', permissions: [] })).toEqual([]);
    expect(navFor('Attendee', { userId: 'attendee-1', role: 'attendee', permissions: ['events.registrable.read'] }))
      .toEqual([{ screen: 'findEvents', label: 'Find events' }]);
    expect(navFor('Attendee', { userId: 'attendee-1', role: 'attendee',
      permissions: ['events.registrable.read', 'registrations.mine.read'] })).toEqual([
      { screen: 'findEvents', label: 'Find events' },
      { screen: 'myRegistrations', label: 'My registrations' },
    ]);
  });

  test('[NORMAL] [SG2-86:AC2] the Lead\'s primary action is assigning coordinators; the Safety Officer\'s is their profile', () => {
    expect(primaryActionFor('Event Coordinator Lead')).toEqual({ label: 'Assign coordinators', screen: 'assign' });
    expect(primaryActionFor('Safety Officer')).toEqual({ label: 'My profile', screen: 'profile' });
  });

  test('[NORMAL] [SG2-86:AC4] an attendee has no prototype dashboard primary action', () => {
    expect(primaryActionFor('Attendee')).toBeNull();
  });
});

describe('statusLabel (SG2-100 AC5)', () => {
  test('[NORMAL] [SG2-100:AC5] every stored status has a plain-language name', () => {
    // Independent literals, not a re-derivation of STATUS_LABELS: this is the
    // vocabulary the reader sees, and it is the thing under test.
    const EXPECTED: [string, string][] = [
      ['draft', 'Draft'],
      ['unassigned', 'Awaiting Assignment'],
      ['submitted', 'Submitted'],
      ['under_review', 'Under Review'],
      ['needs_clarification', 'Clarification Needed'],
      ['approved', 'Approved'],
      ['planning', 'Arrangements'],
      ['awaiting_safety_check', 'Awaiting Safety Check'],
      ['safety_rejected', 'Safety Rejected'],
      ['preparation', 'Preparation'],
      ['confirmed', 'Confirmed'],
      ['completed', 'Completed'],
      ['cancelled', 'Cancelled'],
      ['rejected', 'Rejected'],
    ];
    for (const [status, label] of EXPECTED) {
      expect(statusLabel(status)).toBe(label);
    }
    expect(EXPECTED).toHaveLength(Object.keys(STATUS_LABELS).length);
  });

  test('[BOUNDARY] [SG2-100:AC5] surrounding whitespace and casing do not change the answer', () => {
    expect(statusLabel('  AWAITING_SAFETY_CHECK  ')).toBe('Awaiting Safety Check');
    expect(statusLabel('Under_Review')).toBe('Under Review');
  });

  test('[FAILURE] [SG2-100:AC5] an unrecognised status falls back to itself rather than to a guess', () => {
    expect(statusLabel('some_future_status')).toBe('some_future_status');
    expect(statusLabel('')).toBe('');
  });
});

describe('badgeStyle for the Week 7 statuses (SG2-100 AC5)', () => {
  test('[NORMAL] [SG2-100:AC5] [SG2-20:prototype-view-model] a failed safety check reads as a dead state, like rejected and cancelled', () => {
    const dead = { badgeBg: 'rgba(112,119,119,0.35)', badgeFg: '#bbc7c6' };
    // Keep the original prototype inputs alongside stored status values;
    // checking the complete style also covers the earlier foreground checks.
    for (const status of ['safety_rejected', 'rejected', 'cancelled', 'Rejected', 'Cancelled', 'Draft']) {
      expect(badgeStyle(status)).toEqual(dead);
    }
  });

  test('[BOUNDARY] [SG2-100:AC5] the live Week 7 statuses keep the neutral in-progress pill', () => {
    const live = { badgeBg: 'rgba(255,255,255,0.09)', badgeFg: color.mist };
    for (const status of ['unassigned', 'awaiting_safety_check', 'preparation', 'completed']) {
      expect(badgeStyle(status)).toEqual(live);
    }
  });
});

describe('eventActionLabel (SG2-38, SG2-31)', () => {
  const own = { canManage: true, waitingOnMe: false, coordinatorId: 'coord-1' };

  test.each([
    ['submitted', 'With coordinator'],
    ['under_review', 'With coordinator'],
    ['approved', 'With coordinator'],
    ['planning', 'With coordinator'],
    ['preparation', 'With coordinator'],
    ['awaiting_safety_check', 'With safety officer'],
    ['confirmed', 'No action needed'],
    ['completed', 'No action needed'],
    ['cancelled', 'No action needed'],
    ['safety_rejected', 'No action needed'],
    ['rejected', 'Contact coordinator'],
  ])('[NORMAL] [SG2-38:AC2] [SG2-38:AC3] an assigned %s request reads "%s"', (status, label) => {
    expect(eventActionLabel({ ...own, status })).toBe(label);
  });

  test('[NORMAL] [SG2-31:AC4] a request waiting on its organiser says so, whatever the coordinator', () => {
    expect(eventActionLabel({ ...own, status: 'needs_clarification', waitingOnMe: true })).toBe('Waiting on you');
    expect(eventActionLabel({ ...own, status: 'draft', coordinatorId: null, waitingOnMe: true })).toBe('Waiting on you');
  });

  test('[CONFLICT] [SG2-37:coordinator-led-revision] rejected requests direct revisions through the coordinator despite an obsolete waiting flag', () => {
    expect(eventActionLabel({ ...own, status: ' REJECTED ', waitingOnMe: true })).toBe('Contact coordinator');
    expect(lockedRequestNotice({ status: 'rejected', coordinatorId: null })).toContain('Contact your coordinator to discuss revisions and resubmission');
  });

  test('[BOUNDARY] [SG2-38:AC2] a request nobody has been assigned to is awaiting assignment, never with a coordinator', () => {
    expect(eventActionLabel({ ...own, status: 'unassigned', coordinatorId: null })).toBe('Awaiting coordinator assignment');
    // A legacy submitted row with no coordinator is in the same place.
    expect(eventActionLabel({ ...own, status: 'submitted', coordinatorId: null })).toBe('Awaiting coordinator assignment');
    // A finished event with nobody assigned still needs nothing.
    expect(eventActionLabel({ ...own, status: 'cancelled', coordinatorId: null })).toBe('No action needed');
  });

  test('[BOUNDARY] [SG2-38:AC3] the status is matched regardless of case and padding', () => {
    expect(eventActionLabel({ ...own, status: '  COMPLETED ' })).toBe('No action needed');
  });

  test('[FAILURE] [SG2-31:AC4] a colleague\'s event is view only, whatever its status', () => {
    for (const status of ['draft', 'unassigned', 'planning', 'completed']) {
      expect(eventActionLabel({ status, coordinatorId: null, canManage: false, waitingOnMe: false })).toBe('View only');
    }
  });
});

describe('lockedRequestNotice (SG2-38 AC3)', () => {
  test.each([
    ['submitted', 'This request has been submitted and is now with your coordinator for review. Contact your coordinator if an amendment is needed.'],
    ['under_review', 'This request has been submitted and is now with your coordinator for review. Contact your coordinator if an amendment is needed.'],
    ['approved', 'This request has been approved and your coordinator is arranging the venue and equipment. Contact your coordinator if an amendment is needed.'],
    ['planning', 'This request has been approved and your coordinator is arranging the venue and equipment. Contact your coordinator if an amendment is needed.'],
    ['awaiting_safety_check', 'Arrangements are complete and the event is waiting for its safety check by the Safety Officer. Contact your coordinator if an amendment is needed.'],
    ['safety_rejected', 'This event did not pass its safety check and cannot go ahead as planned. Contact your coordinator to discuss next steps.'],
    ['preparation', 'The safety check has passed and your coordinator is completing final preparations. Contact your coordinator if an amendment is needed.'],
    ['confirmed', 'This event is confirmed. No action is needed from you.'],
    ['completed', 'This event has been completed. No action is needed.'],
    ['cancelled', 'This event has been cancelled. No action is needed.'],
    ['rejected', 'This request was rejected. Contact your coordinator to discuss revisions and resubmission. Changes after submission must go through your coordinator.'],
  ])('[NORMAL] [SG2-38:AC3] an assigned %s request explains where it is', (status, notice) => {
    expect(lockedRequestNotice({ status, coordinatorId: 'coord-1' })).toBe(notice);
  });

  test('[BOUNDARY] [SG2-38:AC2] with no coordinator yet the notice says one is still to be assigned', () => {
    const awaiting = 'This request has been submitted and is waiting for a coordinator to be assigned. You will see who it is here once they are.';
    expect(lockedRequestNotice({ status: 'unassigned', coordinatorId: null })).toBe(awaiting);
    expect(lockedRequestNotice({ status: 'submitted', coordinatorId: null })).toBe(awaiting);
    expect(lockedRequestNotice({ status: 'cancelled', coordinatorId: null })).toBe('This event has been cancelled. No action is needed.');
  });

  test('[FAILURE] [SG2-38:AC3] an unrecognised status gets a neutral notice rather than a wrong claim', () => {
    expect(lockedRequestNotice({ status: 'some_future_status', coordinatorId: 'coord-1' }))
      .toBe('This request can no longer be edited. Contact your coordinator if an amendment is needed.');
  });
});
