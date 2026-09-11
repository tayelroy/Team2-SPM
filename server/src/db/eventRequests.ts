import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftValues } from '../events/fields';

/** An event request row as returned to the API caller. */
export interface EventRequestRecord extends DraftValues {
  event_id: number;
  organiser_id: string;
  organisation: string | null;
  status: string;
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

export type SubmitEventRequestResult =
  | { ok: true; request: EventRequestRecord }
  | { ok: false; reason: 'unavailable'; message: string };

/** Columns returned for a created draft. */
const RETURNED_COLUMNS =
  'event_id, organiser_id, organisation, status, name, purpose, description, ' +
  'proposed_date, expected_attendance, venue_requirements, accessibility_needs, ' +
  'equipment_requirements, registration_needed';

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
 * Reads an event request scoped to its owning organiser (SG2-30).
 *
 * Scoping the lookup by `organiser_id` in the same query — rather than
 * fetching by `event_id` alone and comparing ownership afterwards — means a
 * request belonging to someone else is indistinguishable from one that does
 * not exist at all.
 */
export async function fetchOwnEventRequest(
  admin: SupabaseClient,
  eventId: number,
  organiserId: string
): Promise<FetchEventRequestResult> {
  const { data, error } = await admin
    .from('events')
    .select(RETURNED_COLUMNS)
    .eq('event_id', eventId)
    .eq('organiser_id', organiserId);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'No event request found for this account.' };
  }
  return { ok: true, request: data[0] as unknown as EventRequestRecord };
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
