import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftValues, EventStatus } from '../events/fields';

/** An event request row as returned to the API caller. */
export interface EventRequestRecord extends DraftValues {
  can_manage?: boolean;
  event_id: number;
  organiser_id: string;
  organisation: string | null;
  status: string;
  coordinator_id?: string | null;
  coordinator_name?: string | null;
  /** How to reach the coordinator (SG2-33 AC3); only on single-request reads. */
  coordinator_phone?: string | null;
  /** Who decided, when, and why it was rejected (SG2-37). */
  decided_at?: string | null;
  decision_reason?: string | null;
  /** Who marked the event completed and when (SG2-100 AC4). */
  completed_by?: string | null;
  completed_at?: string | null;
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

/**
 * SG2-100 AC4. `previous_status` is the status the event held before
 * completion, so the caller can write a truthful audit row without a second
 * read; the guarded update is what established it.
 */
export type CompleteEventResult =
  | { ok: true; request: EventRequestRecord; previous_status: string }
  | { ok: false; reason: 'not_found' | 'not_finished' | 'unavailable'; message: string };

/**
 * A status move applied in the same write as a coordinator assignment
 * (SG2-100). `from` guards the write so the move cannot land on a row that
 * has since changed status; `to` is the value written.
 */
export interface AssignStatusTransition {
  from: EventStatus;
  to: EventStatus;
}

export type StartReviewResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

export type RequestClarificationResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

export type DecideEventRequestResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

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
  'equipment_requirements, registration_needed, coordinator_id, coordinator:users!coordinator_id(name, phone), ' +
  // SG2-37: the organiser sees the outcome and, for a rejection, why.
  'decided_at, decision_reason, ' +
  // SG2-100 AC4: who marked the event completed, and when.
  'completed_by, completed_at';

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

function extractCoordinatorPhone(row: Record<string, unknown>): string | null {
  const joined = Array.isArray(row.coordinator) ? row.coordinator[0] : row.coordinator;
  const phone = (joined as Record<string, unknown> | null | undefined)?.phone;
  return typeof phone === 'string' && phone.trim() ? phone : null;
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
    coordinator_phone: extractCoordinatorPhone(row),
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
    coordinator_name: extractCoordinatorName(row),
    coordinator_phone: extractCoordinatorPhone(row)
  };
  return { ok: true, request };
}

/** Statuses a row may transition from when submitted (SG2-30). */
const SUBMITTABLE_STATUSES = ['draft', 'rejected', 'needs_clarification'];

/** Statuses an organiser may still edit in (SG2-29, widened by SG2-36 so a
 * request returned with a question can be amended before resubmission). */
const EDITABLE_STATUSES = ['draft', 'needs_clarification'];

/**
 * Transitions an event request from `draft`, `rejected` or
 * `needs_clarification` to `unassigned` (SG2-30, retargeted by SG2-100).
 * Rejected requests may be revised and resubmitted rather than being a dead
 * end.
 *
 * SG2-100: submission now lands in `unassigned`, not `submitted`. The
 * organiser's request is visible as *Awaiting Assignment* until the Event
 * Coordinator Lead assigns a coordinator, which is what writes `submitted`.
 * That gives the assignment queue an indexable predicate instead of the old
 * `status = 'submitted' and coordinator_id is null` sniff.
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
    .update({ status: 'unassigned' })
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
 * Statuses a coordinator may open for review (SG2-35). `under_review` is
 * included so returning to a review already in progress is idempotent rather
 * than an error — reopening your own open review is ordinary behaviour.
 */
const REVIEWABLE_STATUSES = ['submitted', 'under_review'];

/**
 * Moves a request assigned to this coordinator to `under_review` (SG2-35).
 *
 * `coordinator_id` is a condition on the write itself rather than a
 * pre-check, matching the atomic-ownership shape the SG2-32 IDOR review
 * established: a request assigned to a different coordinator cannot be
 * touched by event id alone, even if a future caller skips the lookup.
 * Assignment is made by Technical Support Staff (SG2-33), never claimed
 * here, so an unassigned request matches zero rows and stays untouched.
 */
