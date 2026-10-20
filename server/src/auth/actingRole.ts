import { AsyncLocalStorage } from 'node:async_hooks';
import { AccessError, isRole, ROLES, type ResolvedPrincipal, type Role } from './policy';

/**
 * SG2-104: an account can hold several roles, but every request runs as
 * exactly one of them, the acting role. The client names it in this header;
 * the server checks it is a role the account holds and then evaluates the
 * request, its permissions and its database calls as that role only.
 */
export const ACTING_ROLE_HEADER = 'x-acting-role';

/**
 * The role a multi-role account acts as when the request names none: the
 * least-privileged one it holds. Outside roles first, then the read-mostly
 * internal roles, then the operational ones, and Technical Support (who
 * administer roles) last. A single-role account always acts as its role.
 */
export const ACTING_ROLE_DEFAULT_ORDER: readonly Role[] = Object.freeze([
  'attendee', 'event_organiser', 'safety_officer', 'event_coordinator_lead',
  'event_coordinator', 'venue_staff', 'technical_support_staff'
]);

export type ActingRoleFailure = 'invalid_acting_role' | 'role_not_held';

export class ActingRoleError extends Error {
  readonly status: 400 | 403;
  constructor(readonly code: ActingRoleFailure) {
    super(code === 'invalid_acting_role' ? 'Invalid acting role' : 'You do not hold that role');
    this.status = code === 'invalid_acting_role' ? 400 : 403;
  }
}

/** Held roles in the canonical ROLES order, without duplicates. */
export function orderRoles(roles: Iterable<Role>): Role[] {
  const held = new Set(roles);
  return ROLES.filter(role => held.has(role));
}

/**
 * Every role a resolved principal holds, in ROLES order. Fails closed (403)
 * when it holds none or any value is not one of the seven roles, so a
 * resolver returning the older single-role shape keeps working.
 */
export function heldRolesOf(resolved: ResolvedPrincipal): readonly Role[] {
  const held: unknown[] = resolved.roles !== undefined ? [...resolved.roles] : [resolved.role];
  if (!resolved.userId || held.length === 0 || !held.every(isRole)) throw new AccessError(403);
  return Object.freeze(orderRoles(held as Role[]));
}

/**
 * Picks the acting role from the values of every X-Acting-Role header sent.
 * More than one header, or a value that is not exactly one of the seven role
 * codes, is a malformed request (400). A real role the account does not hold
 * is refused (403). No header: the only role held, else the default order.
 */
export function selectActingRole(held: readonly Role[], requested: readonly string[]): Role {
  if (held.length === 0) throw new ActingRoleError('role_not_held');
  if (requested.length > 1) throw new ActingRoleError('invalid_acting_role');
  if (requested.length === 1) {
    const [value] = requested;
    if (!isRole(value)) throw new ActingRoleError('invalid_acting_role');
    if (!held.includes(value)) throw new ActingRoleError('role_not_held');
    return value;
  }
  if (held.length === 1) return held[0];
  return ACTING_ROLE_DEFAULT_ORDER.find(role => held.includes(role))!;
}

const actingRoleStorage = new AsyncLocalStorage<Role>();

/** Runs `next` (the rest of the request) with `role` as its acting role. */
export function runAsActingRole<T>(role: Role, next: () => T): T {
  return actingRoleStorage.run(role, next);
}

/** The acting role of the request in progress, if any. */
export function currentActingRole(): Role | undefined {
  return actingRoleStorage.getStore();
}

/**
 * Headers that carry the acting role to PostgREST, where public.acting_role()
 * checks it against the caller's own account_roles rows. Empty outside a
 * request, so a client built there acts as the account's single role or not
 * at all.
 */
export function actingRoleHeaders(): Record<string, string> {
  const role = currentActingRole();
  return role ? { 'X-Acting-Role': role } : {};
}
