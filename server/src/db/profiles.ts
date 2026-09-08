import { getSupabaseClient } from './supabase';

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  communication_preferences: string[];
  department: string | null;
}

export interface ProfileUpdateInput {
  name: string;
  email: string;
  phone: string;
  communication_preferences: string[];
}

export type ProfileResult<T> =
  | { status: 'ok'; profile: T }
  | { status: 'not_found' }
  | { status: 'unavailable'; error: string };

/**
 * Looks up a single user's profile. Returns 'not_found' when the row doesn't
 * exist (rather than throwing), so routes can turn that into a clean 404.
 */
export async function fetchProfile(userId: string): Promise<ProfileResult<Profile>> {
  const client = getSupabaseClient();
  if (!client) {
    return { status: 'unavailable', error: 'Database is not configured' };
  }

  const { data, error } = await client.from('profiles').select('*').eq('id', userId);
  if (error) {
    return { status: 'unavailable', error: error.message };
  }
  if (!data || data.length === 0) {
    return { status: 'not_found' };
  }
  return { status: 'ok', profile: data[0] as Profile };
}

/**
 * Updates the mutable fields of a profile (name, contact details,
 * communication preferences). Validation of the input happens at the route
 * layer before this is called.
 */
export async function updateProfile(
  userId: string,
  updates: ProfileUpdateInput
): Promise<ProfileResult<Profile>> {
  const client = getSupabaseClient();
  if (!client) {
    return { status: 'unavailable', error: 'Database is not configured' };
  }

  const { data, error } = await client.from('profiles').update(updates).eq('id', userId).select();
  if (error) {
    return { status: 'unavailable', error: error.message };
  }
  if (!data || data.length === 0) {
    return { status: 'not_found' };
  }
  return { status: 'ok', profile: data[0] as Profile };
}
