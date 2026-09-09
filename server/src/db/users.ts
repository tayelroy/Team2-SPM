import type { SupabaseClient } from '@supabase/supabase-js';

export interface NewUserRecord {
  userId: string;
  name: string;
  organisation: string;
}

export type CreateUserRecordResult = { ok: true } | { ok: false; error: string };

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
