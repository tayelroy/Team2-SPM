// SG2-86 added the two Week 7 roles below. Feature-specific grants are
// listed explicitly alongside their universal profile permissions: SG2-100
// gives both the stage and history reads they cannot work without, SG2-53
// gives the Safety Officer read-only equipment placement, and the queues
// they act on arrive with SG2-87/88/91/97.
export const ROLES = [
  'event_organiser',
  'event_coordinator',
  'venue_staff',
  'technical_support_staff',
  'attendee',
  'event_coordinator_lead',
  'safety_officer'
] as const;

export type Role = typeof ROLES[number];
export type PermissionMap = Readonly<Record<string, readonly Role[]>>;
/**
 * The caller of a request. `role` is the role the request acts as (SG2-104),
 * so every role check below and in the handlers applies to that one role;
 * `roles` is every role the account holds, in ROLES order. requireAuth always
 * sets both; a principal built by hand in a test may leave `roles` out.
 */
export interface Principal { userId: string; role: Role; roles?: readonly Role[] }

/** What a principal resolver may return: the account's role or roles. */
export interface ResolvedPrincipal { userId: string; role?: Role; roles?: readonly Role[] }

/** Every role the principal's account holds (just the acting role if unknown). */
export function heldRoles(principal: Principal): readonly Role[] {
  return principal.roles ?? [principal.role];
}

