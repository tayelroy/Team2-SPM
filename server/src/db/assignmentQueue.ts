import type { SupabaseClient } from '@supabase/supabase-js';

/** One request waiting for the Event Coordinator Lead to assign it (SG2-87). */
export interface UnassignedQueueEntry {
  event_id: number;
  name: string;
  organiser_name: string | null;
  proposed_date: string | null;
  expected_attendance: number | null;
  submitted_at: string | null;
}

export type FetchUnassignedQueueResult =
  | { ok: true; entries: UnassignedQueueEntry[] }
  | { ok: false; reason: 'unavailable'; message: string };

const QUEUE_COLUMNS =
  'event_id, name, proposed_date, expected_attendance, submitted_at, organiser:users!organiser_id(name)';

function organiserName(row: Record<string, unknown>): string | null {
  const joined = row.organiser as Record<string, unknown> | null | undefined;
  return typeof joined?.name === 'string' ? joined.name : null;
}

/**
 * The unassigned queue (SG2-87): every submitted request that no coordinator
 * holds yet, across all organisations, oldest submission first. Assigning a
 * coordinator sets `coordinator_id`, so an event leaves the queue by that
 * write alone (AC5). Requests submitted before `submitted_at` existed sort last.
 */
export async function fetchUnassignedQueue(admin: SupabaseClient): Promise<FetchUnassignedQueueResult> {
  const { data, error } = await admin
    .from('events')
    .select(QUEUE_COLUMNS)
    .eq('status', 'submitted')
    .is('coordinator_id', null)
    .order('submitted_at', { ascending: true, nullsFirst: false })
    .order('event_id', { ascending: true });

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
  return {
    ok: true,
    entries: rows.map(row => ({
      event_id: Number(row.event_id),
      name: typeof row.name === 'string' ? row.name : '',
      organiser_name: organiserName(row),
      proposed_date: typeof row.proposed_date === 'string' ? row.proposed_date : null,
      expected_attendance: typeof row.expected_attendance === 'number' ? row.expected_attendance : null,
      submitted_at: typeof row.submitted_at === 'string' ? row.submitted_at : null
    }))
  };
}
