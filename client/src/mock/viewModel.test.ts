import { describe, expect, test } from 'vitest';
import type { Role } from './types';
import {
  CALENDAR_LEGEND,
  badgeStyle,
  calendarDays,
  chipStyle,
  currentEvent,
  dashboardListTitle,
  detailActions,
  equipmentViews,
  eventCards,
  navFor,
  previewNavFor,
  primaryActionFor,
  scopedEvents,
  showsPipeline,
  statusTrailStyle,
} from './viewModel';

describe('badgeStyle', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] confirmed reads as solid teal', () => {
    expect(badgeStyle('Confirmed')).toEqual({
      badgeBg: '#00827c',
      badgeFg: '#012624',
    });
  });

  test.each(['Rejected', 'Cancelled', 'Draft'])('[NORMAL] [SG2-20:prototype-view-model] %s is muted grey', (status) => {
    expect(badgeStyle(status).badgeFg).toBe('#bbc7c6');
  });

  test('[NORMAL] [SG2-20:prototype-view-model] anything in flight gets the neutral pill', () => {
    expect(badgeStyle('Under review').badgeFg).toBe('#edfffe');
  });

  test('[NORMAL] [SG2-20:prototype-view-model] matching is case-insensitive', () => {
    for (const status of ['confirmed', 'CONFIRMED']) {
      expect(badgeStyle(status)).toEqual({ badgeBg: '#00827c', badgeFg: '#012624' });
    }
  });
});

describe('chipStyle', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] the on state uses the accent aqua', () => {
    expect(chipStyle(true).fg).toBe('#edfffe');
    expect(chipStyle(false).fg).toBe('#bbc7c6');
  });
});

describe('scopedEvents', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] an organiser only sees their own client', () => {
    const events = scopedEvents('Event Organiser');
    expect(events.map((event) => event.ref)).toEqual(['E-205', 'E-201']);
  });

  test('[NORMAL] [SG2-20:prototype-view-model] an attendee only sees confirmed events', () => {
    expect(scopedEvents('Attendee').map((event) => event.ref)).toEqual(['E-198']);
  });

  test.each(['Event Coordinator', 'Venue Staff', 'Technical Support Staff'] as Role[])(
    '[NORMAL] [SG2-20:prototype-view-model] %s sees every event',
    (role) => {
      expect(scopedEvents(role).map((event) => event.ref)).toEqual([
        'E-205', 'E-201', 'E-198', 'E-190', 'E-186', 'E-181',
      ]);
    },
  );
});

describe('eventCards', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] an attendee sees registration framing, not internal status', () => {
    const cards = eventCards('Attendee');
    expect(cards).toMatchObject([{
      ref: 'E-198',
      status: 'Registration open',
      next: 'Places available — registration closes a week before',
      meta: '3 Nov 2026 · The Kelp Room',
    }]);
  });

  test('[NORMAL] [SG2-20:prototype-view-model] a coordinator gets the decision they owe on each event', () => {
    const byRef = Object.fromEntries(
      eventCards('Event Coordinator').map((c) => [c.ref, c.next]),
    );
    expect(byRef['E-201']).toBe('Next: decide or request clarification');
    expect(byRef['E-190']).toBe('Next: confirm equipment');
    expect(byRef['E-198']).toBe('Next: no action');
  });

  test('[NORMAL] [SG2-20:prototype-view-model] an organiser is told what is on them', () => {
    const byRef = Object.fromEntries(
      eventCards('Event Organiser').map((c) => [c.ref, c.next]),
    );
    expect(byRef['E-205']).toBe('Finish and submit when ready');
    expect(byRef['E-201']).toBe('With your coordinator — no action needed');
    // E-198 belongs to another client, so it is outside an organiser's scope.
    expect(byRef['E-198']).toBeUndefined();
  });

  test('[NORMAL] [SG2-20:prototype-view-model] settled events report no outstanding work', () => {
    const byRef = Object.fromEntries(
      eventCards('Venue Staff').map((c) => [c.ref, c.next]),
    );
    expect(byRef['E-198']).toBe('Arrangements confirmed');
  });

  test('[NORMAL] [SG2-20:prototype-view-model] the summary line carries date, attendance and venue', () => {
    const card = eventCards('Event Coordinator')[0];
    expect(card.meta).toBe('20 Nov 2026 · 300 expected · —');
  });
});

describe('currentEvent', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] pins to E-201 when the role can see it', () => {
    expect(currentEvent('Event Coordinator').ref).toBe('E-201');
  });

  test('[BOUNDARY] [SG2-20:prototype-view-model] falls back to the first visible event otherwise', () => {
    // E-201 is under review, so it is outside an attendee's confirmed-only scope.
    const event = currentEvent('Attendee');
    expect(event).toMatchObject({
      ref: 'E-198', name: 'Quarterly Partner Dinner', status: 'Registration open',
    });
  });
});

describe('role-scoped chrome', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] only the operational roles see the pipeline', () => {
    expect(showsPipeline('Event Coordinator')).toBe(true);
    expect(showsPipeline('Venue Staff')).toBe(true);
    expect(showsPipeline('Technical Support Staff')).toBe(true);
    expect(showsPipeline('Event Organiser')).toBe(false);
    expect(showsPipeline('Attendee')).toBe(false);
  });

  test('[NORMAL] [SG2-20:prototype-view-model] the dashboard list is titled for the role', () => {
    expect(dashboardListTitle('Event Organiser')).toBe('My events & drafts');
    expect(dashboardListTitle('Attendee')).toBe('Events I can register for');
    expect(dashboardListTitle('Venue Staff')).toBe('Events needing attention');
  });

  // SG2-86: the two new roles fall through every one of these role branches
  // to the "all other staff" default — no new case needed, confirmed here.
  test('[NORMAL] [SG2-86:AC4] the new Week 7 roles are not treated as operational for the pipeline', () => {
    expect(showsPipeline('Event Coordinator Lead')).toBe(false);
    expect(showsPipeline('Safety Officer')).toBe(false);
  });

  test('[NORMAL] [SG2-86:AC4] the new Week 7 roles get the generic dashboard list title', () => {
    expect(dashboardListTitle('Event Coordinator Lead')).toBe('Events needing attention');
    expect(dashboardListTitle('Safety Officer')).toBe('Events needing attention');
  });
});

