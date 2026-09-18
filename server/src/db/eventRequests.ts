import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftValues } from '../events/fields';

/** An event request row as returned to the API caller. */
export interface EventRequestRecord extends DraftValues {
  event_id: number;
  organiser_id: string;
  organisation: string | null;
  status: string;
  coordinator_id?: string | null;
  coordinator_name?: string | null;
}

/** An event request row in summary format for list views (SG2-31). */
export interface EventRequestSummaryRecord {
  event_id: number;
  name: string;
  proposed_date: string | null;
  status: string;
  coordinator_id: string | null;
  coordinator_name: string | null;
}

export type OrganiserLookupResult =
  | { ok: true; organisation: string | null }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

export type CreateDraftResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'unavailable'; message: string };

export type FetchEventRequestResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

export type FetchEventRequestsResult =
  | { ok: true; requests: EventRequestSummaryRecord[] }
  | { ok: false; reason: 'unavailable'; message: string };

export type SubmitEventRequestResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'unavailable'; message: string };

export type ListOwnEventRequestsResult =
  | { ok: true; requests: EventRequestRecord[] }
  | { ok: false; reason: 'unavailable'; message: string };

export type DeleteDraftResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable'; message: string };

export type UpdateDraftResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'unavailable'; message: string };

/** Columns returned for a created draft. */
const RETURNED_COLUMNS =
  'event_id, organiser_id, organisation, status, name, purpose, description, ' +
  'proposed_date, expected_attendance, venue_requirements, accessibility_needs, ' +
  'equipment_requirements, registration_needed';

/** Columns returned for list summary views (SG2-31). */
const SUMMARY_COLUMNS =
  'event_id, name, proposed_date, status, coordinator_id, coordinator:users!coordinator_id(name)';

/** Columns returned for an event request detail lookup (SG2-31). */
const DETAIL_COLUMNS =
  'event_id, organiser_id, organisation, status, name, purpose, description, ' +
  'proposed_date, expected_attendance, venue_requirements, accessibility_needs, ' +
  'equipment_requirements, registration_needed, coordinator_id, coordinator:users!coordinator_id(name)';

function extractCoordinatorName(row: Record<string, unknown>): string | null {
  if ('coordinator' in row && row.coordinator) {
    if (Array.isArray(row.coordinator) && row.coordinator.length > 0) {
      const first = row.coordinator[0] as Record<string, unknown>;
      if (typeof first?.name === 'string') return first.name;
    } else if (typeof row.coordinator === 'object') {
      const coord = row.coordinator as Record<string, unknown>;
      if (typeof coord.name === 'string') return coord.name;
    }
  }
  if (typeof row.coordinator_name === 'string') {
    return row.coordinator_name;
  }
  return null;
}

function extractCoordinatorId(row: Record<string, unknown>): string | null {
  if (typeof row.coordinator_id === 'string') {
    return row.coordinator_id;
  }
  return null;
}

/**
 * Reads the organiser's own client organisation.
 *
 * SG2-28 requires a draft to belong to the caller's client organisation. That
 * value is read from their public.users row rather than accepted from the
 * request body, so a caller cannot file a request against another
 * organisation.
 */
export async function fetchOrganiserOrganisation(
  admin: SupabaseClient,
  userId: string
): Promise<OrganiserLookupResult> {
  const { data, error } = await admin.from('users').select('organisation').eq('user_id', userId);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'No user record for the signed-in account.' };
  }
  return { ok: true, organisation: (data[0] as { organisation: string | null }).organisation };
}

/**
 * Creates an event request in the `draft` state.
 *
 * `status` is set explicitly rather than relying on the column default, so the
 * starting state stays visible here and survives a change to that default.
 * `organiser_id` and `organisation` are supplied by the caller from verified
 * server-side values, never from client input.
 */
export async function insertEventRequestDraft(
  admin: SupabaseClient,
  draft: { organiserId: string; organisation: string | null; values: DraftValues }
): Promise<CreateDraftResult> {
  const { data, error } = await admin
    .from('events')
    .insert({
      ...draft.values,
      organiser_id: draft.organiserId,
      organisation: draft.organisation,
      status: 'draft'
    })
    .select(RETURNED_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'unavailable', message: 'The draft was not returned after insert.' };
  }
  // Cast through unknown: selecting an explicit column list leaves supabase-js
  // unable to infer the row shape, so it falls back to a string-error type.
  return { ok: true, request: data[0] as unknown as EventRequestRecord };
}

/**
 * Reads all event requests belonging to the organiser (SG2-31).
 *
 * Scoped by `organiser_id` so an organiser never sees events from another
 * tenant. Optionally filters by `status` if provided. Results are ordered by
 * `event_id` descending so the newest requests appear first. Coordinator
 * details are retrieved via foreign key join with public.users.
 */
export async function fetchOwnEventRequests(
  admin: SupabaseClient,
  organiserId: string,
  statusFilter?: string
): Promise<FetchEventRequestsResult> {
  let query = admin
    .from('events')
    .select(SUMMARY_COLUMNS)
    .eq('organiser_id', organiserId);

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query.order('event_id', { ascending: false });

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }

  const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
  const requests: EventRequestSummaryRecord[] = rows.map((row) => ({
    event_id: Number(row.event_id),
    name: typeof row.name === 'string' ? row.name : '',
    proposed_date: typeof row.proposed_date === 'string' ? row.proposed_date : null,
    status: typeof row.status === 'string' ? row.status : 'draft',
    coordinator_id: extractCoordinatorId(row),
    coordinator_name: extractCoordinatorName(row)
  }));

  return { ok: true, requests };
}

