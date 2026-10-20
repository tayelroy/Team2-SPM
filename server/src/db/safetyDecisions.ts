import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isSafetyArrangement,
  isSafetyDecision,
  type SafetyArrangement,
  type SafetyDecisionInput,
  type SafetyDecisionKind
} from '../events/safetyDecisions';

/** One recorded safety check decision (SG2-92 AC6), as the API returns it. */
export interface SafetyDecisionRecord {
  decision_id: number;
  event_id: number;
  decision: SafetyDecisionKind;
  reason: string | null;
  arrangements: SafetyArrangement[];
  decided_by: string;
  decided_by_name: string | null;
  decided_at: string;
}

/** Who may read an event's decisions: its organiser and assigned coordinator. */
export interface SafetyDecisionEvent {
  event_id: number;
  status: string;
  organiser_id: string | null;
  coordinator_id: string | null;
}

export type FetchSafetyDecisionEventResult =
  | { ok: true; event: SafetyDecisionEvent }
  | { ok: false; reason: 'not_found' | 'unavailable' };

export type ListSafetyDecisionsResult =
  | { ok: true; decisions: SafetyDecisionRecord[] }
  | { ok: false };

/** What `public.record_safety_decision` did (SG2-92 AC1–AC6). */
export type RecordSafetyDecisionResult =
  | {
    outcome: 'ok';
    decision_id: number;
    decision: SafetyDecisionKind;
    previous_status: string;
    status: string;
    decided_at: string;
  }
  | { outcome: 'forbidden' | 'missing' | 'invalid' | 'unavailable' }
  /** The event changed after the Safety Officer opened it (SG2-91's revision moved on). */
  | { outcome: 'stale'; revision: number }
  | { outcome: 'closed'; status: string };

/** What `public.rework_safety_rejected_event` did (SG2-92 AC4). */
export type ReworkSafetyRejectedEventResult =
  | { outcome: 'ok'; status: 'planning' }
  | { outcome: 'missing' | 'unavailable' }
  | { outcome: 'closed'; status: string };

export interface RecordSafetyDecisionInput extends SafetyDecisionInput {
  eventId: number;
  actorId: string;
}

/** Service-role read; the route decides who may see the event's decisions. */
export async function fetchSafetyDecisionEvent(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchSafetyDecisionEventResult> {
  const { data, error } = await admin.from('events').select('event_id, status, organiser_id, coordinator_id')
    .eq('event_id', eventId).maybeSingle();
  if (error) return { ok: false, reason: 'unavailable' };
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, event: data as SafetyDecisionEvent };
}

interface DecisionRow {
  decision_id: number;
  event_id: number;
  decision: string;
  reason: string | null;
  arrangements: unknown;
  decided_by: string;
  decided_at: string;
}

/**
 * Every decision on the event, newest first, with the name of who made it
 * (AC6). The table is readable only with the service role.
 */
export async function listSafetyDecisions(admin: SupabaseClient, eventId: number): Promise<ListSafetyDecisionsResult> {
  const rows = await admin.from('event_safety_decisions')
    .select('decision_id, event_id, decision, reason, arrangements, decided_by, decided_at')
    .eq('event_id', eventId)
    .order('decided_at', { ascending: false })
    .order('decision_id', { ascending: false });
  if (rows.error) return { ok: false };
  const decisions = (rows.data ?? []) as DecisionRow[];
  const names = new Map<string, string>();
  const deciders = [...new Set(decisions.map(row => row.decided_by))];
  if (deciders.length > 0) {
    const users = await admin.from('users').select('user_id, name').in('user_id', deciders);
    if (users.error) return { ok: false };
    for (const user of (users.data ?? []) as { user_id: string; name: string }[]) names.set(user.user_id, user.name);
  }
  return {
    ok: true,
    decisions: decisions.flatMap(row => {
      const arrangements = Array.isArray(row.arrangements) ? row.arrangements : [];
      // A row outside the vocabulary cannot be stored (check constraints); skip it rather than guess.
      if (!isSafetyDecision(row.decision) || !arrangements.every(isSafetyArrangement)) return [];
      return [{
        decision_id: Number(row.decision_id), event_id: Number(row.event_id), decision: row.decision, reason: row.reason,
        arrangements, decided_by: row.decided_by, decided_by_name: names.get(row.decided_by) ?? null, decided_at: row.decided_at
      }];
    })
  };
}

/**
 * Records a decision through `public.record_safety_decision` (service role):
 * the decision, the status move, its history and the notices are one
 * transaction under the event row lock. The function rechecks the actor is a
 * Safety Officer, the event is still awaiting a check at the revision the
 * Safety Officer reviewed, and the input is valid.
 */
export async function recordSafetyDecision(
  admin: SupabaseClient,
  input: RecordSafetyDecisionInput
): Promise<RecordSafetyDecisionResult> {
  const { data, error } = await admin.rpc('record_safety_decision', {
    p_event_id: input.eventId,
    p_actor_id: input.actorId,
    p_decision: input.decision,
    p_reason: input.reason,
    p_arrangements: input.arrangements,
    p_expected_revision: input.expectedRevision
  });
  if (error || typeof data !== 'object' || data === null) return { outcome: 'unavailable' };
  const row = data as Record<string, unknown>;
  if (row.outcome === 'forbidden' || row.outcome === 'missing' || row.outcome === 'invalid') return { outcome: row.outcome };
  if (row.outcome === 'closed' && typeof row.status === 'string') return { outcome: 'closed', status: row.status };
  if (row.outcome === 'stale' && typeof row.revision === 'number') return { outcome: 'stale', revision: row.revision };
  if (row.outcome !== 'ok' || typeof row.decision_id !== 'number' || !isSafetyDecision(row.decision)
    || typeof row.previous_status !== 'string' || typeof row.status !== 'string' || typeof row.decided_at !== 'string') {
    return { outcome: 'unavailable' };
  }
  return { outcome: 'ok', decision_id: row.decision_id, decision: row.decision, previous_status: row.previous_status,
    status: row.status, decided_at: row.decided_at };
}

/** Takes a Safety Rejected event back to Planning through `public.rework_safety_rejected_event`. */
export async function reworkSafetyRejectedEvent(
  admin: SupabaseClient,
  eventId: number,
  actorId: string
): Promise<ReworkSafetyRejectedEventResult> {
  const { data, error } = await admin.rpc('rework_safety_rejected_event', { p_event_id: eventId, p_actor_id: actorId });
  if (error || typeof data !== 'object' || data === null) return { outcome: 'unavailable' };
  const row = data as Record<string, unknown>;
  if (row.outcome === 'missing') return { outcome: 'missing' };
  if (row.outcome === 'closed' && typeof row.status === 'string') return { outcome: 'closed', status: row.status };
  if (row.outcome === 'ok' && row.status === 'planning') return { outcome: 'ok', status: 'planning' };
  return { outcome: 'unavailable' };
}
