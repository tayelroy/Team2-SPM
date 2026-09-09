import type { SupabaseClient } from '@supabase/supabase-js';

export interface NewUserRecord {
  userId: string;
  name: string;
  organisation: string;
}

export type CreateUserRecordResult = { ok: true } | { ok: false; error: string };

export const VALID_ROLE_NAMES = [
  'Event Organiser',
  'Event Coordinator',
  'Venue Staff',
  'Technical Support Staff',
  'Attendee'
] as const;

export type RoleName = (typeof VALID_ROLE_NAMES)[number];

export type UpdateUserRoleResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_role' | 'user_not_found' | 'error'; error?: string };

const DEFAULT_ROLE_NAME = 'Attendee';

async function getRoleId(admin: SupabaseClient, roleName: string): Promise<number | null> {
  const { data, error } = await admin
    .from('roles')
    .select('role_id')
    .eq('role_name', roleName)
    .maybeSingle();

  if (error || !data) {
    return null;
  }
  return (data as { role_id: number }).role_id;
}

/**
 * Creates the public.users row backing a newly created Auth account.
 * public.users.role_id is NOT NULL, so every account needs a role at
 * creation time; new accounts default to Attendee since only Technical
 * Support Staff may assign or change a role afterward (SG2-24).
 */
export async function createUserRecord(
  admin: SupabaseClient,
  record: NewUserRecord
): Promise<CreateUserRecordResult> {
  const roleId = await getRoleId(admin, DEFAULT_ROLE_NAME);
  if (roleId === null) {
    return { ok: false, error: `Default role "${DEFAULT_ROLE_NAME}" is not configured.` };
  }

  const { error } = await admin.from('users').insert({
    user_id: record.userId,
    name: record.name,
    organisation: record.organisation,
    role_id: roleId
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Changes a user's role. Caller authorisation (only Technical Support Staff
 * may call this) is enforced by the route handler, not here — this function
 * only validates that the target role name is a real one.
 */
export async function updateUserRole(
  admin: SupabaseClient,
  userId: string,
  roleName: string
): Promise<UpdateUserRoleResult> {
  if (!VALID_ROLE_NAMES.includes(roleName as RoleName)) {
    return { ok: false, reason: 'invalid_role' };
  }

  const roleId = await getRoleId(admin, roleName);
  if (roleId === null) {
    return { ok: false, reason: 'invalid_role' };
  }

  const { data, error } = await admin.from('users').update({ role_id: roleId }).eq('user_id', userId).select('user_id');

  if (error) {
    return { ok: false, reason: 'error', error: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'user_not_found' };
  }
  return { ok: true };
}