// Actions without an explicit role grant are denied.
export const PERMISSIONS: PermissionMap = Object.freeze({
  'work_queue.read': ['event_coordinator', 'venue_staff', 'technical_support_staff'],
  'venues.availability.view': ['event_coordinator', 'venue_staff', 'technical_support_staff'],
  // Only Technical Support Staff may set or change a role (SG2-24).
  'users.role.update': ['technical_support_staff'],
  // SG2-28: only an Event Organiser raises an event request for their own
  // client organisation.
  'event_request.create': ['event_organiser'],
  // SG2-30: only the organiser who owns a draft can submit it for review.
  'event_request.submit': ['event_organiser'],
  // SG2-26: the organisation event view is restricted to Event Organisers.
  'event_request.view': ['event_organiser'],
  // SG2-32: an organiser can delete their own event requests. Ownership
  // itself is enforced per-row in the handler (fetchOwnEventRequest) and
  // atomically in the delete query itself, not by this role grant.
  'event_request.delete': ['event_organiser'],
  // SG2-29: an organiser can edit their own request's fields while it is
  // still a draft.
  'event_request.update': ['event_organiser'],
  // SG2-33/SG2-34 built assignment and reassignment; SG2-97 (Week 7 change
  // #5) moved it from Technical Support Staff to the Event Coordinator Lead,
  // who is now the only role that assigns or reassigns a coordinator.
  'event_request.assign_coordinator': ['event_coordinator_lead'],
  // SG2-87: only the Event Coordinator Lead sees the queue of unassigned requests.
  'event_request.queue.view': ['event_coordinator_lead'],
  // SG2-35: a coordinator opens a request for review. Which request is
  // enforced per-row by the assignment made in SG2-33, not by this grant.
  'event_request.review': ['event_coordinator'],
  // SG2-39: coordinator updates event information during planning.
  'event_request.planning.update': ['event_coordinator'],
  // SG2-37: the reviewing coordinator decides the outcome. Which request is
  // enforced per-row by the assignment, not by this grant.
  'event_request.decide': ['event_coordinator'],
  // SG2-36: the two participants in a clarification exchange — the assigned
  // coordinator and the organiser who raised it. Which request is enforced
  // per-row in the handler, not by this grant.
  'event_request.clarify': ['event_coordinator', 'event_organiser'],
  // SG2-100 AC4: the assigned coordinator marks an event that has been held
  // as completed. Which event is enforced per-row by the assignment and by
  // the guards on the write itself, not by this grant.
  'event_request.complete': ['event_coordinator'],
  // SG2-57: the assigned coordinator sees which arrangements (venue, equipment,
  // registration) are still outstanding before an event can be confirmed. Which
  // event is enforced per-row by the assignment, not by this grant.
  'event_request.arrangements.view': ['event_coordinator'],
  // SG2-58 AC1/AC2: the assigned coordinator confirms an event in Preparation.
  // Which event, its status and its readiness are enforced by confirm_event
  // (which also rechecks this role from account_roles), not by this grant.
  'event_request.confirm': ['event_coordinator'],
  // SG2-58 AC1/AC3: the confirmed arrangements, for the organiser who created
  // the event and its assigned coordinator (enforced per-row by the handler).
  'event_request.confirmation.view': ['event_organiser', 'event_coordinator'],
  // SG2-66 AC1-AC4: the assigned coordinator sees what a change request would
  // break, accepts it, and marks each outstanding recheck settled. Which
  // event is enforced per-row by the assignment (404 otherwise), not by this
  // grant.
  'event_request.change_request.view': ['event_coordinator'],
  'event_request.change_request.accept': ['event_coordinator'],
  'event_request.rechecks.settle': ['event_coordinator'],
  // SG2-92: the Safety Officer records Approve / Reject / Request Changes on
  // an event from SG2-91's list ('safety_checks.read'). The decisions are
  // read by the Safety Officer, the assigned coordinator and the organiser
  // (per-row, 404 otherwise), and the assigned coordinator reworks a Safety
  // Rejected event back to Planning (per-row, in the database function).
  'event_request.safety_decision.record': ['safety_officer'],
  'event_request.safety_decisions.view': ['safety_officer', 'event_coordinator', 'event_organiser'],
  'event_request.safety_rework': ['event_coordinator'],
  // SG2-38: see what stage an event has reached. SG2-100 adds the two Week 7
  // roles: the Lead assigns from the awaiting-assignment queue and the Safety
  // Officer answers a safety check, and neither can do so without seeing
  // where the event has got to.
  'event_request.stage.view': [
    'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff',
    'event_coordinator_lead', 'safety_officer'
  ],
  // SG2-40: see who changed what on an event.
  // SG2-97: the Event Coordinator Lead opens an event's history from the
  // assignment screen to see previous coordinators (SG2-34 AC4).
  // SG2-100: widened further for the Safety Officer, for the same reason as
  // the stage view.
  'event_request.history.view': [
    'event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff',
    'event_coordinator_lead', 'safety_officer'
  ],
  'venues.read': ['venue_staff', 'event_coordinator'],
  'venues.create': ['venue_staff'],
  'venues.update': ['venue_staff'],
  'venues.delete': ['venue_staff'],
  // SG2-43: layouts a venue supports are shown wherever venue details are
  // shown, but only Venue Staff record them.
  'venues.layouts.read': ['venue_staff', 'event_coordinator'],
  'venues.layouts.update': ['venue_staff'],
  // SG2-77: setup/turnaround times and safety details are read wherever
  // venue availability is read (they change what counts as free), but only
  // Venue Staff record them. SG2-77 AC5: the Safety Officer reads a venue's
  // emergency access and known restrictions for the operational safety check
  // (Week 7 change #6); mirrored in the venue_operations RLS read policy
  // (202610160002_safety_officer_reads_venue_operations.sql).
  'venues.operations.read': ['venue_staff', 'event_coordinator', 'technical_support_staff', 'safety_officer'],
  'venues.operations.update': ['venue_staff'],
  // SG2-46: coordinators narrow the venues down to those that could host an
  // event they are planning.
  'venues.search': ['event_coordinator'],
  // SG2-47: everyone involved in booking a venue for an event sees why the
  // venue does or does not fit it. Which events a coordinator or organiser
  // may see is enforced per-row by the handler.
  'venues.suitability.view': ['event_coordinator', 'venue_staff', 'technical_support_staff', 'event_organiser'],
  // SG2-66 AC5 (replaces the SG2-47 AC3 / SG2-49 AC1 approver list): only
  // Venue Staff approve a capacity exception, for a new booking request or
  // for a booked venue whose event's attendance was raised. Never a
  // coordinator: acknowledging the warning does not approve an exception.
  'venue_booking.capacity_exception.approve': ['venue_staff'],
  // SG2-48 AC1: the coordinator assigned to an approved event requests a
  // venue for it. Which event is enforced per-row by the assignment.
  'venue_booking.request': ['event_coordinator'],
  // SG2-48 AC2/AC3: the assigned coordinator follows their requests while
  // they await a decision, and Venue Staff, who decide them, see them too.
  'venue_booking.request.view': ['event_coordinator', 'venue_staff'],
  // SG2-50 AC1: what a pending request overlaps, for Venue Staff deciding it
  // and the assigned coordinator (enforced per-row).
  'venue_booking.conflicts.view': ['event_coordinator', 'venue_staff'],
  // SG2-49 AC1/AC2: Venue Staff approve or reject a venue request.
  'venue_booking.decide': ['venue_staff'],
  // SG2-82 AC5: the event's assigned coordinator (enforced per-row) withdraws
  // a pending or rejected request the event no longer needs.
  'venue_booking.withdraw': ['event_coordinator'],
  // SG2-49 AC1/AC2: the roles with a notifications drawer read their own
  // notices; the rows are limited to the caller by the handler and by row
  // level security.
  // SG2-51 AC4: Event Organisers are told when a venue for their event is
  // released, so they read their own notices too.
  // SG2-68: the Event Coordinator Lead is told when an event is submitted
  // and waiting for a coordinator.
  'notifications.read': ['event_coordinator', 'venue_staff', 'technical_support_staff', 'event_organiser', 'event_coordinator_lead'],
  // SG2-51: Venue Staff, or the event's assigned coordinator (enforced
  // per-row), see an event's bookings and release one with a reason. Only
  // Venue Staff list a whole venue's bookings (enforced by the handler).
  'venue_bookings.view': ['venue_staff', 'event_coordinator'],
  'venue_bookings.release': ['venue_staff', 'event_coordinator'],
  'venue_bookings.by_venue': ['venue_staff'],
  // SG2-79 AC3: bookings that clash once setup and turnaround apply, for
  // Venue Staff and the coordinator of each affected event (per-row).
  'venue_clashes.view': ['venue_staff', 'event_coordinator'],
  // SG2-45: only Venue Staff block a venue from use or remove a block.
  // SG2-80 AC1/AC6: the same Venue Staff mark it temporarily unavailable.
  'venues.blocks.manage': ['venue_staff'],
  'venues.holds.read': ['event_coordinator', 'venue_staff', 'technical_support_staff'],
  'venues.holds.manage': ['venue_staff'],
  // SG2-52: Technical Support Staff maintain ConnectSphere's inventory.
  'equipment.read': ['technical_support_staff'],
  'equipment.create': ['technical_support_staff'],
  'equipment.update': ['technical_support_staff'],
  // SG2-54: only Technical Support assesses equipment commitments.
  'equipment.availability.read': ['technical_support_staff'],
  // SG2-55: only Technical Support commits equipment reservations.
  'equipment.reservations.manage': ['technical_support_staff'],
  // SG2-53: assigned coordinators request; support records arrangements;
  // Safety Officers read placements for the SG2-91 review workflow.
  'equipment_requirements.read': ['event_coordinator', 'technical_support_staff', 'safety_officer'],
  'equipment_requirements.request': ['event_coordinator'],
  'equipment_requirements.arrange': ['technical_support_staff'],
  // SG2-91 AC2/AC4: only Safety Officers open the list of events awaiting an
  // operational safety check; safety_check_queue() rechecks the stored role.
  'safety_checks.read': ['safety_officer'],
  // SG2-27: every signed-in account manages its own profile.
  'profile.read': [...ROLES],
  'profile.update': [...ROLES]
});

