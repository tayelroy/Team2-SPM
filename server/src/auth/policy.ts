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
  // SG2-30: only the requesting organiser drafts, edits or submits their own
  // event requests. Coordinator visibility of submitted requests is granted
  // at the database policy level; there is no coordinator API action yet.
  'event_requests.create': ['event_organiser'],
  'event_requests.view': ['event_organiser'],
  'event_requests.update': ['event_organiser'],
  'event_requests.submit': ['event_organiser']
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
