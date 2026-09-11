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
