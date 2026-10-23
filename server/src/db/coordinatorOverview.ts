import type { SupabaseClient } from '@supabase/supabase-js';
import { COORDINATOR_ASSIGNABLE_STATUSES } from './eventRequests';

/**
 * The statuses of an active event a Lead supervises (SG2-89 AC1): every
 * status a coordinator can be reassigned in except `unassigned`, which has no
 * coordinator and waits in the unassigned queue instead (SG2-87). It includes
 * `needs_clarification` (AC6).
 */
export const OVERSIGHT_STATUSES = COORDINATOR_ASSIGNABLE_STATUSES.filter(status => status !== 'unassigned');

/** One active event in a Lead's overview (SG2-89 AC1). */
export interface SupervisedEvent {
  event_id: number;
  name: string;
  organisation: string | null;
  status: string;
  proposed_date: string | null;
  coordinator_id: string;
  coordinator_name: string | null;
}

export type FetchSupervisedEventsResult =
  | { ok: true; events: SupervisedEvent[] }
  | { ok: false; reason: 'unavailable'; message: string };

export type FetchEventSupervisorResult =
  | { ok: true; supervisorId: string | null }
  | { ok: false; reason: 'unavailable'; message: string };

const COLUMNS = 'event_id, name, organisation, status, proposed_date, coordinator_id, coordinator:users!coordinator_id(name)';
const PAGE = 1000;

function coordinatorName(row: Record<string, unknown>): string | null {
  const joined = row.coordinator as Record<string, unknown> | null | undefined;
  return typeof joined?.name === 'string' ? joined.name : null;
}

/**
 * SG2-89 AC1: the active events the Lead supervises, meaning the events whose
 * coordinator they last assigned or reassigned, soonest first. Supabase caps a
 * response at 1,000 rows, so every page is read with a stable order rather
 * than silently dropping events from a busy Lead's overview.
 */
export async function fetchSupervisedEvents(admin: SupabaseClient, leadId: string): Promise<FetchSupervisedEventsResult> {
  const events: SupervisedEvent[] = [];
  let hasMore: boolean;
  do {
    const offset = events.length;
    const { data, error } = await admin
      .from('events')
      .select(COLUMNS)
      .eq('coordinator_assigned_by', leadId)
      .in('status', OVERSIGHT_STATUSES)
      .order('proposed_date', { ascending: true, nullsFirst: false })
      .order('event_id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return { ok: false, reason: 'unavailable', message: error.message };
    const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
    events.push(...rows.map(row => ({
      event_id: Number(row.event_id),
      name: typeof row.name === 'string' && row.name ? row.name : 'Untitled event',
      organisation: typeof row.organisation === 'string' ? row.organisation : null,
      status: String(row.status),
      proposed_date: typeof row.proposed_date === 'string' ? row.proposed_date : null,
      coordinator_id: String(row.coordinator_id),
      coordinator_name: coordinatorName(row)
    })));
    hasMore = rows.length === PAGE;
  } while (hasMore);
  return { ok: true, events };
}

/**
 * The Lead supervising one event, read before a reassignment so that an
 * assignment the history could not record is put back under the Lead who had
 * it (SG2-89 AC1). A missing event reads as unsupervised; the guarded write
 * that follows then matches nothing.
 */
export async function fetchEventSupervisor(admin: SupabaseClient, eventId: number): Promise<FetchEventSupervisorResult> {
  const { data, error } = await admin
    .from('events')
    .select('coordinator_assigned_by')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) return { ok: false, reason: 'unavailable', message: error.message };
  const supervisor = (data as { coordinator_assigned_by?: unknown } | null)?.coordinator_assigned_by;
  return { ok: true, supervisorId: typeof supervisor === 'string' ? supervisor : null };
}
