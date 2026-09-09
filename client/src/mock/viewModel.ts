/**
 * Pure derivations that turn the fixture data plus the current role/state into
 * exactly what a screen renders. Keeping this separate from the components
 * means the role-scoping rules — which drive most of the prototype — can be
 * read and tested on their own.
 */

import { color } from '../theme';
import { ACTIONS, EVENTS, NAV, VENUES, EQUIPMENT, PRIMARY_ACTION } from './data';
import type {
  EquipmentRequest,
  EventCard,
  EventRecord,
  Role,
  Screen,
  Venue,
} from './types';

export interface BadgeStyle {
  badgeBg: string;
  badgeFg: string;
}

/** Status pill colours. Confirmed reads as solid teal; dead states go grey. */
export function badgeStyle(status: string): BadgeStyle {
  const key = status.toLowerCase();
  if (key === 'confirmed') return { badgeBg: color.teal, badgeFg: color.abyss };
  if (key === 'rejected' || key === 'cancelled' || key === 'draft') {
    return { badgeBg: 'rgba(112,119,119,0.35)', badgeFg: color.silver };
  }
  return { badgeBg: 'rgba(255,255,255,0.09)', badgeFg: color.mist };
}

export interface ChipStyle {
  bg: string;
  bd: string;
  fg: string;
}

/** Selectable chip — on-state borrows the accent aqua. */
export function chipStyle(on: boolean): ChipStyle {
  return on
    ? { bg: 'rgba(203,255,252,0.16)', bd: 'rgba(203,255,252,0.5)', fg: color.mist }
    : { bg: 'rgba(255,255,255,0.05)', bd: 'rgba(255,255,255,0.12)', fg: color.silver };
}

/**
 * Row-level access control: an organiser sees only their own client's events,
 * an attendee only confirmed ones, everyone else sees the full list.
 */
export function scopedEvents(role: Role): EventRecord[] {
  if (role === 'Event Organiser') {
    return EVENTS.filter((e) => e.client === 'Meridian Capital');
  }
  if (role === 'Attendee') {
    return EVENTS.filter((e) => e.status === 'Confirmed');
  }
  return EVENTS;
}

function nextStep(role: Role, status: string): string {
  if (role === 'Attendee') {
    return 'Places available — registration closes a week before';
  }
  if (role === 'Event Coordinator') {
    if (status === 'Under review') return 'Next: decide or request clarification';
    if (status === 'Planning') return 'Next: confirm equipment';
    return 'Next: no action';
  }
  if (status === 'Draft') return 'Finish and submit when ready';
  if (status === 'Under review') return 'With your coordinator — no action needed';
  return 'Arrangements confirmed';
}

/** Events decorated with the badge, summary line and next-step copy. */
export function eventCards(role: Role): EventCard[] {
  const isAttendee = role === 'Attendee';
  return scopedEvents(role).map((e) => ({
    ...e,
    ...(isAttendee
      ? { badgeBg: 'rgba(255,255,255,0.09)', badgeFg: color.mist }
      : badgeStyle(e.status)),
    status: isAttendee ? 'Registration open' : e.status,
    meta: isAttendee
      ? `${e.date} · ${e.venue}`
      : `${e.date} · ${e.attendance} expected · ${e.venue}`,
    next: nextStep(role, e.status),
  }));
}

/** The event the detail and booking screens are pinned to. */
export function currentEvent(role: Role): EventCard {
  const cards = eventCards(role);
  return cards.find((e) => e.ref === 'E-201') ?? cards[0];
}

export function navFor(role: Role): { screen: Screen; label: string }[] {
  return NAV[role].map(([screen, label]) => ({ screen, label }));
}

export function actionsFor(role: Role) {
  return ACTIONS[role];
}

export function primaryActionFor(role: Role) {
  return PRIMARY_ACTION[role];
}

/** Only the operational roles see the pipeline breakdown. */
export function showsPipeline(role: Role): boolean {
  return (
    role === 'Event Coordinator' ||
    role === 'Venue Staff' ||
    role === 'Technical Support'
  );
}

export function dashboardListTitle(role: Role): string {
  if (role === 'Event Organiser') return 'My events & drafts';
  if (role === 'Attendee') return 'Events I can register for';
  return 'Events needing attention';
}

export interface DetailAction {
  label: string;
  bg: string;
  bd: string;
  fg: string;
  screen: Screen;
}

