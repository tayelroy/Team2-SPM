export const ROLES = [
  'event_organiser',
  'event_coordinator',
  'venue_staff',
  'technical_support_staff',
  'attendee'
] as const;

export type Role = typeof ROLES[number];
export type PermissionMap = Readonly<Record<string, readonly Role[]>>;
export interface Principal { userId: string; role: Role }

// Actions without an explicit role grant are denied.
export const PERMISSIONS: PermissionMap = Object.freeze({
  'venues.availability.view': ['event_coordinator', 'venue_staff', 'technical_support_staff'],
  // Only Technical Support Staff may set or change a role (SG2-24).
  'users.role.update': ['technical_support_staff'],
  // SG2-28: only an Event Organiser raises an event request for their own
  // client organisation.
  'event_request.create': ['event_organiser'],
  // SG2-30: only the organiser who owns a draft can submit it for review.
  'event_request.submit': ['event_organiser'],
  // SG2-32 (minimal slice of SG2-31): an organiser can see and delete their
  // own event requests. Ownership itself is enforced per-row in the handler
  // (fetchOwnEventRequest / listOwnEventRequests), not by this role grant.
  'event_request.read': ['event_organiser'],
  'event_request.delete': ['event_organiser'],
  // SG2-29: an organiser can edit their own request's fields while it is
  // still a draft.
  'event_request.update': ['event_organiser'],
  'venues.read': ['venue_staff', 'event_coordinator'],
  'venues.create': ['venue_staff'],
  'venues.update': ['venue_staff']
});

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
