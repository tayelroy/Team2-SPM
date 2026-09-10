/**
 * account_roles.role (SG2-25) stores snake_case ('event_organiser'); the UI
 * and the rest of this app's API contract use Title Case ('Event Organiser',
 * matching public.roles.role_name and client/src/mock/types.ts's ROLES).
 * Both five-role lists round-trip cleanly through these, so no lookup table
 * is needed — just verified against auth/policy.ts's ROLES at the call site.
 */

export function toSnakeRole(displayName: string): string {
  return displayName.trim().toLowerCase().replace(/\s+/g, '_');
}

export function toDisplayRole(snakeName: string): string {
  return snakeName
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
