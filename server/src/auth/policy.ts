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
export interface Principal { userId: string; role: Role }

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
  // SG2-43: layouts a venue supports are shown wherever venue details are
  // shown, but only Venue Staff record them.
  'venues.layouts.read': ['venue_staff', 'event_coordinator'],
  'venues.layouts.update': ['venue_staff'],
  // SG2-77: setup/turnaround times and safety details are read wherever
  // venue availability is read (they change what counts as free), but only
  // Venue Staff record them.
  'venues.operations.read': ['venue_staff', 'event_coordinator', 'technical_support_staff'],
  'venues.operations.update': ['venue_staff'],
  // SG2-46: coordinators narrow the venues down to those that could host an
  // event they are planning.
  'venues.search': ['event_coordinator'],
  // SG2-47: everyone involved in booking a venue for an event sees why the
  // venue does or does not fit it. Which events a coordinator or organiser
  // may see is enforced per-row by the handler.
  'venues.suitability.view': ['event_coordinator', 'venue_staff', 'technical_support_staff', 'event_organiser'],
  // SG2-47 AC3: a capacity exception is approved by Venue Staff, Technical
  // Support Staff or the event's own organiser (enforced per-row). Never a
  // coordinator: acknowledging the warning does not approve an exception.
  'venue_booking.capacity_exception.approve': ['venue_staff', 'technical_support_staff', 'event_organiser'],
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
  // SG2-49 AC1/AC2: the roles with a notifications drawer read their own
  // notices; the rows are limited to the caller by the handler and by row
  // level security.
  // SG2-51 AC4: Event Organisers are told when a venue for their event is
  // released, so they read their own notices too.
  'notifications.read': ['event_coordinator', 'venue_staff', 'technical_support_staff', 'event_organiser'],
  // SG2-51: Venue Staff, or the event's assigned coordinator (enforced
  // per-row), see an event's bookings and release one with a reason. Only
  // Venue Staff list a whole venue's bookings (enforced by the handler).
  'venue_bookings.view': ['venue_staff', 'event_coordinator'],
  'venue_bookings.release': ['venue_staff', 'event_coordinator'],
  'venue_bookings.by_venue': ['venue_staff'],
  // SG2-45: only Venue Staff block a venue from use or remove a block.
  // SG2-80 AC1/AC6: the same Venue Staff mark it temporarily unavailable.
  'venues.blocks.manage': ['venue_staff'],
  'venues.holds.read': ['event_coordinator', 'venue_staff', 'technical_support_staff'],
  'venues.holds.manage': ['venue_staff'],
  // SG2-52: Technical Support Staff maintain ConnectSphere's inventory.
  'equipment.read': ['technical_support_staff'],
  'equipment.create': ['technical_support_staff'],
  'equipment.update': ['technical_support_staff'],
  // SG2-53: assigned coordinators request; support records arrangements;
  // Safety Officers read placements for the SG2-91 review workflow.
  'equipment_requirements.read': ['event_coordinator', 'technical_support_staff', 'safety_officer'],
  'equipment_requirements.request': ['event_coordinator'],
  'equipment_requirements.arrange': ['technical_support_staff'],
  // SG2-27: every signed-in account manages its own profile.
  'profile.read': [...ROLES],
  'profile.update': [...ROLES]
});

// SG2-27: roles treated as internal to ConnectSphere, who additionally see
// their department on their profile. event_organiser and attendee represent
// client-side/external users. Team decision, 2026-09-15. SG2-86 adds
// event_coordinator_lead and safety_officer as internal; this list is
// mirrored in the event_audit_logs RLS policy (202610050004_week7_roles.sql)
// and the two must change together.
export const INTERNAL_ROLES: readonly Role[] = [
  'event_coordinator', 'venue_staff', 'technical_support_staff', 'event_coordinator_lead', 'safety_officer'
];

export function isInternalRole(role: Role): boolean {
  return (INTERNAL_ROLES as readonly string[]).includes(role);
}

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
