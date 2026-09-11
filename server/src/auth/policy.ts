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
  // SG2-25: page grants are separate from business actions. Reading a desk
  // does not grant its decision controls. Unlisted pages/actions fail closed.
  'page.dashboard': ROLES,
  'page.events': ['event_coordinator'],
  'page.detail': ['event_organiser', 'event_coordinator'],
  'page.venues': ['event_coordinator', 'venue_staff'],
  'page.calendar': ['event_coordinator', 'venue_staff', 'technical_support_staff'],
  'page.booking': ['event_coordinator', 'venue_staff'],
  'page.equipment': ['event_coordinator', 'technical_support_staff'],
  'page.attendee': ['attendee'],
  'page.change': ['event_organiser', 'event_coordinator'],
  'event_request.review': ['event_coordinator'],
  'event_request.change': ['event_organiser'],
  'venue_booking.request': ['event_coordinator'],
  'venue_booking.decide': ['venue_staff'],
  'equipment.reserve': ['technical_support_staff'],
  'event_registration.manage': ['attendee'],
  // Only Technical Support Staff may set or change a role (SG2-24).
  'users.role.update': ['technical_support_staff'],
  // SG2-28: only an Event Organiser raises an event request for their own
  // client organisation.
  'event_request.create': ['event_organiser']
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
