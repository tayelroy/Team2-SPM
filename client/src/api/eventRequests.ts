import { loadSession } from '../auth/session';

/**
 * Client for the event request API (SG2-28 create draft).
 *
 * Field names mirror the server payload exactly so there is no second mapping
 * layer to keep in sync — see server/src/events/fields.ts.
 */
export interface EventRequestDraftInput {
  name?: string;
  purpose?: string;
  description?: string;
  proposed_date?: string;
  expected_attendance?: number;
  venue_requirements?: string;
  accessibility_needs?: string;
  equipment_requirements?: string;
  registration_needed?: boolean;
}

export interface EventRequestDraft extends EventRequestDraftInput {
  event_id: number;
  organiser_id: string;
  organisation: string | null;
  status: string;
}

export type CreateDraftOutcome =
  | { ok: true; request: EventRequestDraft; missingForSubmission: string[] }
  | { ok: false; message: string; details?: string[] };

const SIGNED_OUT = 'You are signed out. Sign in again to save this draft.';
const UNAVAILABLE = 'Could not reach the server. Please try again.';

/**
 * Creates a draft event request.
 *
 * Only the fields the user actually filled in are sent: the server accepts an
 * incomplete draft by design, and omitting a blank field keeps it null rather
 * than storing an empty string.
 */
export async function createEventRequestDraft(
  input: EventRequestDraftInput
): Promise<CreateDraftOutcome> {
  const session = loadSession();
  if (!session?.accessToken) {
    return { ok: false, message: SIGNED_OUT };
  }

  let response: Response;
  try {
    response = await fetch('/api/event-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`
      },
      body: JSON.stringify(input)
    });
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) return { ok: false, message: SIGNED_OUT };
    if (response.status === 403) {
      return { ok: false, message: 'Your role cannot raise event requests.' };
    }
    return {
      ok: false,
      message: body?.error ?? `Could not save the draft (HTTP ${response.status}).`,
      details: body?.details
    };
  }

  // A success status with an unreadable or malformed body means the draft's
  // fate is unknown — report it rather than dereferencing null.
  if (!body?.request) {
    return { ok: false, message: UNAVAILABLE };
  }

  return {
    ok: true,
    request: body.request as EventRequestDraft,
    missingForSubmission: (body.missingForSubmission ?? []) as string[]
  };
}