describe('navFor / previewNavFor / primaryActionFor (SG2-86)', () => {
  test('[NORMAL] [SG2-86:AC1] Safety Officer has a minimal nav: dashboard and all events only', () => {
    expect(navFor('Safety Officer')).toEqual([
      { screen: 'dashboard', label: 'Dashboard' },
      { screen: 'events', label: 'All events' },
    ]);
  });

  test('[BOUNDARY] [SG2-86:AC1] Safety Officer has no preview-only screens', () => {
    expect(previewNavFor('Safety Officer')).toEqual([]);
  });

  test('[NORMAL] [SG2-86:AC1] the new roles land on My profile as their one usable primary action', () => {
    expect(primaryActionFor('Event Coordinator Lead')).toEqual({ label: 'My profile', screen: 'profile' });
    expect(primaryActionFor('Safety Officer')).toEqual({ label: 'My profile', screen: 'profile' });
  });
});

describe('detailActions', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] a coordinator gets decision actions', () => {
    const labels = detailActions('Event Coordinator').map((a) => a.label);
    expect(labels).toEqual(['Approve request', 'Request clarification', 'Reject with reason', 'Reassign coordinator']);
  });

  test('[NORMAL] [SG2-20:prototype-view-model] the organiser prototype offers amendment actions without coordinator decisions', () => {
    const labels = detailActions('Event Organiser').map((a) => a.label);
    expect(labels).toEqual(['Edit request', 'Request a change', 'Cancel event']);
  });
});

describe('calendarDays', () => {
  const days = calendarDays();

  test('[BOUNDARY] [SG2-20:prototype-view-model] lays out a 5x7 grid with three leading blanks', () => {
    expect(days).toHaveLength(35);
    expect(days.slice(0, 3).every((d) => d.n === '')).toBe(true);
    expect(days[3].n).toBe('1');
  });

  test('[BOUNDARY] [SG2-20:prototype-view-model] numbers run to the end of the month and then stop', () => {
    expect(days[33].n).toBe('31');
    expect(days[34].n).toBe('');
  });

  test('[NORMAL] [SG2-20:prototype-view-model] marked days carry their label', () => {
    expect(days.find((d) => d.n === '15')?.label).toBe('Confirmed · E-186');
    expect(days.find((d) => d.n === '24')?.label).toBe('Blocked — maintenance');
    expect(days.find((d) => d.n === '3')?.label).toBe('');
  });

  test('[NORMAL] [SG2-20:prototype-view-model] the legend and representative days show the four documented availability states', () => {
    expect(CALENDAR_LEGEND).toEqual([
      { label: 'Available', bg: 'rgba(1,29,28,0.5)', bd: 'rgba(255,255,255,0.07)' },
      { label: 'Held / requested', bg: 'rgba(0,130,124,0.22)', bd: 'rgba(203,255,252,0.4)' },
      { label: 'Confirmed', bg: '#00827c', bd: '#00827c' },
      { label: 'Blocked', bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)' },
    ]);
    expect(['3', '12', '15', '24'].map(n => days.find(day => day.n === n))).toMatchObject([
      { label: '', bg: 'rgba(1,29,28,0.5)', bd: 'rgba(255,255,255,0.07)' },
      { label: 'Held 09–13 · E-190', bg: 'rgba(0,130,124,0.22)', bd: 'rgba(203,255,252,0.4)' },
      { label: 'Confirmed · E-186', bg: '#00827c', bd: '#00827c' },
      { label: 'Blocked — maintenance', bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)' },
    ]);
  });
});

describe('equipmentViews', () => {
  test('[NORMAL] [SG2-20:prototype-view-model] offers a reserve action on available stock', () => {
    const rows = equipmentViews({});
    expect(rows[0].btn).toBe('Reserve');
    expect(rows[0].done).toBe(false);
  });

  test('[CONFLICT] [SG2-20:prototype-view-model] a shortfall asks for the conflict to be resolved', () => {
    expect(equipmentViews({})[1].btn).toBe('Resolve conflict');
  });

  test('[CONFLICT] [SG2-20:prototype-view-model] items that arrived reserved are already settled', () => {
    const alreadyReserved = equipmentViews({})[3];
    expect(alreadyReserved.done).toBe(true);
    expect(alreadyReserved.avail).toBe('Reserved');
  });

  test('[NORMAL] [SG2-20:prototype-view-model] reserving a row settles it', () => {
    const rows = equipmentViews({ 0: true });
    expect(rows[0].done).toBe(true);
    expect(rows[0].btn).toBe('Reserved');
    expect(rows[0].avail).toBe('Reserved');
  });
});

describe('statusTrailStyle', () => {
  test('[BOUNDARY] [SG2-20:prototype-view-model] stages up to "under review" read as reached', () => {
    expect(statusTrailStyle(0).fg).toBe('#edfffe');
    expect(statusTrailStyle(2).fg).toBe('#edfffe');
    expect(statusTrailStyle(3).fg).toBe('#707777');
  });
});
