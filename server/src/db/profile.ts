import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProfileUpdateValues } from '../profile/fields';

/** A profile row as stored on public.users. */
export interface ProfileRecord {
  user_id: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  communication_preferences: string[];
  department: string | null;
}

export type ProfileResult =
  | { ok: true; profile: ProfileRecord }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

const PROFILE_COLUMNS = 'user_id, name, organisation, phone, communication_preferences, department';

const NOT_FOUND_MESSAGE = 'No user record for the signed-in account.';

/** Reads the caller's own profile. `userId` always comes from the verified principal, never the request. */
export async function fetchProfile(admin: SupabaseClient, userId: string): Promise<ProfileResult> {
  const { data, error } = await admin.from('users').select(PROFILE_COLUMNS).eq('user_id', userId);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: NOT_FOUND_MESSAGE };
  }
  return { ok: true, profile: data[0] as unknown as ProfileRecord };
}

/**
 * Updates the caller's own profile. `department` is only written when the
 * validated update included it (i.e. the caller is an internal role) —
 * omitting the key here, rather than sending it as null, leaves an existing
 * value untouched for a role whose department is not part of this update.
 */
export async function updateProfile(
  admin: SupabaseClient,
  userId: string,
  updates: ProfileUpdateValues
): Promise<ProfileResult> {
  const row: Record<string, unknown> = {
    name: updates.name,
    phone: updates.phone,
    communication_preferences: updates.communication_preferences
  };
  if ('department' in updates) {
    row.department = updates.department;
  }

  const { data, error } = await admin
    .from('users')
    .update(row)
    .eq('user_id', userId)
    .select(PROFILE_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: NOT_FOUND_MESSAGE };
  }
  return { ok: true, profile: data[0] as unknown as ProfileRecord };
}
