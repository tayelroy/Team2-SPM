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
  'venues.read': ['venue_staff', 'event_coordinator'],
  'venues.create': ['venue_staff'],
  'venues.update': ['venue_staff'],
  // SG2-27: every signed-in account manages its own profile.
  'profile.read': [...ROLES],
  'profile.update': [...ROLES]
});

// SG2-27: roles treated as internal to ConnectSphere, who additionally see
// their department on their profile. event_organiser and attendee represent
// client-side/external users. Team decision, 2026-09-15.
export const INTERNAL_ROLES: readonly Role[] = ['event_coordinator', 'venue_staff', 'technical_support_staff'];

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
