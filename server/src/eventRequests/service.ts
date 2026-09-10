import type { SupabaseClient } from '@supabase/supabase-js';
import { EventRequestFields, validateEventRequestForSubmission } from './validation';

export type EventRequestStatus = 'draft' | 'submitted';

export interface EventRequestRecord extends EventRequestFields {
  id: string;
  organiserId: string;
  status: EventRequestStatus;
  submittedAt: string | null;
}

interface EventRequestRow {
  id: string;
  organiser_id: string;
  status: EventRequestStatus;
  event_name: string | null;
  purpose: string | null;
  description: string | null;
  proposed_date_time: string | null;
  expected_attendance: number | null;
  venue_requirements: string | null;
  equipment_requirements: string | null;
  registration_needed: boolean | null;
  accessibility_needs: string | null;
  submitted_at: string | null;
}

function toRecord(row: EventRequestRow): EventRequestRecord {
  return {
    id: row.id,
    organiserId: row.organiser_id,
    status: row.status,
    eventName: row.event_name ?? undefined,
    purpose: row.purpose ?? undefined,
    description: row.description ?? undefined,
    proposedDateTime: row.proposed_date_time ?? undefined,
    expectedAttendance: row.expected_attendance ?? undefined,
    venueRequirements: row.venue_requirements ?? undefined,
    equipmentRequirements: row.equipment_requirements ?? undefined,
    registrationNeeded: row.registration_needed ?? undefined,
    accessibilityNeeds: row.accessibility_needs ?? null,
    submittedAt: row.submitted_at
  };
}

function toRow(fields: Partial<EventRequestFields>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if ('eventName' in fields) row.event_name = fields.eventName;
  if ('purpose' in fields) row.purpose = fields.purpose;
  if ('description' in fields) row.description = fields.description;
  if ('proposedDateTime' in fields) row.proposed_date_time = fields.proposedDateTime;
  if ('expectedAttendance' in fields) row.expected_attendance = fields.expectedAttendance;
  if ('venueRequirements' in fields) row.venue_requirements = fields.venueRequirements;
  if ('equipmentRequirements' in fields) row.equipment_requirements = fields.equipmentRequirements;
  if ('registrationNeeded' in fields) row.registration_needed = fields.registrationNeeded;
  if ('accessibilityNeeds' in fields) row.accessibility_needs = fields.accessibilityNeeds;
  return row;
}

const UNAVAILABLE_MESSAGE = 'Event requests are temporarily unavailable. Please try again later.';

export type CreateDraftResult =
  | { outcome: 'created'; request: EventRequestRecord }
  | { outcome: 'unavailable'; message: string };

/** Creates a new draft event request (SG2-28/29 fields, SG2-30 lifecycle start). */
export async function createEventRequestDraft(
  admin: SupabaseClient,
  organiserId: string,
  fields: Partial<EventRequestFields> = {}
): Promise<CreateDraftResult> {
  const { data, error } = await admin
    .from('event_requests')
    .insert({ organiser_id: organiserId, status: 'draft', ...toRow(fields) })
    .select('*')
    .single();

  if (error || !data) {
    return { outcome: 'unavailable', message: error?.message ?? UNAVAILABLE_MESSAGE };
  }
  return { outcome: 'created', request: toRecord(data as EventRequestRow) };
}

export type FindEventRequestResult =
  | { outcome: 'found'; request: EventRequestRecord }
  | { outcome: 'not_found' }
  | { outcome: 'unavailable'; message: string };

async function findOwnedRequest(
  admin: SupabaseClient,
  organiserId: string,
  id: string
): Promise<FindEventRequestResult> {
  const { data, error } = await admin
    .from('event_requests')
    .select('*')
    .eq('id', id)
    .eq('organiser_id', organiserId)
    .maybeSingle();

  if (error) return { outcome: 'unavailable', message: error.message };
  if (!data) return { outcome: 'not_found' };
  return { outcome: 'found', request: toRecord(data as EventRequestRow) };
}

/** Looks up a single event request, scoped to the organiser who owns it. */
export async function getEventRequestForOrganiser(
  admin: SupabaseClient,
  organiserId: string,
  id: string
): Promise<FindEventRequestResult> {
  return findOwnedRequest(admin, organiserId, id);
}

export type UpdateDraftResult =
  | { outcome: 'updated'; request: EventRequestRecord }
  | { outcome: 'not_found' }
  | { outcome: 'locked' }
  | { outcome: 'unavailable'; message: string };

/**
 * Edits a draft's fields. Refuses once the request has been submitted
 * (SG2-30 AC3) — changes after submission are handled separately (SG2-64).
 */
export async function updateEventRequestDraft(
  admin: SupabaseClient,
  organiserId: string,
  id: string,
  patch: Partial<EventRequestFields>
): Promise<UpdateDraftResult> {
  const existing = await findOwnedRequest(admin, organiserId, id);
  if (existing.outcome !== 'found') return existing;
  if (existing.request.status !== 'draft') return { outcome: 'locked' };

  const { data, error } = await admin
    .from('event_requests')
    .update(toRow(patch))
    .eq('id', id)
    .eq('organiser_id', organiserId)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();

  if (error) return { outcome: 'unavailable', message: error.message };
  // The status guard can lose a race against a concurrent submit between the
  // read above and this write; that isn't a lookup failure, it's the lock.
  if (!data) return { outcome: 'locked' };
  return { outcome: 'updated', request: toRecord(data as EventRequestRow) };
}

export type SubmitEventRequestResult =
  | { outcome: 'submitted'; request: EventRequestRecord }
  | { outcome: 'invalid'; missingFields: string[] }
  | { outcome: 'not_found' }
  | { outcome: 'already_submitted' }
  | { outcome: 'unavailable'; message: string };

/**
 * Submits a draft (SG2-30 AC1/AC2): refuses with the outstanding mandatory
 * fields when incomplete, otherwise transitions draft -> submitted.
 */
export async function submitEventRequest(
  admin: SupabaseClient,
  organiserId: string,
  id: string
): Promise<SubmitEventRequestResult> {
  const existing = await findOwnedRequest(admin, organiserId, id);
  if (existing.outcome === 'not_found') return existing;
  if (existing.outcome === 'unavailable') return existing;
  if (existing.request.status !== 'draft') return { outcome: 'already_submitted' };

  const validation = validateEventRequestForSubmission(existing.request);
  if (!validation.ok) return { outcome: 'invalid', missingFields: validation.missingFields };

  const { data, error } = await admin
    .from('event_requests')
    .update({ status: 'submitted', submitted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('organiser_id', organiserId)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle();

  if (error) return { outcome: 'unavailable', message: error.message };
  if (!data) return { outcome: 'already_submitted' };
  return { outcome: 'submitted', request: toRecord(data as EventRequestRow) };
}
