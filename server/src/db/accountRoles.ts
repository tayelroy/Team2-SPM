import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountRoleWriteResult = { ok: true } | { ok: false; error: string };

/**
 * public.account_roles is the authoritative role store (SG2-25): RLS-secured,
 * writable only by the service-role client. `role` is stored in the table's
 * own snake_case form (e.g. 'event_organiser') — callers convert to/from the
 * Title Case shown in the UI via auth/roleFormat.ts.
 */
export async function createAccountRole(
  admin: SupabaseClient,
  userId: string,
  role: string
): Promise<AccountRoleWriteResult> {
  const { error } = await admin.from('account_roles').insert({ user_id: userId, role });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export type RoleChangeAction = 'add' | 'remove' | 'replace';

export type RoleChangeResult =
  | { outcome: 'changed' | 'unchanged'; roles: string[] }
  | { outcome: 'self' | 'forbidden' | 'missing' | 'last_role' | 'invalid' | 'error' };

const ROLE_CHANGE_REFUSALS = new Set(['self', 'forbidden', 'missing', 'last_role', 'invalid']);

/**
 * SG2-104: adds a role, removes a role, or replaces every role with one, in
 * the database's change_account_roles() (service role only), which locks
 * both accounts, refuses self-changes and a last-role removal, and requires
 * the actor to hold technical_support_staff.
 */
export async function changeAccountRoles(
  admin: SupabaseClient,
  actorId: string,
  targetId: string,
  action: RoleChangeAction,
  role: string
): Promise<RoleChangeResult> {
  const { data, error } = await admin.rpc('change_account_roles', {
    p_actor_id: actorId, p_target_id: targetId, p_action: action, p_role: role
  });
  // 22P02 (invalid_text_representation): the id is not a UUID, so no account can match it.
  if (error?.code === '22P02') return { outcome: 'missing' };
  if (error || !data || typeof data !== 'object') return { outcome: 'error' };
  const result = data as { outcome?: unknown; roles?: unknown };
  if (result.outcome === 'changed' || result.outcome === 'unchanged') {
    if (!Array.isArray(result.roles) || !result.roles.every(item => typeof item === 'string')) return { outcome: 'error' };
    return { outcome: result.outcome, roles: result.roles };
  }
  if (typeof result.outcome === 'string' && ROLE_CHANGE_REFUSALS.has(result.outcome)) {
    return { outcome: result.outcome as 'self' | 'forbidden' | 'missing' | 'last_role' | 'invalid' };
  }
  return { outcome: 'error' };
}

export type GetHeldRolesResult =
  | { ok: true; roles: string[] }
  | { ok: false; reason: 'user_not_found' | 'error'; error?: string };

/**
 * Reads every role an account holds from the authoritative store (SG2-104),
 * e.g. to confirm a coordinator-assignment target holds `event_coordinator`
 * (SG2-33/SG2-34) rather than trusting the caller's claim.
 */
export async function getHeldRoles(admin: SupabaseClient, userId: string): Promise<GetHeldRolesResult> {
  const { data, error } = await admin.from('account_roles').select('role').eq('user_id', userId).order('role');
  if (error?.code === '22P02') {
    return { ok: false, reason: 'user_not_found' };
  }
  if (error) {
    return { ok: false, reason: 'error', error: error.message };
  }
  const roles = ((data as { role: string }[] | null) ?? []).map(row => row.role);
  if (roles.length === 0) {
    return { ok: false, reason: 'user_not_found' };
  }
  return { ok: true, roles };
}

export type GetAccountRolesResult =
  | { ok: true; roles: Map<string, string[]> }
  | { ok: false; error: string };

/**
 * Reads several accounts' roles at once (SG2-40), keyed by user id — the
 * history drawer names each actor's roles (SG2-104: an account may hold
 * several). An account without a role row is simply absent from the result.
 */
export async function getAccountRoles(admin: SupabaseClient, userIds: string[]): Promise<GetAccountRolesResult> {
  const { data, error } = await admin.from('account_roles').select('user_id, role').in('user_id', userIds);

  if (error) {
    return { ok: false, error: error.message };
  }
  const roles = new Map<string, string[]>();
  for (const row of (data as { user_id: string; role: string }[] | null) ?? []) {
    roles.set(row.user_id, [...(roles.get(row.user_id) ?? []), row.role]);
  }
  return { ok: true, roles };
}

/** Best-effort cleanup for registration rollback; failures are not surfaced. */
export async function deleteAccountRole(admin: SupabaseClient, userId: string): Promise<void> {
  await admin.from('account_roles').delete().eq('user_id', userId).then(
    () => undefined,
    () => undefined
  );
}

export interface CoordinatorOption {
  user_id: string;
  name: string;
}

export type ListCoordinatorsResult =
  | { ok: true; coordinators: CoordinatorOption[] }
  | { ok: false; error: string };

/**
 * Lists the accounts that can be chosen as a coordinator (SG2-33/SG2-34):
 * everyone whose authoritative role is `event_coordinator`, with the name
 * from their profile row. Sorted by name so the picker order is stable.
 */
export async function listCoordinators(admin: SupabaseClient): Promise<ListCoordinatorsResult> {
  const roles = await admin.from('account_roles').select('user_id').eq('role', 'event_coordinator');
  if (roles.error) {
    return { ok: false, error: roles.error.message };
  }
  const ids = ((roles.data as { user_id: string }[] | null) ?? []).map(row => row.user_id);
  if (ids.length === 0) {
    return { ok: true, coordinators: [] };
  }

  const users = await admin.from('users').select('user_id, name').in('user_id', ids);
  if (users.error) {
    return { ok: false, error: users.error.message };
  }
  const coordinators = ((users.data as CoordinatorOption[] | null) ?? [])
    .map(({ user_id, name }) => ({ user_id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, coordinators };
}
