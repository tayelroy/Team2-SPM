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
