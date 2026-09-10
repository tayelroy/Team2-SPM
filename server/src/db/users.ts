import type { SupabaseClient } from '@supabase/supabase-js';

export interface NewUserRecord {
  userId: string;
  name: string;
  organisation: string;
  roleName: string;
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
 * creation time; the caller (registration) is responsible for choosing
 * and validating that role.
 */
export async function createUserRecord(
  admin: SupabaseClient,
  record: NewUserRecord
): Promise<CreateUserRecordResult> {
  const roleId = await getRoleId(admin, record.roleName);
  if (roleId === null) {
    return { ok: false, error: `Role "${record.roleName}" is not configured.` };
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