// SG2-27: roles treated as internal to ConnectSphere, who additionally see
// their department on their profile. event_organiser and attendee represent
// client-side/external users. Team decision, 2026-09-15. SG2-86 adds
// event_coordinator_lead and safety_officer as internal; this list is
// mirrored in the event_audit_logs RLS policy (latest version:
// 202610130001_event_history_internal_fields.sql) and the two must change
// together.
export const INTERNAL_ROLES: readonly Role[] = [
  'event_coordinator', 'venue_staff', 'technical_support_staff', 'event_coordinator_lead', 'safety_officer'
];

export function isInternalRole(role: Role): boolean {
  return (INTERNAL_ROLES as readonly string[]).includes(role);
}

// SG2-40: history entries only internal roles may read. Planning notes are the
// coordinators' internal log, so an organiser's history never includes them.
// Mirrored in the organiser branch of the event_audit_logs RLS policy
// (202610130001_event_history_internal_fields.sql); the two must change
// together.
export const INTERNAL_ONLY_AUDIT_FIELDS: readonly string[] = ['planning_notes'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(role: Role, policy: PermissionMap): string[] {
  return Object.entries(policy)
    .filter(([, roles]) => roles.includes(role))
    .map(([permission]) => permission);
}

export class AccessError extends Error {
  constructor(public readonly status: 401 | 403 | 503) {
    super(status === 401 ? 'Authentication required' : status === 403 ? 'Access denied' : 'Access service unavailable');
  }
}
