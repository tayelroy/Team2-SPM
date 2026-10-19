import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Event lifecycle notices (SG2-68). These go into the same
 * `public.notifications` table the bell already reads (SG2-49), with no
 * `request_id`: they are about the event itself, not a venue booking request.
 * Recipients only ever read their own rows (row level security), so a person
 * with no part in the event never sees them (AC3).
 */
export type EventNoticeKind =
  | 'event_submitted'
  | 'coordinator_assigned'
  | 'clarification_requested'
  | 'event_approved'
  | 'event_rejected'
  | 'event_returned_to_planning';

export interface EventNotice {
  recipient_id: string | null | undefined;
  event_id: number;
  kind: EventNoticeKind;
  message: string;
}

export type NotifyEventResult = { ok: true } | { ok: false };
export type FetchLeadIdsResult = { ok: true; ids: string[] } | { ok: false };

/** `notifications.message` is limited to 2000 characters. */
const MAX_MESSAGE_LENGTH = 2000;
/** The event name is cut so a notice always has room to say what happened. */
const MAX_NAME_LENGTH = 500;

/** Character-safe truncation, matching Postgres `left()`/`char_length()`. */
function clip(text: string, length: number): string {
  const characters = Array.from(text);
  return characters.length <= length ? text : characters.slice(0, length).join('');
}

/**
 * How a notice names the event (AC2): its name, or "Untitled event" when it
 * has none, matching the database notices (`coalesce(nullif(name, ''), …)`).
 */
export function eventLabel(name: string | null | undefined): string {
  return name ? clip(name, MAX_NAME_LENGTH) : 'Untitled event';
}

export const eventNoticeMessages = {
  submittedToLeads: (event: string) => `${event} was submitted and is waiting for a coordinator.`,
  resubmittedToCoordinator: (event: string) => `${event} was resubmitted for your review.`,
  assignedToCoordinator: (event: string) => `You are now coordinating ${event}.`,
  assignedToOrganiser: (coordinator: string | null | undefined, event: string) =>
    `${coordinator ? clip(coordinator, MAX_NAME_LENGTH) : 'A coordinator'} is now coordinating ${event}.`,
  reassignedFromCoordinator: (event: string) => `${event} was reassigned to another coordinator.`,
  // The question itself stays in the clarification thread, behind its own access check.
  clarificationRequested: (event: string) => `Your coordinator has a question about ${event}.`,
  approved: (event: string) => `${event} was approved.`,
  rejected: (event: string, reason: string) => clip(`${event} was not approved: ${reason}`, MAX_MESSAGE_LENGTH),
  // SG2-66 AC7: an event moved back from Awaiting Safety Check, Preparation or
  // Confirmed to Planning. Matches the SQL wording in 202610190003.
  returnedToPlanningOrganiser: (event: string) =>
    `${event} has moved back to Planning. Its arrangements are being rechecked before it can be confirmed again.`,
  returnedToPlanningCoordinator: (event: string) =>
    `${event} is back in Planning. Recheck its outstanding arrangements before it goes through the safety check again.`
};

/**
 * Stores a batch of notices in one insert. A notice without a recipient or
 * message is dropped, and a person gets one notice of a kind per batch even
 * if they hold two parts in the event. An empty batch writes nothing.
 * Callers remove the actor themselves: nobody is told about their own action.
 */
export async function notifyEvent(admin: SupabaseClient, notices: EventNotice[]): Promise<NotifyEventResult> {
  const seen = new Set<string>();
  const rows: { recipient_id: string; event_id: number; kind: EventNoticeKind; message: string }[] = [];
  for (const notice of notices) {
    if (!notice.recipient_id || !notice.message) continue;
    const key = `${notice.recipient_id}\u0000${notice.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ recipient_id: notice.recipient_id, event_id: notice.event_id, kind: notice.kind, message: notice.message });
  }
  if (rows.length === 0) return { ok: true };

  const { error } = await admin.from('notifications').insert(rows);
  return error ? { ok: false } : { ok: true };
}

/** Everyone holding the Event Coordinator Lead role: they assign submitted events. */
export async function fetchLeadIds(admin: SupabaseClient): Promise<FetchLeadIdsResult> {
  const { data, error } = await admin.from('account_roles').select('user_id').eq('role', 'event_coordinator_lead');
  if (error || !data) return { ok: false };
  return { ok: true, ids: (data as { user_id: string }[]).map(row => row.user_id) };
}
