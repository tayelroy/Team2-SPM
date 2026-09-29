import type { SupabaseClient } from '@supabase/supabase-js';

export type AccountRoleWriteResult = { ok: true } | { ok: false; error: string };
export type AccountRoleUpdateResult =
  | { ok: true }
  | { ok: false; reason: 'user_not_found' | 'error'; error?: string };

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

export async function updateAccountRole(
  admin: SupabaseClient,
  userId: string,
  role: string
): Promise<AccountRoleUpdateResult> {
  const { data, error } = await admin.from('account_roles').update({ role }).eq('user_id', userId).select('user_id');

  if (error) {
    return { ok: false, reason: 'error', error: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'user_not_found' };
  }
  return { ok: true };
}

export type GetAccountRoleResult =
  | { ok: true; role: string }
  | { ok: false; reason: 'user_not_found' | 'error'; error?: string };

/**
 * Reads a single account's role from the authoritative store (SG2-33/SG2-34)
 * — used to confirm a coordinator-assignment target actually holds the
 * `event_coordinator` role before the write, rather than trusting the
 * caller's claim.
 */
export async function getAccountRole(admin: SupabaseClient, userId: string): Promise<GetAccountRoleResult> {
  const { data, error } = await admin.from('account_roles').select('role').eq('user_id', userId).maybeSingle();

  if (error) {
    return { ok: false, reason: 'error', error: error.message };
  }
  if (!data) {
    return { ok: false, reason: 'user_not_found' };
  }
  return { ok: true, role: (data as { role: string }).role };
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
