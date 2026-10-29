/** Presentation helpers for event status and role navigation. */

import { color } from '../theme';
import { can, type Access } from '../auth/access';
import { NAV, PRIMARY_ACTION } from './data';
import type {
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
  return role === 'Attendee' ? null : PRIMARY_ACTION[role];
}
