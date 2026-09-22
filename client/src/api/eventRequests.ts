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
      return { ok: false, message: typeof body?.error === 'string' ? body.error : 'Your role cannot raise event requests.' };
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

export interface EventRequestSummary {
  eventId: number;
  name: string;
  proposedDate: string | null;
  status: string;
  coordinatorId: string | null;
  coordinatorName: string | null;
  canManage: boolean;
  waitingOnMe: boolean;
}

export interface EventRequestDetail {
  eventId: number;
  organiserId: string;
  organisation: string | null;
  status: string;
  name: string;
  purpose: string;
  description: string;
  proposedDate: string | null;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  equipmentRequirements: string | null;
  registrationNeeded: boolean;
  coordinatorId: string | null;
  coordinatorName: string | null;
  canManage: boolean;
  waitingOnMe: boolean;
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; kind: 'missing'; missing: string[] }
  | { ok: false; kind: 'conflict' }
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'error'; message: string };

export type FetchEventRequestsResult =
  | { ok: true; requests: EventRequestSummary[] }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'error'; message: string };

export type FetchEventDetailResult =
  | { ok: true; request: EventRequestDetail }
  | { ok: false; kind: 'not_found' }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'unavailable' }
  | { ok: false; kind: 'error'; message: string };

/**
 * Determines whether an event request is waiting on the organiser.
 *
 * Organisers must take action when a request is in `draft` (initial entry)
 * or `rejected` (needs revision). Other states (submitted, under_review,
 * confirmed, etc.) are locked or awaiting coordinator/system action.
 */
export function isWaitingOnOrganiser(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'draft' || normalized === 'rejected';
}

function mapEventRequestSummary(raw: Record<string, unknown>): EventRequestSummary {
  const status = typeof raw.status === 'string' ? raw.status : 'draft';
  return {
    eventId: Number(raw.event_id) || 0,
    name: typeof raw.name === 'string' ? raw.name : '',
    proposedDate: typeof raw.proposed_date === 'string' ? raw.proposed_date : null,
    status,
    coordinatorId: typeof raw.coordinator_id === 'string' ? raw.coordinator_id : null,
    coordinatorName: typeof raw.coordinator_name === 'string' ? raw.coordinator_name : null,
    canManage: raw.can_manage === true,
    waitingOnMe: raw.can_manage === true && isWaitingOnOrganiser(status),
  };
}

function mapEventRequestDetail(raw: Record<string, unknown>): EventRequestDetail {
  const status = typeof raw.status === 'string' ? raw.status : 'draft';
  return {
    eventId: Number(raw.event_id) || 0,
    organiserId: typeof raw.organiser_id === 'string' ? raw.organiser_id : '',
    organisation: typeof raw.organisation === 'string' ? raw.organisation : null,
    status,
    name: typeof raw.name === 'string' ? raw.name : '',
    purpose: typeof raw.purpose === 'string' ? raw.purpose : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    proposedDate: typeof raw.proposed_date === 'string' ? raw.proposed_date : null,
    expectedAttendance:
      raw.expected_attendance !== null && raw.expected_attendance !== undefined
        ? Number(raw.expected_attendance)
        : null,
    venueRequirements: typeof raw.venue_requirements === 'string' ? raw.venue_requirements : null,
    accessibilityNeeds: typeof raw.accessibility_needs === 'string' ? raw.accessibility_needs : null,
    equipmentRequirements:
      typeof raw.equipment_requirements === 'string' ? raw.equipment_requirements : null,
    registrationNeeded: Boolean(raw.registration_needed),
    coordinatorId: typeof raw.coordinator_id === 'string' ? raw.coordinator_id : null,
    coordinatorName: typeof raw.coordinator_name === 'string' ? raw.coordinator_name : null,
    canManage: raw.can_manage === true,
    waitingOnMe: raw.can_manage === true && isWaitingOnOrganiser(status),
  };
}

