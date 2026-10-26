import type { SupabaseClient } from '@supabase/supabase-js';
import { isRecheckKey, type RecheckKey } from '../events/changeImpact';

/**
 * SG2-93: venue booking requests and equipment requests a Request Changes
 * safety decision sent back to Venue Staff or Technical Support
 * (`public.safety_rereviews`, readable only with the service role).
 */
export type SafetyRereviewArrangement = 'venue' | 'equipment';

/** One flag on an event, open or resolved (AC5). */
export interface SafetyRereview {
  review_id: number;
  decision_id: number;
  arrangement: SafetyRereviewArrangement;
  /** "Regression Hall (10 Jul 2030 10:00 – 14:00 SGT)" or "4 × Wireless microphones". */
  label: string;
  flagged_at: string;
  resolution: 'confirmed' | 'withdrawn' | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
}

/** One open flag in a staff member's list (AC2). */
export interface SafetyRereviewQueueItem {
  review_id: number;
  arrangement: SafetyRereviewArrangement;
  event_id: number;
  event_name: string | null;
  proposed_date: string | null;
  coordinator_name: string | null;
  flagged_at: string;
  label: string;
  reason: string | null;
  decided_by_name: string | null;
  layout: string | null;
  placement_venue_name: string | null;
  placement_position: string | null;
}

export type ListEventSafetyRereviewsResult = { ok: true; rereviews: SafetyRereview[] } | { ok: false };
export type ListSafetyRereviewQueueResult = { ok: true; items: SafetyRereviewQueueItem[] } | { ok: false };

export type ConfirmSafetyRereviewResult =
  | { outcome: 'ok'; review_id: number; event_id: number; status: string; outstanding_arrangements: RecheckKey[] }
  | { outcome: 'closed'; resolution: 'confirmed' | 'withdrawn' }
  | { outcome: 'missing' }
  | { outcome: 'forbidden' }
  | { outcome: 'unavailable' };

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const isArrangement = (value: unknown): value is SafetyRereviewArrangement => value === 'venue' || value === 'equipment';

/** Every flag on the event (newest decision first, each decision's flags in
 * the order made) through `public.event_safety_rereviews`. */
export async function listEventSafetyRereviews(admin: SupabaseClient, eventId: number): Promise<ListEventSafetyRereviewsResult> {
  const { data, error } = await admin.rpc('event_safety_rereviews', { p_event_id: eventId });
  if (error || !Array.isArray(data)) return { ok: false };
  return {
    ok: true,
    rereviews: (data as Row[]).flatMap((row) => {
      // A row outside the vocabulary cannot be stored (check constraints); skip it rather than guess.
      if (!isArrangement(row.arrangement) || typeof row.label !== 'string') return [];
      const resolution = row.resolution === 'confirmed' || row.resolution === 'withdrawn' ? row.resolution : null;
      return [{
        review_id: Number(row.review_id), decision_id: Number(row.decision_id), arrangement: row.arrangement,
        label: row.label, flagged_at: String(row.flagged_at), resolution,
        resolved_by_name: text(row.resolved_by_name), resolved_at: text(row.resolved_at)
      }];
    })
  };
}

/** The open flags of one kind, oldest first, through `public.safety_rereview_queue`. */
export async function listSafetyRereviewQueue(
  admin: SupabaseClient,
  arrangement: SafetyRereviewArrangement
): Promise<ListSafetyRereviewQueueResult> {
  const { data, error } = await admin.rpc('safety_rereview_queue', { p_arrangement: arrangement });
  if (error || !Array.isArray(data)) return { ok: false };
  return {
    ok: true,
    items: (data as Row[]).flatMap((row) => {
      if (!isArrangement(row.arrangement) || typeof row.label !== 'string') return [];
      return [{
        review_id: Number(row.review_id), arrangement: row.arrangement, event_id: Number(row.event_id),
        event_name: text(row.event_name), proposed_date: text(row.proposed_date), coordinator_name: text(row.coordinator_name),
        flagged_at: String(row.flagged_at), label: row.label, reason: text(row.reason), decided_by_name: text(row.decided_by_name),
        layout: text(row.layout), placement_venue_name: text(row.placement_venue_name), placement_position: text(row.placement_position)
      }];
    })
  };
}

/**
 * Confirms one flag again through `public.confirm_safety_rereview` (service
 * role) as the verified actor acting as `actingRole`. When it was the last
 * flag of its kind, the change it belonged to is settled in the same
 * transaction, and the event may already be back in Awaiting Safety Check.
 */
export async function confirmSafetyRereview(
  admin: SupabaseClient,
  reviewId: number,
  actorId: string,
  actingRole: string
): Promise<ConfirmSafetyRereviewResult> {
  const { data, error } = await admin.rpc('confirm_safety_rereview', {
    p_review_id: reviewId,
    p_actor_id: actorId,
    p_acting_role: actingRole
  });
  if (error || typeof data !== 'object' || data === null) return { outcome: 'unavailable' };
  const row = data as Row;
  if (row.outcome === 'missing' || row.outcome === 'forbidden') return { outcome: row.outcome };
  if (row.outcome === 'closed' && (row.resolution === 'confirmed' || row.resolution === 'withdrawn')) {
    return { outcome: 'closed', resolution: row.resolution };
  }
  const outstanding = row.outstanding_arrangements;
  if (row.outcome !== 'ok' || typeof row.status !== 'string' || !Array.isArray(outstanding)
    || !outstanding.every(key => typeof key === 'string' && isRecheckKey(key))) {
    return { outcome: 'unavailable' };
  }
  return {
    outcome: 'ok', review_id: Number(row.review_id), event_id: Number(row.event_id), status: row.status,
    outstanding_arrangements: outstanding as RecheckKey[]
  };
}