/** Coordinators decide; everyone else can only amend their own request. */
export function detailActions(role: Role): DetailAction[] {
  if (role === 'Event Coordinator') {
    return [
      {
        label: 'Approve request',
        bg: 'rgba(203,255,252,0.16)',
        bd: 'rgba(203,255,252,0.5)',
        fg: color.mist,
        screen: 'venues',
      },
      {
        label: 'Request clarification',
        bg: color.deep,
        bd: 'rgba(255,255,255,0.14)',
        fg: color.platinum,
        screen: 'detail',
      },
      {
        label: 'Reject with reason',
        bg: 'transparent',
        bd: 'rgba(255,255,255,0.14)',
        fg: color.silver,
        screen: 'detail',
      },
      {
        label: 'Reassign coordinator',
        bg: 'transparent',
        bd: 'rgba(255,255,255,0.14)',
        fg: color.silver,
        screen: 'detail',
      },
    ];
  }
  return [
    {
      label: 'Edit request',
      bg: 'rgba(203,255,252,0.16)',
      bd: 'rgba(203,255,252,0.5)',
      fg: color.mist,
      screen: 'form',
    },
    {
      label: 'Request a change',
      bg: color.deep,
      bd: 'rgba(255,255,255,0.14)',
      fg: color.platinum,
      screen: 'change',
    },
    {
      label: 'Cancel event',
      bg: 'transparent',
      bd: 'rgba(255,255,255,0.14)',
      fg: color.silver,
      screen: 'detail',
    },
  ];
}

export interface CalendarDay {
  n: string;
  label: string;
  bg: string;
  bd: string;
  numFg: string;
  labelFg: string;
}

/** October 2026 starting on a Thursday — three leading blanks. */
const DAY_MARKS: Record<number, [string, number]> = {
  12: ['Held 09–13 · E-190', 1],
  15: ['Confirmed · E-186', 2],
  19: ['Requested · E-201', 1],
  24: ['Blocked — maintenance', 3],
  25: ['Blocked — maintenance', 3],
};

const DAY_STYLES = [
  { bg: 'rgba(1,29,28,0.5)', bd: 'rgba(255,255,255,0.07)', labelFg: color.mist },
  { bg: 'rgba(0,130,124,0.22)', bd: 'rgba(203,255,252,0.4)', labelFg: color.mist },
  { bg: color.teal, bd: color.teal, labelFg: color.abyss },
  { bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)', labelFg: color.silver },
  { bg: 'transparent', bd: 'transparent', labelFg: color.slate },
];

export function calendarDays(): CalendarDay[] {
  const days: CalendarDay[] = [];
  for (let i = 1; i <= 35; i += 1) {
    const n = i - 3;
    const mark = DAY_MARKS[n];
    const outside = n < 1 || n > 31;
    const kind = outside ? 4 : mark ? mark[1] : 0;
    const style = DAY_STYLES[kind];
    days.push({
      n: outside ? '' : String(n),
      label: mark ? mark[0] : '',
      numFg: kind === 2 ? color.abyss : outside ? 'transparent' : color.silver,
      ...style,
    });
  }
  return days;
}

export const CALENDAR_LEGEND = [
  { label: 'Available', bg: 'rgba(1,29,28,0.5)', bd: 'rgba(255,255,255,0.07)' },
  {
    label: 'Held / requested',
    bg: 'rgba(0,130,124,0.22)',
    bd: 'rgba(203,255,252,0.4)',
  },
  { label: 'Confirmed', bg: color.teal, bd: color.teal },
  { label: 'Blocked', bg: 'rgba(112,119,119,0.3)', bd: 'rgba(255,255,255,0.06)' },
];

export interface VenueView extends Venue {
  dot: string;
  fitFg: string;
}

export function venueViews(): VenueView[] {
  return VENUES.map((v) => ({
    ...v,
    dot:
      v.suitability === 1 ? color.teal : v.suitability === 0 ? color.accent : color.slate,
    fitFg: v.suitability === 0 ? color.mist : color.silver,
  }));
}

export interface EquipmentView extends EquipmentRequest {
  availFg: string;
  btn: string;
  btnBg: string;
  btnBd: string;
  btnFg: string;
  done: boolean;
}

/**
 * `reserved` holds the indexes the user has reserved this session; those rows
 * collapse to the same settled state as items that arrived already reserved.
 */
export function equipmentViews(reserved: Record<number, boolean>): EquipmentView[] {
  return EQUIPMENT.map((q, i) => {
    const done = q.status === 2 || Boolean(reserved[i]);
    return {
      ...q,
      done,
      avail: done ? 'Reserved' : q.avail,
      availFg: q.status === 0 ? color.mist : color.silver,
      btn: done ? 'Reserved' : q.status === 0 ? 'Resolve conflict' : 'Reserve',
      btnBg: done
        ? 'rgba(0,130,124,0.35)'
        : q.status === 0
          ? 'rgba(203,255,252,0.16)'
          : color.deep,
      btnBd: done ? 'rgba(203,255,252,0.3)' : 'rgba(255,255,255,0.14)',
      btnFg: done ? color.mist : color.platinum,
    };
  });
}

export function statusTrailStyle(index: number) {
  const reached = index <= 2;
  return {
    bg: reached ? 'rgba(0,130,124,0.35)' : 'rgba(255,255,255,0.05)',
    fg: reached ? color.mist : color.slate,
  };
}