/**
 * Transitions an event request from `draft` (or `rejected`) → `submitted` (SG2-30).
 *
 * Maps to `PATCH /api/event-requests/:eventId/submit`.
 *
 * @param eventId   ID of the event request to submit.
 * @param token     Bearer access token from the signed-in session.
 */
export async function submitEventRequest(
  eventId: string | number,
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

/** Shared GET transport. Callers retain their own scope and failure messages. */
async function getEventRequestResponse(url: string, token: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
}

/** Keep unreadable JSON separate from each caller's payload-shape policy. */
function readEventRequestJson<T>(response: Response, fallback: T) {
  return response.json().catch(() => fallback);
}

/**
 * Fetches event requests in the authenticated organiser's organisation (SG2-31).
 *
 * Supports optional status filtering (e.g., 'draft', 'submitted').
 * When status is 'All' or empty/whitespace, no filter query parameter is sent.
 *
 * @param token   Bearer access token from the signed-in session.
 * @param status  Optional status filter string.
 */
export async function fetchOwnEventRequests(
  token: string,
  status?: string,
): Promise<FetchEventRequestsResult> {
  let url = '/api/event-requests';
  if (status) {
    const trimmed = status.trim().toLowerCase();
    if (trimmed && trimmed !== 'all') {
      url += `?status=${encodeURIComponent(trimmed)}`;
    }
  }

  const response = await getEventRequestResponse(url, token);
  if (!response) return { ok: false, kind: 'unavailable' };

  if (response.ok) {
    const data = await readEventRequestJson(response, {});
    const rawList = Array.isArray(data.requests) ? data.requests : [];
    const requests: EventRequestSummary[] = rawList.map(mapEventRequestSummary);
    return { ok: true, requests };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: 'unauthorized' };
  }

  if (response.status === 503) {
    return { ok: false, kind: 'unavailable' };
  }

  const data = await readEventRequestJson(response, {});
  return {
    ok: false,
    kind: 'error',
    message: typeof data.error === 'string' ? data.error : 'Failed to fetch event requests.',
  };
}

/**
 * Fetches full detail for a single event request in the caller's organisation (SG2-31).
 *
 * @param eventId  Event ID to look up.
 * @param token    Bearer access token from the signed-in session.
 */
export async function fetchOwnEventDetail(
  eventId: number | string,
  token: string,
): Promise<FetchEventDetailResult> {
  const response = await getEventRequestResponse(`/api/event-requests/${eventId}`, token);
  if (!response) return { ok: false, kind: 'unavailable' };

  if (response.ok) {
    const data = await readEventRequestJson(response, {});
    if (!data.request || typeof data.request !== 'object') {
      return { ok: false, kind: 'error', message: 'Invalid response format.' };
    }
    return {
      ok: true,
      request: mapEventRequestDetail(data.request as Record<string, unknown>),
    };
  }

  if (response.status === 404) {
    return { ok: false, kind: 'not_found' };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: 'unauthorized' };
  }

  if (response.status === 503) {
    return { ok: false, kind: 'unavailable' };
  }

  const data = await readEventRequestJson(response, {});
  return {
    ok: false,
    kind: 'error',
    message: typeof data.error === 'string' ? data.error : 'Failed to fetch event request detail.',
  };
}

/**
 * One row of the "My drafts" list. `GET /api/event-requests` (shared with
 * SG2-31's fuller list/detail views) only returns this summary shape, not
 * a full editable record — see fetchEventRequestDraft below for that.
 */
export interface DraftListItem {
  event_id: number;
  name: string;
  status: string;
}

export type ListMyEventRequestsOutcome =
  | { ok: true; requests: DraftListItem[] }
  | { ok: false; message: string };

/**
 * Lists the caller's own event requests (SG2-32's minimal slice of SG2-31).
 *
 * @param token Bearer access token from the signed-in session.
 */
