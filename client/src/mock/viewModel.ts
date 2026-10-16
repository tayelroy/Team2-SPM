/**
 * Pure derivations that turn the fixture data plus the current role/state into
 * exactly what a screen renders. Keeping this separate from the components
 * means the role-scoping rules — which drive most of the prototype — can be
 * read and tested on their own.
 */

import { color } from '../theme';
import { can, type Access } from '../auth/access';
import { EVENTS, NAV, EQUIPMENT, PRIMARY_ACTION } from './data';
import type {
  EquipmentRequest,
  EventCard,
  EventRecord,
  Role,
  Screen,
} from './types';

export interface BadgeStyle {
  badgeBg: string;
  badgeFg: string;
}

/**
 * Plain-language names for the stored statuses (SG2-100 AC5). The database
 * values are snake_case and several of them — `unassigned`,
 * `awaiting_safety_check`, `preparation` — mean nothing to a reader as
 * written, so nothing renders a raw status.
 */
export const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  unassigned: 'Awaiting Assignment',
  submitted: 'Submitted',
  under_review: 'Under Review',
  needs_clarification: 'Clarification Needed',
  approved: 'Approved',
  planning: 'Arrangements',
  awaiting_safety_check: 'Awaiting Safety Check',
  safety_rejected: 'Safety Rejected',
  preparation: 'Preparation',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

/**
 * The reader-facing name for a status. An unrecognised value falls back to
 * itself rather than to a guess, so a status added server-side shows up as
 * something odd rather than as the wrong thing.
 */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status.trim().toLowerCase()] ?? status;
}

/** Status pill colours. Confirmed reads as solid teal; dead states go grey. */
export function badgeStyle(status: string): BadgeStyle {
  const key = status.toLowerCase();
  if (key === 'confirmed') return { badgeBg: color.teal, badgeFg: color.abyss };
  // SG2-100: a failed safety check is a stop, not a step — it gets the same
  // grey as the other states nothing follows from.
  if (key === 'rejected' || key === 'cancelled' || key === 'draft' || key === 'safety_rejected') {
    return { badgeBg: 'rgba(112,119,119,0.35)', badgeFg: color.silver };
  }
  return { badgeBg: 'rgba(255,255,255,0.09)', badgeFg: color.mist };
}

/** The fields of an organisation event that say who is holding it. */
export interface EventProgressInput {
  status: string;
  coordinatorId: string | null;
  canManage: boolean;
  waitingOnMe: boolean;
}

/**
 * Statuses the stage API (server/src/events/stageCalculator.ts) gives no
 * waiting-on: nothing more is expected of anyone the organiser deals with.
 */
const SETTLED_STATUSES: Readonly<Record<string, true>> = {
  confirmed: true, completed: true, cancelled: true, rejected: true, safety_rejected: true,
};

/**
 * Who an organisation event is waiting on, in the organiser's words (SG2-38
 * AC2/AC3, SG2-31 AC4). Shared by the dashboard and My events so both say the
 * same thing, and kept in step with the stage API's waiting-on persona: the
 * Lead's queue is not "with coordinator", and a finished event waits on no one.
 */
export function eventActionLabel(event: EventProgressInput): string {
  if (!event.canManage) return 'View only';
  const status = event.status.trim().toLowerCase();
  if (status === 'rejected') return 'Contact coordinator';
  if (SETTLED_STATUSES[status] === true) return 'No action needed';
  if (event.waitingOnMe) return 'Waiting on you';
  if (status === 'awaiting_safety_check') return 'With safety officer';
  if (status === 'unassigned' || !event.coordinatorId) return 'Awaiting coordinator assignment';
  return 'With coordinator';
}

const AWAITING_ASSIGNMENT_NOTICE =
  'This request has been submitted and is waiting for a coordinator to be assigned. You will see who it is here once they are.';
const UNDER_REVIEW_NOTICE =
  'This request has been submitted and is now with your coordinator for review. Contact your coordinator if an amendment is needed.';
const ARRANGEMENTS_NOTICE =
  'This request has been approved and your coordinator is arranging the venue and equipment. Contact your coordinator if an amendment is needed.';

/** Why an organiser's own request can no longer be edited, by status. */
const LOCKED_NOTICES: Readonly<Record<string, string>> = {
  unassigned: AWAITING_ASSIGNMENT_NOTICE,
  submitted: UNDER_REVIEW_NOTICE,
  under_review: UNDER_REVIEW_NOTICE,
  approved: ARRANGEMENTS_NOTICE,
  planning: ARRANGEMENTS_NOTICE,
  awaiting_safety_check:
    'Arrangements are complete and the event is waiting for its safety check by the Safety Officer. Contact your coordinator if an amendment is needed.',
  safety_rejected:
    'This event did not pass its safety check and cannot go ahead as planned. Contact your coordinator to discuss next steps.',
  preparation:
    'The safety check has passed and your coordinator is completing final preparations. Contact your coordinator if an amendment is needed.',
  confirmed: 'This event is confirmed. No action is needed from you.',
  completed: 'This event has been completed. No action is needed.',
  cancelled: 'This event has been cancelled. No action is needed.',
  rejected: 'This request was rejected. Contact your coordinator to discuss revisions and resubmission. Changes after submission must go through your coordinator.',
};

/**
 * The "Your options" notice for a request its organiser cannot edit (SG2-38
 * AC3): it names where the request actually is rather than claiming every
 * locked request was just submitted to a coordinator.
 */
export function lockedRequestNotice(event: Pick<EventProgressInput, 'status' | 'coordinatorId'>): string {
  const status = event.status.trim().toLowerCase();
  if (!event.coordinatorId && SETTLED_STATUSES[status] !== true) return AWAITING_ASSIGNMENT_NOTICE;
  return LOCKED_NOTICES[status]
    ?? 'This request can no longer be edited. Contact your coordinator if an amendment is needed.';
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

/**
 * The role's nav items the signed-in account can use (SG2-86 AC2). An item
 * that names a permission is left out until `access` — the server's own
 * answer from `/api/auth/me` — includes it, so while permissions are still
 * loading, or could not be loaded, only ungated items are offered.
 */
export function navFor(role: Role, access?: Access | null): { screen: Screen; label: string }[] {
  return NAV[role]
    .filter(([, , permission]) => permission === undefined || can(access, permission))
    .map(([screen, label]) => ({ screen, label }));
}

export function primaryActionFor(role: Role) {
  return PRIMARY_ACTION[role];
}

/** Only the operational roles see the pipeline breakdown. */
export function showsPipeline(role: Role): boolean {
  return (
    role === 'Event Coordinator' ||
    role === 'Venue Staff' ||
    role === 'Technical Support Staff'
  );
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