/**
 * Reads an event request scoped to its owning organiser (SG2-30, SG2-31).
 *
 * Scoping the lookup by `organiser_id` in the same query — rather than
 * fetching by `event_id` alone and comparing ownership afterwards — means a
 * request belonging to someone else is indistinguishable from one that does
 * not exist at all. Coordinator details are retrieved via foreign key join.
 */
export async function fetchOwnEventRequest(
  admin: SupabaseClient,
  eventId: number,
  organiserId: string
): Promise<FetchEventRequestResult> {
  const { data, error } = await admin
    .from('events')
    .select(DETAIL_COLUMNS)
    .eq('event_id', eventId)
    .eq('organiser_id', organiserId);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'No event request found for this account.' };
  }
  const row = data[0] as unknown as Record<string, unknown>;
  const request: EventRequestRecord = {
    ...(row as unknown as EventRequestRecord),
    coordinator_id: extractCoordinatorId(row),
    coordinator_name: extractCoordinatorName(row)
  };
  return { ok: true, request };
}

/** Statuses a row may transition from when submitted (SG2-30). */
const SUBMITTABLE_STATUSES = ['draft', 'rejected'];

/**
 * Transitions an event request from `draft` or `rejected` to `submitted`
 * (SG2-30). Rejected requests may be revised and resubmitted rather than
 * being a dead end.
 *
 * The status filter is repeated here as a second guard alongside the
 * caller's own status check, so a concurrent submission cannot race two
 * requests through at once: whichever update loses the race matches zero
 * rows and reports unavailable rather than silently double-submitting.
 */
export async function submitEventRequest(
  admin: SupabaseClient,
  eventId: number
): Promise<SubmitEventRequestResult> {
  const { data, error } = await admin
    .from('events')
    .update({ status: 'submitted' })
    .eq('event_id', eventId)
    .in('status', SUBMITTABLE_STATUSES)
    .select(RETURNED_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'unavailable', message: 'The request was not returned after update.' };
  }
  return { ok: true, request: data[0] as unknown as EventRequestRecord };
}

/**
 * Lists every event request belonging to the caller (SG2-32's minimal slice
 * of SG2-31 — enough to see and act on your own requests, not the full "see
 * the state of my requests" feature).
 */
export async function listOwnEventRequests(
  admin: SupabaseClient,
  organiserId: string
): Promise<ListOwnEventRequestsResult> {
  const { data, error } = await admin
    .from('events')
    .select(RETURNED_COLUMNS)
    .eq('organiser_id', organiserId)
    .order('event_id', { ascending: false });

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  return { ok: true, requests: (data ?? []) as unknown as EventRequestRecord[] };
}

/**
 * Deletes an event request, but only while it is the caller's own and still
 * a draft (SG2-32).
 *
 * Callers already check ownership and status via fetchOwnEventRequest first
 * — the same shape submitEventRequestHandler uses (SG2-30) — but
 * `organiser_id` is repeated here as a condition on the write itself, not
 * just relied on as a pre-check: an AI security review flagged that a
 * caller of this function skipping, reordering, or losing that pre-check
 * would otherwise let the delete reach any organiser's row by id alone
 * (IDOR). `status = 'draft'` is repeated for the same reason and the
 * additional race-safety already documented: if either condition no longer
 * holds by the time this runs, zero rows come back and this reports
 * unavailable rather than silently deleting the wrong thing or nothing.
 */
export async function deleteEventRequestDraft(
  admin: SupabaseClient,
  eventId: number,
  organiserId: string
): Promise<DeleteDraftResult> {
  const { data, error } = await admin
    .from('events')
    .delete()
    .eq('event_id', eventId)
    .eq('organiser_id', organiserId)
    .eq('status', 'draft')
    .select('event_id');

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'unavailable', message: 'The draft was not deleted; its status may have changed.' };
  }
  return { ok: true };
}

/**
 * Updates a draft's own fields (SG2-29), but only while it is the caller's
 * own and still a draft — `organiser_id` and `status = 'draft'` are both
 * conditions on the write itself, not just the caller's own pre-check (see
 * deleteEventRequestDraft's comment; the same AI security review flagged
 * the same gap here). If either no longer holds, zero rows come back and
 * this reports unavailable rather than silently editing the wrong request
 * or one that has moved on.
 */
export async function updateEventRequestDraft(
  admin: SupabaseClient,
  eventId: number,
  organiserId: string,
  values: DraftValues
): Promise<UpdateDraftResult> {
  const { data, error } = await admin
    .from('events')
    .update(values)
    .eq('event_id', eventId)
    .eq('organiser_id', organiserId)
    .eq('status', 'draft')
    .select(RETURNED_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'unavailable', message: 'The draft was not returned after update.' };
  }
  return { ok: true, request: data[0] as unknown as EventRequestRecord };
}
