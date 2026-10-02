import type { SupabaseClient } from '@supabase/supabase-js';

/** One message in an event's clarification thread (SG2-36). */
export interface ClarificationRecord {
  clarification_id: number;
  event_id: number;
  sender_id: string;
  sender_name: string | null;
  message: string;
  created_at: string;
}

export type FetchClarificationsResult =
  | { ok: true; clarifications: ClarificationRecord[] }
  | { ok: false; reason: 'unavailable'; message: string };

export type InsertClarificationResult =
  | { ok: true; clarification: ClarificationRecord }
  | { ok: false; reason: 'unavailable'; message: string };

const SELECT_COLUMNS =
  'clarification_id, event_id, sender_id, message, created_at, sender:users!sender_id(name)';

const INSERT_COLUMNS = 'clarification_id, event_id, sender_id, message, created_at';

/** The join returns either an object or a single-element array depending on
 * how PostgREST resolves the relationship, so both shapes are handled. */
function extractSenderName(row: Record<string, unknown>): string | null {
  if ('sender' in row && row.sender) {
    if (Array.isArray(row.sender) && row.sender.length > 0) {
      const first = row.sender[0] as Record<string, unknown>;
      if (typeof first?.name === 'string') return first.name;
    } else if (typeof row.sender === 'object') {
      const sender = row.sender as Record<string, unknown>;
      if (typeof sender.name === 'string') return sender.name;
    }
  }
  if (typeof row.sender_name === 'string') return row.sender_name;
  return null;
}

function toRecord(row: Record<string, unknown>): ClarificationRecord {
  return {
    clarification_id: Number(row.clarification_id),
    event_id: Number(row.event_id),
    sender_id: String(row.sender_id),
    sender_name: extractSenderName(row),
    message: String(row.message),
    created_at: String(row.created_at)
  };
}

/**
 * Reads an event's clarification thread oldest first, so it reads as a
 * conversation (SG2-36). Callers are responsible for establishing that the
 * requester may see this event at all.
 */
export async function fetchClarifications(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchClarificationsResult> {
  const { data, error } = await admin
    .from('event_clarifications')
    .select(SELECT_COLUMNS)
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })
    .order('clarification_id', { ascending: true });

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  const rows = (data as unknown as Record<string, unknown>[] | null) ?? [];
  return { ok: true, clarifications: rows.map(toRecord) };
}

/**
 * Appends a message to an event's clarification thread (SG2-36). The thread is
 * append-only: nothing edits or removes a message, so the exchange stays a
 * faithful record of what was actually asked and answered.
 */
export async function insertClarification(
  admin: SupabaseClient,
  eventId: number,
  senderId: string,
  message: string
): Promise<InsertClarificationResult> {
  const { data, error } = await admin
    .from('event_clarifications')
    .insert({ event_id: eventId, sender_id: senderId, message })
    .select(INSERT_COLUMNS);

  if (error) {
    return { ok: false, reason: 'unavailable', message: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'unavailable', message: 'The message was not returned after insert.' };
  }
  return { ok: true, clarification: toRecord(data[0] as unknown as Record<string, unknown>) };
}
