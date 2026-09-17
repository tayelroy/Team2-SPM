import { loadSession } from '../auth/session';

/**
 * Client-side API helpers for event request operations.
 *
 * Field names mirror the server payload exactly — see server/src/events/fields.ts
 * — so there is no second mapping layer to keep in sync. Each function returns
 * a discriminated union so callers can handle success and every documented
 * server error without relying on try/catch alone.
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
 * Creates a draft event request (SG2-28).
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

export type SubmitResult =
  | { ok: true }
  | { ok: false; kind: 'missing'; missing: string[] }
  | { ok: false; kind: 'conflict' }
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'error'; message: string };

/**
 * Transitions an event request from `draft` (or `rejected`) → `submitted` (SG2-30).
 *
 * Maps to `PATCH /api/event-requests/:eventId/submit`.
 *
 * @param eventId   UUID of the event request to submit.
 * @param token     Bearer access token from the signed-in session.
 */
export async function submitEventRequest(
  eventId: string,
  token: string,
): Promise<SubmitResult> {
  let response: Response;

  try {
    response = await fetch(`/api/event-requests/${eventId}/submit`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }

  if (response.ok) {
    return { ok: true };
  }

  if (response.status === 400) {
    // Server returns { missing: string[] } listing which fields are incomplete.
    const data = await response.json().catch(() => ({}));
    return { ok: false, kind: 'missing', missing: Array.isArray(data.missing) ? data.missing : [] };
  }

  if (response.status === 409) {
    return { ok: false, kind: 'conflict' };
  }

  if (response.status === 503) {
    return { ok: false, kind: 'unavailable' };
  }

  const data = await response.json().catch(() => ({}));
  return { ok: false, kind: 'error', message: data.error ?? 'Submission failed. Please try again.' };
}

export type ListMyEventRequestsOutcome =
  | { ok: true; requests: EventRequestDraft[] }
  | { ok: false; message: string };

/**
 * Lists the caller's own event requests (SG2-32's minimal slice of SG2-31).
 *
 * @param token Bearer access token from the signed-in session.
 */
export async function listMyEventRequests(token: string): Promise<ListMyEventRequestsOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/event-requests', {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }

  if (!response.ok) {
    if (response.status === 401) return { ok: false, message: 'You are signed out. Sign in again to see your requests.' };
    if (response.status === 403) return { ok: false, message: 'Your role cannot view event requests.' };
    return { ok: false, message: UNAVAILABLE };
  }

  const body = await response.json().catch(() => null);
  if (!Array.isArray(body?.requests)) return { ok: false, message: UNAVAILABLE };
  return { ok: true, requests: body.requests as EventRequestDraft[] };
}

export type DeleteEventRequestDraftOutcome = { ok: true } | { ok: false; message: string };

/**
 * Deletes an event request while it is still a draft (SG2-32). Maps to
 * `DELETE /api/event-requests/:eventId`.
 *
 * @param eventId UUID of the event request to delete.
 * @param token   Bearer access token from the signed-in session.
 */
export async function deleteEventRequestDraft(
  eventId: string,
  token: string
): Promise<DeleteEventRequestDraftOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/event-requests/${eventId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }

  if (response.ok) return { ok: true };
  if (response.status === 401) return { ok: false, message: 'You are signed out. Sign in again to delete this draft.' };
  if (response.status === 403) return { ok: false, message: 'Your role cannot delete event requests.' };
  if (response.status === 404) return { ok: false, message: 'This draft no longer exists.' };
  if (response.status === 409) return { ok: false, message: 'Only a draft request can be deleted.' };
  return { ok: false, message: UNAVAILABLE };
}

export type UpdateDraftOutcome =
  | { ok: true; request: EventRequestDraft; missingForSubmission: string[] }
  | { ok: false; message: string; details?: string[] };

/**
 * Updates a draft's own fields while it is still a draft (SG2-29). Maps to
 * `PATCH /api/event-requests/:eventId`. Sends the complete current field
 * set as a full replace, same as createEventRequestDraft — the form holds
 * complete state client-side rather than tracking a diff.
 *
 * @param eventId UUID of the event request to update.
 * @param input   The complete current field values.
 * @param token   Bearer access token from the signed-in session.
 */
export async function updateEventRequestDraft(
  eventId: string,
  input: EventRequestDraftInput,
  token: string
): Promise<UpdateDraftOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/event-requests/${eventId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(input)
    });
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) return { ok: false, message: 'You are signed out. Sign in again to save this draft.' };
    if (response.status === 403) return { ok: false, message: 'Your role cannot edit event requests.' };
    if (response.status === 404) return { ok: false, message: 'This draft no longer exists.' };
    if (response.status === 409) return { ok: false, message: 'Only a draft request can be edited.' };
    return {
      ok: false,
      message: body?.error ?? `Could not save the draft (HTTP ${response.status}).`,
      details: body?.details
    };
  }

  if (!body?.request) {
    return { ok: false, message: UNAVAILABLE };
  }

  return {
    ok: true,
    request: body.request as EventRequestDraft,
    missingForSubmission: (body.missingForSubmission ?? []) as string[]
  };
}