export async function listMyEventRequests(token: string): Promise<ListMyEventRequestsOutcome> {
  const response = await getEventRequestResponse('/api/event-requests?scope=mine', token);
  if (!response) return { ok: false, message: UNAVAILABLE };

  if (!response.ok) {
    if (response.status === 401) return { ok: false, message: 'You are signed out. Sign in again to see your requests.' };
    if (response.status === 403) return { ok: false, message: 'Your role cannot view event requests.' };
    return { ok: false, message: UNAVAILABLE };
  }

  const body = await readEventRequestJson(response, null);
  if (!Array.isArray(body?.requests)) return { ok: false, message: UNAVAILABLE };
  return { ok: true, requests: body.requests as DraftListItem[] };
}

export type FetchEventRequestDraftOutcome =
  | { ok: true; request: EventRequestDraft }
  | { ok: false; message: string };

/**
 * Fetches the full editable fields of one of the caller's own event
 * requests. The list view only returns a summary (see listMyEventRequests
 * above) — opening the edit form needs the complete record, so this is
 * called on demand when "Edit" is clicked, via the same detail endpoint
 * SG2-31 added. Maps to `GET /api/event-requests/:eventId`.
 *
 * @param eventId Event ID to fetch.
 * @param token   Bearer access token from the signed-in session.
 */
export async function fetchEventRequestDraft(
  eventId: number | string,
  token: string
): Promise<FetchEventRequestDraftOutcome> {
  const response = await getEventRequestResponse(`/api/event-requests/${eventId}`, token);
  if (!response) return { ok: false, message: UNAVAILABLE };

  if (!response.ok) {
    if (response.status === 401) return { ok: false, message: 'You are signed out. Sign in again to edit this draft.' };
    if (response.status === 403) return { ok: false, message: 'Your role cannot view event requests.' };
    if (response.status === 404) return { ok: false, message: 'This draft no longer exists.' };
    return { ok: false, message: UNAVAILABLE };
  }

  const body = await readEventRequestJson(response, null);
  if (!body?.request) return { ok: false, message: UNAVAILABLE };
  return { ok: true, request: body.request as EventRequestDraft };
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

export interface StepperStep {
  key: string;
  label: string;
  status: 'completed' | 'current' | 'upcoming';
}

export interface EventWaitingOn {
  persona: string | null;
  action: string | null;
  user_id?: string | null;
}

export interface EventStageResult {
  event_id: number;
  raw_status: string;
  stage: string;
  stage_key: string;
  description: string;
  waiting_on: EventWaitingOn | null;
  stepper_steps: StepperStep[];
  arrangements_recheck_needed: boolean;
  outstanding_arrangements: string[];
}

export type GetEventStageOutcome =
  | { ok: true; stage: EventStageResult }
  | {
      ok: false;
      kind: 'unauthorized' | 'forbidden' | 'not_found' | 'unavailable' | 'error';
      message: string;
    };

/**
 * Retrieves the computed plain-language stage, stepper steps, and waiting-on persona
 * for an event (SG2-38). Maps to `GET /api/event-requests/:eventId/stage`.
 */
export async function getEventStage(
  eventId: string | number,
  token: string
): Promise<GetEventStageOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/event-requests/${eventId}/stage`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  } catch {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401) {
      return { ok: false, kind: 'unauthorized', message: body?.error ?? 'Authentication required' };
    }
    if (response.status === 403) {
      return { ok: false, kind: 'forbidden', message: body?.error ?? 'Access forbidden' };
    }
    if (response.status === 404) {
      return { ok: false, kind: 'not_found', message: body?.error ?? 'Event not found.' };
    }
    if (response.status === 503) {
      return { ok: false, kind: 'unavailable', message: body?.error ?? UNAVAILABLE };
    }
    return {
      ok: false,
      kind: 'error',
      message: body?.error ?? `Failed to fetch event stage (HTTP ${response.status}).`
    };
  }

  if (!body || typeof body !== 'object') {
    return { ok: false, kind: 'unavailable', message: UNAVAILABLE };
  }

  return { ok: true, stage: body as EventStageResult };
}

