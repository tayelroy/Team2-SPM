import type { SupabaseClient } from '@supabase/supabase-js';

export interface EventPlanningRecord {
  event_id: number;
  status: string;
  coordinator_id: string | null;
  coordinator_name?: string | null;
  organiser_id: string;
  expected_attendance: number | null;
  proposed_date: string | null;
  venue_requirements: string | null;
  accessibility_needs: string | null;
  equipment_requirements: string | null;
  registration_needed: boolean | null;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  planning_notes: string | null;
  arrangements_recheck_needed: boolean;
  outstanding_arrangements: string[];
}

export interface UpdatePlanningFieldsInput {
  expected_attendance?: number | null;
  proposed_date?: string | null;
  venue_requirements?: string | null;
  accessibility_needs?: string | null;
  equipment_requirements?: string | null;
  registration_needed?: boolean | null;
  registration_capacity?: number | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  planning_notes?: string | null;
  arrangements_recheck_needed?: boolean;
  outstanding_arrangements?: string[];
  status?: string;
}

export type FetchEventPlanningResult =
  | { ok: true; event: EventPlanningRecord }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

export type UpdateEventPlanningResult =
  | { ok: true; event: EventPlanningRecord }
  | { ok: false; reason: 'not_found' | 'unavailable'; message: string };

const PLANNING_SELECT_COLUMNS =
  'event_id, status, coordinator_id, organiser_id, expected_attendance, proposed_date, ' +
  'venue_requirements, accessibility_needs, equipment_requirements, registration_needed, ' +
  'registration_capacity, registration_opens_at, registration_closes_at, planning_notes, ' +
  'arrangements_recheck_needed, outstanding_arrangements, coordinator:users!coordinator_id(name)';

const PLANNING_UPDATE_COLUMNS =
  'event_id, status, coordinator_id, organiser_id, expected_attendance, proposed_date, ' +
  'venue_requirements, accessibility_needs, equipment_requirements, registration_needed, ' +
  'registration_capacity, registration_opens_at, registration_closes_at, planning_notes, ' +
  'arrangements_recheck_needed, outstanding_arrangements';

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

/**
 * Fetches planning and arrangement details for a specific event.
 */
export async function fetchEventPlanningRecord(
  client: SupabaseClient,
  eventId: number
): Promise<FetchEventPlanningResult> {
  const { data, error } = await client
    .from('events')
    .select(PLANNING_SELECT_COLUMNS)
    .eq('event_id', eventId);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }

  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'Event not found.' };
  }

  const row = data[0] as any;
  return {
    ok: true,
    event: {
      ...row,
      coordinator_name: extractCoordinatorName(row),
      outstanding_arrangements: Array.isArray(row.outstanding_arrangements)
        ? row.outstanding_arrangements
        : []
    }
  };
}

/**
 * Updates planning fields for an event.
 */
export async function updateEventPlanningFields(
  admin: SupabaseClient,
  eventId: number,
  fields: UpdatePlanningFieldsInput
): Promise<UpdateEventPlanningResult> {
  const { data, error } = await admin
    .from('events')
    .update(fields)
    .eq('event_id', eventId)
    .select(PLANNING_UPDATE_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }

  if (!data || data.length === 0) {
    return { ok: false, reason: 'not_found', message: 'Event not found.' };
  }

  const row = data[0] as any;
  return {
    ok: true,
    event: {
      ...row,
      outstanding_arrangements: Array.isArray(row.outstanding_arrangements)
        ? row.outstanding_arrangements
        : []
    }
  };
}