export async function startEventReview(
  admin: SupabaseClient,
  eventId: number,
  coordinatorId: string
): Promise<StartReviewResult> {
  const { data, error } = await admin
    .from('events')
    .update({ status: 'under_review' })
    .eq('event_id', eventId)
    .eq('coordinator_id', coordinatorId)
    .in('status', REVIEWABLE_STATUSES)
    .select(DETAIL_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    // Deliberately one reason for "not assigned to you", "not in a reviewable
    // status" and "does not exist": a coordinator must not be able to probe
    // for another coordinator's assignments by comparing responses.
    return { ok: false, reason: 'not_found', message: 'No reviewable event request is assigned to this account.' };
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
 * Records a coordinator's approval or rejection (SG2-37).
 *
 * Only a request this coordinator is actively reviewing can be decided, so
 * `coordinator_id` and `status = 'under_review'` are both conditions on the
 * write itself rather than pre-checks — the atomic-ownership shape from
 * SG2-32/SG2-35. That also settles a race: two coordinators cannot record
 * conflicting decisions, because whichever update lands second matches zero
 * rows once the status has moved on.
 *
 * `decided_by` and `decided_at` are written for every decision, not just
 * rejections, so no outcome is ever anonymous (AC3). The reason is the
 * caller's responsibility to require for rejections; the database enforces
 * it too (see events_rejection_requires_reason).
 */
export async function decideEventRequest(
  admin: SupabaseClient,
  eventId: number,
  coordinatorId: string,
  decision: 'approved' | 'rejected',
  reason: string | null
): Promise<DecideEventRequestResult> {
  const { data, error } = await admin
    .from('events')
    .update({
      status: decision,
      decided_by: coordinatorId,
      decided_at: new Date().toISOString(),
      decision_reason: reason
    })
    .eq('event_id', eventId)
    .eq('coordinator_id', coordinatorId)
    .eq('status', 'under_review')
    .select(DETAIL_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    // One answer for "not yours", "not under review" and "does not exist", so
    // another coordinator's assignments cannot be probed for.
    return { ok: false, reason: 'not_found', message: 'No event request under review is assigned to this account.' };
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
 * Returns a request to its organiser with a question (SG2-36).
 *
 * Only the coordinator actively reviewing a request may return it, so
 * `coordinator_id` and `status = 'under_review'` are both conditions on the
 * write itself rather than pre-checks — the atomic-ownership shape from
 * SG2-32/SG2-35/SG2-37. Two coordinators therefore cannot both park the same
 * request, and a request already decided cannot be pulled back.
 *
 * `needs_clarification` is a distinct status rather than a reuse of
 * `rejected`: the request is still live and the organiser is expected to
 * amend and resubmit it, which SG2-29's edit and SG2-30's submit both allow
 * from this status.
 */
export async function requestClarification(
  admin: SupabaseClient,
  eventId: number,
  coordinatorId: string
): Promise<RequestClarificationResult> {
  const { data, error } = await admin
    .from('events')
    .update({ status: 'needs_clarification' })
    .eq('event_id', eventId)
    .eq('coordinator_id', coordinatorId)
    .eq('status', 'under_review')
    .select(DETAIL_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    // One answer for "not yours", "not under review" and "does not exist", so
    // another coordinator's assignments cannot be probed for.
    return { ok: false, reason: 'not_found', message: 'No event request under review is assigned to this account.' };
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

/**
 * Statuses a request may have its coordinator assigned or reassigned in
 * (SG2-33/SG2-34, widened by SG2-100 to the Week 7 lifecycle).
 *
 * `unassigned` is the status submission now lands in, so it has to be here
 * or nothing would ever be assignable. The three post-arrangements statuses
 * are here because a coordinator can leave the team at any point in an
 * event's life and the replacement has to be recordable — reassignment is
 * allowed in every live status, and must never move the event's own status
 * (see assignEventCoordinator).
 */
export const COORDINATOR_ASSIGNABLE_STATUSES = [
  'unassigned',
  'submitted',
  'under_review',
  'approved',
  'planning',
  'awaiting_safety_check',
  'safety_rejected',
  'preparation',
  'confirmed'
];

/**
 * Sets (SG2-33) or changes (SG2-34) an event request's coordinator.
 *
 * One function serves both tickets — assign-or-reassign is the same write,
 * whether `coordinator_id` was previously null or held a different
 * coordinator. `status` is repeated as a condition on the write itself
 * (not just a pre-check in the handler), matching the IDOR-hardening
 * pattern already used by deleteEventRequestDraft/updateEventRequestDraft.
 *
 * `expectedCurrent` is the coordinator the caller read beforehand, and is
 * also a condition on the write: if another assignment landed in between,
 * zero rows come back instead of overwriting it, so the history entry the
 * caller writes next (SG2-33/34 AC4) always names the real previous
 * coordinator. Passing `coordinatorId: null` clears the assignment, which
 * is how an assignment that could not be recorded is undone.
 *
 * SG2-100: `statusTransition` moves the event's status in the same write.
 * The caller passes `{ from: 'unassigned', to: 'submitted' }` for a first
 * assignment, and the inverse to undo one whose history row could not be
 * written. When it is omitted — every reassignment of an event already in
 * review, arrangements, safety check, preparation or confirmed — the update
 * payload carries no `status` key at all, so no reassignment can rewind a
 * live event. `from` is a condition on the write rather than a pre-check,
 * so a row whose status moved on in between matches zero rows instead.
 */
export async function assignEventCoordinator(
  admin: SupabaseClient,
  eventId: number,
  coordinatorId: string | null,
  expectedCurrent: string | null,
  statusTransition?: AssignStatusTransition
): Promise<AssignCoordinatorResult> {
  const update: { coordinator_id: string | null; status?: EventStatus } = { coordinator_id: coordinatorId };
  if (statusTransition) update.status = statusTransition.to;
  const byEvent = admin.from('events').update(update).eq('event_id', eventId);
  const guarded = statusTransition
    ? byEvent.eq('status', statusTransition.from)
    : byEvent.in('status', COORDINATOR_ASSIGNABLE_STATUSES);
  const { data, error } = await (expectedCurrent === null
    ? guarded.is('coordinator_id', null)
    : guarded.eq('coordinator_id', expectedCurrent)
  ).select(DETAIL_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      reason: 'not_assignable',
      message: 'This event request is no longer assignable from the coordinator it was read with.'
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
    .in('status', EDITABLE_STATUSES)
    .select(RETURNED_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'unavailable', message: 'The draft was not returned after update.' };
  }
  return { ok: true, request: data[0] as unknown as EventRequestRecord };
}

/** A request Technical Support Staff can assign or reassign (SG2-33/34). */
export interface AssignableRequestRecord {
  event_id: number;
  name: string;
  organisation: string | null;
  status: string;
  coordinator_id: string | null;
  coordinator_name: string | null;
}

export type FetchAssignableRequestsResult =
  | { ok: true; requests: AssignableRequestRecord[] }
  | { ok: false; reason: 'unavailable'; message: string };

/**
 * Lists every request in a status a coordinator can be assigned to, across
 * all organisations — Technical Support Staff act on the whole platform, so
 * this is deliberately not organisation-scoped. Newest first.
 */
export async function fetchAssignableRequests(admin: SupabaseClient): Promise<FetchAssignableRequestsResult> {
  const { data, error } = await admin
    .from('events')
    .select('event_id, name, organisation, status, coordinator_id, coordinator:users!coordinator_id(name)')
    .in('status', COORDINATOR_ASSIGNABLE_STATUSES)
    .order('event_id', { ascending: false });

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
  return {
    ok: true,
    requests: rows.map(row => ({
      event_id: Number(row.event_id),
      name: typeof row.name === 'string' ? row.name : '',
      organisation: typeof row.organisation === 'string' ? row.organisation : null,
      status: typeof row.status === 'string' ? row.status : 'submitted',
      coordinator_id: extractCoordinatorId(row),
      coordinator_name: extractCoordinatorName(row)
    }))
  };
}

/**
 * Statuses an event can be marked completed from (SG2-100 AC4). An event is
 * only ever held once its arrangements are done, so `preparation` and
 * `confirmed` are the two live statuses an event can be in when its end
 * time passes. `approved`, `planning`, `cancelled` and `rejected` are not
 * here, which is what makes completing one of those a `not_found`.
 */
export const COMPLETABLE_STATUSES = ['preparation', 'confirmed'];

/**
 * Marks an event this coordinator is assigned to as completed (SG2-100 AC4).
 *
 * "The event's end time" is `max(venue_bookings.ends_at)` over the event's
 * confirmed bookings: `public.events` has no end-time column, an event may
 * occupy several venues, and the last booking ending is the real signal that
 * the event is over. An event with no confirmed booking has no end time to
 * have passed, so it fails closed as `not_finished` — never as finished.
 *
 * Ownership and status are checked before the clock so the only error a
 * coordinator can distinguish is the actionable one: "not yours / not
 * completable" and "does not exist" share a single `not_found`, while
 * `not_finished` is safe to disclose to the coordinator the event is
 * actually assigned to.
 *
 * Both guards are then repeated as conditions on the update itself, not only
 * as pre-checks — the IDOR-hardening shape from SG2-32/SG2-35. That is also
 * what makes a double-click idempotent (the second call matches zero rows
 * and reports `not_found`) and stops two coordinators racing one completion.
 */
export async function completeEvent(
  admin: SupabaseClient,
  eventId: number,
  coordinatorId: string,
  now: Date
): Promise<CompleteEventResult> {
  const existing = await admin
    .from('events')
    .select('event_id, status')
    .eq('event_id', eventId)
    .eq('coordinator_id', coordinatorId)
    .in('status', COMPLETABLE_STATUSES);

  if (existing.error) {
    return { ok: false, reason: 'unavailable', message: existing.error.message };
  }
  const found = (existing.data as Record<string, unknown>[] | null) ?? [];
  if (found.length === 0) {
    return { ok: false, reason: 'not_found', message: 'No completable event is assigned to this account.' };
  }
  const previousStatus = typeof found[0].status === 'string' ? found[0].status : '';

  const bookings = await admin
    .from('venue_bookings')
    .select('ends_at')
    .eq('event_id', eventId)
    .eq('status', 'confirmed')
    .order('ends_at', { ascending: false })
    .limit(1);

  if (bookings.error) {
    return { ok: false, reason: 'unavailable', message: bookings.error.message };
  }
  const latest = ((bookings.data as Record<string, unknown>[] | null) ?? [])[0]?.ends_at;
  const endsAt = typeof latest === 'string' ? Date.parse(latest) : NaN;
  if (!Number.isFinite(endsAt) || endsAt > now.getTime()) {
    return { ok: false, reason: 'not_finished', message: 'This event has not finished yet.' };
  }

  const { data, error } = await admin
    .from('events')
    .update({ status: 'completed', completed_by: coordinatorId, completed_at: now.toISOString() })
    .eq('event_id', eventId)
    .eq('coordinator_id', coordinatorId)
    .in('status', COMPLETABLE_STATUSES)
    .select(DETAIL_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
  if (rows.length === 0) {
    // The event moved on between the read and the write — a second
    // double-click, or another coordinator taking it over. One reason, so
    // neither can be told which.
    return { ok: false, reason: 'not_found', message: 'No completable event is assigned to this account.' };
  }
  const row = rows[0];
  const request: EventRequestRecord = {
    ...(row as unknown as EventRequestRecord),
    coordinator_id: extractCoordinatorId(row),
    coordinator_name: extractCoordinatorName(row)
  };
  return { ok: true, request, previous_status: previousStatus };
}
