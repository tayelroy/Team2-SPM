import { loadSession } from '../auth/session';

/**
 * Client for the profile API (SG2-27).
 *
 * Field names mirror the server payload exactly — see server/src/db/profile.ts
 * and server/src/profile/fields.ts — so there is no second mapping layer to
 * keep in sync. `department` is present only when the server includes it,
 * which it does only for internal roles (event_coordinator, venue_staff,
 * technical_support_staff); its absence, not a null value, is what tells the
 * screen whether to show the field at all.
 */
export interface ProfileRecord {
  user_id: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  communication_preferences: string[];
  department?: string | null;
}

export interface ProfileUpdateInput {
  name: string;
  phone?: string | null;
  communication_preferences?: string[];
  department?: string | null;
}

export type ProfileOutcome =
  | { ok: true; profile: ProfileRecord }
  | { ok: false; message: string; details?: string[] };

const SIGNED_OUT = 'You are signed out. Sign in again to see your profile.';
const UNAVAILABLE = 'Could not reach the server. Please try again.';

async function callProfileApi(method: 'GET' | 'PUT', body?: ProfileUpdateInput): Promise<ProfileOutcome> {
  const session = loadSession();
  if (!session?.accessToken) {
    return { ok: false, message: SIGNED_OUT };
  }

  let response: Response;
  try {
    response = await fetch('/api/profile', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }

  const responseBody = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) return { ok: false, message: SIGNED_OUT };
    if (response.status === 403) {
      return { ok: false, message: 'Your role cannot access a profile.' };
    }
    return {
      ok: false,
      message: responseBody?.error ?? `Could not reach your profile (HTTP ${response.status}).`,
      details: responseBody?.details
    };
  }

  // A success status with an unreadable or malformed body leaves the actual
  // profile unknown — report it rather than dereferencing null.
  if (!responseBody?.profile) {
    return { ok: false, message: 'The server did not return a profile.' };
  }

  return { ok: true, profile: responseBody.profile };
}

/** GET the caller's own profile. */
export function fetchProfile(): Promise<ProfileOutcome> {
  return callProfileApi('GET');
}

/** PUT an update to the caller's own profile. */
export function updateProfile(input: ProfileUpdateInput): Promise<ProfileOutcome> {
  return callProfileApi('PUT', input);
}
