import { describe, expect, test } from 'vitest';
import { color } from '../theme';
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
  scopedEvents,
  showsPipeline,
  statusTrailStyle,
} from './viewModel';

describe('badgeStyle', () => {
  test('confirmed reads as solid teal', () => {
    expect(badgeStyle('Confirmed')).toEqual({
      badgeBg: color.teal,
      badgeFg: color.abyss,
    });
  });

  test.each(['Rejected', 'Cancelled', 'Draft'])('%s is muted grey', (status) => {
    expect(badgeStyle(status).badgeFg).toBe(color.silver);
  });

  test('anything in flight gets the neutral pill', () => {
    expect(badgeStyle('Under review').badgeFg).toBe(color.mist);
  });

  test('matching is case-insensitive', () => {
    for (const status of ['confirmed', 'CONFIRMED']) {
      expect(badgeStyle(status)).toEqual({ badgeBg: color.teal, badgeFg: color.abyss });
    }
  });
});

describe('chipStyle', () => {
  test('the on state uses the accent aqua', () => {
    expect(chipStyle(true).fg).toBe(color.mist);
    expect(chipStyle(false).fg).toBe(color.silver);
  });
});

describe('scopedEvents', () => {
  test('an organiser only sees their own client', () => {
    const events = scopedEvents('Event Organiser');
    expect(events.map((event) => event.ref)).toEqual(['E-205', 'E-201']);
  });

  test('an attendee only sees confirmed events', () => {
    expect(scopedEvents('Attendee').map((event) => event.ref)).toEqual(['E-198']);
  });

  test.each(['Event Coordinator', 'Venue Staff', 'Technical Support Staff'] as Role[])(
    '%s sees every event',
    (role) => {
      expect(scopedEvents(role).map((event) => event.ref)).toEqual([
        'E-205', 'E-201', 'E-198', 'E-190', 'E-186', 'E-181',
      ]);
    },
  );
});

describe('eventCards', () => {
  test('an attendee sees registration framing, not internal status', () => {
    const cards = eventCards('Attendee');
    expect(cards).toMatchObject([{
      ref: 'E-198',
      status: 'Registration open',
      next: 'Places available — registration closes a week before',
      meta: '3 Nov 2026 · The Kelp Room',
    }]);
  });

  test('a coordinator gets the decision they owe on each event', () => {
    const byRef = Object.fromEntries(
      eventCards('Event Coordinator').map((c) => [c.ref, c.next]),
    );
    expect(byRef['E-201']).toBe('Next: decide or request clarification');
    expect(byRef['E-190']).toBe('Next: confirm equipment');
    expect(byRef['E-198']).toBe('Next: no action');
  });

  test('an organiser is told what is on them', () => {
    const byRef = Object.fromEntries(
      eventCards('Event Organiser').map((c) => [c.ref, c.next]),
    );
    expect(byRef['E-205']).toBe('Finish and submit when ready');
    expect(byRef['E-201']).toBe('With your coordinator — no action needed');
    // E-198 belongs to another client, so it is outside an organiser's scope.
    expect(byRef['E-198']).toBeUndefined();
  });

  test('settled events report no outstanding work', () => {
    const byRef = Object.fromEntries(
      eventCards('Venue Staff').map((c) => [c.ref, c.next]),
    );
    expect(byRef['E-198']).toBe('Arrangements confirmed');
  });

  test('the summary line carries date, attendance and venue', () => {
    const card = eventCards('Event Coordinator')[0];
    expect(card.meta).toBe('20 Nov 2026 · 300 expected · —');
  });
});

describe('currentEvent', () => {
  test('pins to E-201 when the role can see it', () => {
    expect(currentEvent('Event Coordinator').ref).toBe('E-201');
  });

  test('falls back to the first visible event otherwise', () => {
    // E-201 is under review, so it is outside an attendee's confirmed-only scope.
    const event = currentEvent('Attendee');
    expect(event).toMatchObject({
      ref: 'E-198', name: 'Quarterly Partner Dinner', status: 'Registration open',
    });
  });
});

describe('role-scoped chrome', () => {
  test('only the operational roles see the pipeline', () => {
    expect(showsPipeline('Event Coordinator')).toBe(true);
    expect(showsPipeline('Venue Staff')).toBe(true);
    expect(showsPipeline('Technical Support Staff')).toBe(true);
    expect(showsPipeline('Event Organiser')).toBe(false);
    expect(showsPipeline('Attendee')).toBe(false);
  });

  test('the dashboard list is titled for the role', () => {
    expect(dashboardListTitle('Event Organiser')).toBe('My events & drafts');
    expect(dashboardListTitle('Attendee')).toBe('Events I can register for');
    expect(dashboardListTitle('Venue Staff')).toBe('Events needing attention');
  });
});

describe('detailActions', () => {
  test('a coordinator gets decision actions', () => {
    const labels = detailActions('Event Coordinator').map((a) => a.label);
    expect(labels).toEqual(['Approve request', 'Request clarification', 'Reject with reason', 'Reassign coordinator']);
  });

  test('the organiser prototype offers amendment actions without coordinator decisions', () => {
    const labels = detailActions('Event Organiser').map((a) => a.label);
    expect(labels).toEqual(['Edit request', 'Request a change', 'Cancel event']);
  });
});

describe('calendarDays', () => {
  const days = calendarDays();

  test('lays out a 5x7 grid with three leading blanks', () => {
    expect(days).toHaveLength(35);
    expect(days.slice(0, 3).every((d) => d.n === '')).toBe(true);
    expect(days[3].n).toBe('1');
  });

  test('numbers run to the end of the month and then stop', () => {
    expect(days[33].n).toBe('31');
    expect(days[34].n).toBe('');
  });

  test('marked days carry their label', () => {
    expect(days.find((d) => d.n === '15')?.label).toBe('Confirmed · E-186');
    expect(days.find((d) => d.n === '24')?.label).toBe('Blocked — maintenance');
    expect(days.find((d) => d.n === '3')?.label).toBe('');
  });

  test('every legend swatch matches a day style in use', () => {
    for (const entry of CALENDAR_LEGEND) {
      expect(days.some((d) => d.bg === entry.bg && d.bd === entry.bd)).toBe(true);
    }
  });
});

describe('equipmentViews', () => {
  test('offers a reserve action on available stock', () => {
    const rows = equipmentViews({});
    expect(rows[0].btn).toBe('Reserve');
    expect(rows[0].done).toBe(false);
  });

  test('a shortfall asks for the conflict to be resolved', () => {
    expect(equipmentViews({})[1].btn).toBe('Resolve conflict');
  });

  test('items that arrived reserved are already settled', () => {
    const alreadyReserved = equipmentViews({})[3];
    expect(alreadyReserved.done).toBe(true);
    expect(alreadyReserved.avail).toBe('Reserved');
  });

  test('reserving a row settles it', () => {
    const rows = equipmentViews({ 0: true });
    expect(rows[0].done).toBe(true);
    expect(rows[0].btn).toBe('Reserved');
    expect(rows[0].avail).toBe('Reserved');
  });
});

describe('statusTrailStyle', () => {
  test('stages up to "under review" read as reached', () => {
    expect(statusTrailStyle(0).fg).toBe(color.mist);
    expect(statusTrailStyle(2).fg).toBe(color.mist);
    expect(statusTrailStyle(3).fg).toBe(color.slate);
  });
});
