import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftValues } from '../events/fields';

/** An event request row as returned to the API caller. */
export interface EventRequestRecord extends DraftValues {
  can_manage?: boolean;
  event_id: number;
  organiser_id: string;
  organisation: string | null;
  status: string;
  coordinator_id?: string | null;
  coordinator_name?: string | null;
}

/** An event request row in summary format for list views (SG2-31). */
export interface EventRequestSummaryRecord {
  can_manage?: boolean;
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

export type DeleteDraftResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable'; message: string };

export type UpdateDraftResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'unavailable'; message: string };

export type AssignCoordinatorResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'not_found' | 'not_assignable' | 'unavailable'; message: string };

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

/** Shape shared by owner and organisation list reads. */
function summarizeEventRequest(row: Record<string, unknown>): EventRequestSummaryRecord {
  return {
    event_id: Number(row.event_id),
    name: typeof row.name === 'string' ? row.name : '',
    proposed_date: typeof row.proposed_date === 'string' ? row.proposed_date : null,
    status: typeof row.status === 'string' ? row.status : 'draft',
    coordinator_id: extractCoordinatorId(row),
    coordinator_name: extractCoordinatorName(row)
  };
}

/**
 * SG2-26: organisation membership is resolved afresh from trusted user data.
 * Blank or absent membership never groups unrelated users into a shared tenant.
 * Preserve the exact stored organisation: trimming is only an absence check.
 */
async function readMembership(admin: SupabaseClient, userId: string): Promise<OrganiserLookupResult> {
  const membership = await fetchOrganiserOrganisation(admin, userId);
  if (membership.ok && (typeof membership.organisation !== 'string' || !membership.organisation.trim())) {
    return { ok: false, reason: 'not_found', message: 'No client organisation for this account.' };
  }
  return membership;
}

/** Read colleagues' events without granting permission to change them. */
export async function fetchOrganisationEventRequests(
  admin: SupabaseClient,
  userId: string,
  statusFilter?: string,
  scope: 'organisation' | 'mine' = 'organisation'
): Promise<FetchEventRequestsResult> {
  const membership = await readMembership(admin, userId);
  if (!membership.ok) {
    return membership.reason === 'not_found' ? { ok: true, requests: [] }
      : { ok: false, reason: 'unavailable', message: membership.message };
  }

  let query = admin.from('events').select(`organiser_id, ${SUMMARY_COLUMNS}`)
    .eq('organisation', membership.organisation);
  if (scope === 'mine') query = query.eq('organiser_id', userId);
  if (statusFilter) query = query.eq('status', statusFilter);
  const { data, error } = await query.order('event_id', { ascending: false });
  if (error) return { ok: false, reason: 'unavailable', message: error.message };

  const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
  return { ok: true, requests: rows.map(row => ({
    ...summarizeEventRequest(row),
    can_manage: row.organiser_id === userId
  })) };
}

/** Organisation and event id are both constraints on the database read. */
export async function fetchOrganisationEventRequest(
  admin: SupabaseClient,
  eventId: number,
  userId: string
): Promise<FetchEventRequestResult> {
  const membership = await readMembership(admin, userId);
  if (!membership.ok) return membership;

  const { data, error } = await admin.from('events').select(DETAIL_COLUMNS)
    .eq('event_id', eventId).eq('organisation', membership.organisation);
  if (error) return { ok: false, reason: 'unavailable', message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'No event request found for this account.' };
  }
  const row = data[0] as unknown as Record<string, unknown>;
  return { ok: true, request: {
    ...(row as unknown as EventRequestRecord),
    coordinator_id: extractCoordinatorId(row),
    coordinator_name: extractCoordinatorName(row),
    can_manage: row.organiser_id === userId
  } };
}

/** Mutation precheck: both current organisation membership and creator ownership. */
export async function fetchManageableEventRequest(
  admin: SupabaseClient,
  eventId: number,
  userId: string
): Promise<FetchEventRequestResult> {
  const result = await fetchOrganisationEventRequest(admin, eventId, userId);
  if (!result.ok) return result;
  if (result.request.organiser_id !== userId) {
    return { ok: false, reason: 'not_found', message: 'No event request found for this account.' };
  }
  return result;
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
  const requests = rows.map(summarizeEventRequest);

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
 * Reads an event request by id, unscoped by organiser (SG2-33/SG2-34).
 *
 * Technical Support Staff act across every organisation, unlike
 * fetchOwnEventRequest's organiser-scoped lookup — there is no owning
 * caller to scope this to.
 */
export async function fetchEventRequestById(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchEventRequestResult> {
  const { data, error } = await admin.from('events').select(DETAIL_COLUMNS).eq('event_id', eventId);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'No event request found with that id.' };
  }
  const row = data[0] as unknown as Record<string, unknown>;
  const request: EventRequestRecord = {
    ...(row as unknown as EventRequestRecord),
    coordinator_id: extractCoordinatorId(row),
    coordinator_name: extractCoordinatorName(row)
  };
  return { ok: true, request };
}

/** Statuses a request may have its coordinator assigned or reassigned in (SG2-33/SG2-34). */
export const COORDINATOR_ASSIGNABLE_STATUSES = [
  'submitted',
  'under_review',
  'approved',
  'planning',
  'confirmed'
];

/**
 * Sets (SG2-33) or changes (SG2-34) an event request's coordinator.
 *
 * One function serves both tickets — assign-or-reassign is the same write,
 * whether `coordinator_id` was previously null or held a different
 * coordinator. `status` is repeated as a condition on the write itself
 * (not just a pre-check in the handler), matching the IDOR-hardening
 * pattern already used by deleteEventRequestDraft/updateEventRequestDraft:
 * if the request has moved to a non-assignable status by the time this
 * runs, zero rows come back rather than silently assigning a draft or a
 * closed-out request.
 */
export async function assignEventCoordinator(
  admin: SupabaseClient,
  eventId: number,
  coordinatorId: string
): Promise<AssignCoordinatorResult> {
  const { data, error } = await admin
    .from('events')
    .update({ coordinator_id: coordinatorId })
    .eq('event_id', eventId)
    .in('status', COORDINATOR_ASSIGNABLE_STATUSES)
    .select(DETAIL_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      reason: 'not_assignable',
      message: 'This event request cannot have a coordinator assigned in its current status.'
    };
  }
  const row = data[0] as unknown as Record<string, unknown>;
  const request: EventRequestRecord = {
    ...(row as unknown as EventRequestRecord),
    coordinator_id: extractCoordinatorId(row),
    coordinator_name: extractCoordinatorName(row)
  };
  return { ok: true, request };
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
