import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChangeRequest, ChangeRequestEvent, ChangeRequestSource } from '../changeRequests/mockChangeRequests';
import { CHANGE_FIELD_LABELS, CHANGEABLE_FIELDS, type ChangeableField } from '../events/changeImpact';

/** A row of public.event_change_requests (SG2-64). */
interface ChangeRequestRow {
  change_request_id: number;
  event_id: number;
  field: string;
  from_value: unknown;
  to_value: unknown;
  reason: string;
  status: string;
  created_at: string;
}

export interface RaiseChangeRequestInput {
  eventId: number;
  actorId: string;
  field: ChangeableField;
  to: string | number;
  reason: string;
}

/** What `public.raise_event_change_request` decided (SG2-64 AC1/AC2/AC4). */
export type RaiseChangeRequestResult =
  | { outcome: 'ok'; request: ChangeRequest; coordinator_notified: boolean }
  | { outcome: 'not_found' | 'unchanged' | 'unavailable' }
  | { outcome: 'closed'; status: string };

const COLUMNS = 'change_request_id, event_id, field, from_value, to_value, reason, status, created_at';

const isChangeableField = (value: unknown): value is ChangeableField =>
  typeof value === 'string' && (CHANGEABLE_FIELDS as readonly string[]).includes(value);

const isValue = (value: unknown): value is string | number | null =>
  value === null || typeof value === 'string' || typeof value === 'number';

/** The stored row in the shape SG2-66 consumes, or null when malformed. */
function toChangeRequest(raw: unknown): ChangeRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as ChangeRequestRow;
  if (!Number.isSafeInteger(row.change_request_id) || !isChangeableField(row.field)
      || !isValue(row.from_value) || !isValue(row.to_value)
      || typeof row.reason !== 'string' || typeof row.created_at !== 'string' || row.status !== 'pending') {
    return null;
  }
  return {
    id: String(row.change_request_id),
    requested_at: row.created_at,
    reason: row.reason,
    status: 'pending',
    changes: [{ field: row.field, label: CHANGE_FIELD_LABELS[row.field], from: row.from_value, to: row.to_value }]
  };
}

/**
 * Raises a change request with the service role. The function itself checks
 * the actor is the organiser who owns the event, locks it, refuses a closed
 * one, stores the request and notifies the assigned coordinator.
 */
export async function raiseEventChangeRequest(
  admin: SupabaseClient,
  input: RaiseChangeRequestInput
): Promise<RaiseChangeRequestResult> {
  const { data, error } = await admin.rpc('raise_event_change_request', {
    p_event_id: input.eventId,
    p_actor_id: input.actorId,
    p_field: input.field,
    p_to_value: input.to,
    p_reason: input.reason
  });
  if (error || typeof data !== 'object' || data === null) return { outcome: 'unavailable' };
  const result = data as Record<string, unknown>;
  switch (result.outcome) {
    case 'ok': {
      const request = toChangeRequest(result.request);
      return request && typeof result.coordinator_notified === 'boolean'
        ? { outcome: 'ok', request, coordinator_notified: result.coordinator_notified }
        : { outcome: 'unavailable' };
    }
    case 'not_found':
    case 'unchanged':
      return { outcome: result.outcome };
    case 'closed':
      return typeof result.status === 'string' ? { outcome: 'closed', status: result.status } : { outcome: 'unavailable' };
    default:
      return { outcome: 'unavailable' };
  }
}

/**
 * The SG2-66 seam backed by public.event_change_requests: pending requests,
 * oldest first. Any read or write failure throws, which the routes turn
 * into 503.
 */
export function createDatabaseChangeRequestSource(getAdminClient: () => SupabaseClient | null): ChangeRequestSource {
  const admin = () => {
    const client = getAdminClient();
    if (!client) throw new Error('Change requests are unavailable.');
    return client;
  };
  const pending = (event: ChangeRequestEvent) => admin().from('event_change_requests').select(COLUMNS)
    .eq('event_id', event.event_id).eq('status', 'pending');

  return {
    async list(event) {
      const { data, error } = await pending(event).order('created_at').order('change_request_id');
      if (error || !Array.isArray(data)) throw new Error('Change requests are unavailable.');
      return data.map(toChangeRequest).filter((request): request is ChangeRequest => request !== null);
    },
    async get(event, id) {
      if (!/^[1-9]\d{0,15}$/.test(id)) return null;
      const { data, error } = await pending(event).eq('change_request_id', Number(id)).maybeSingle();
      if (error) throw new Error('Change requests are unavailable.');
      return toChangeRequest(data);
    },
    async markAccepted(event, id) {
      const { error } = await admin().from('event_change_requests').update({ status: 'accepted' })
        .eq('event_id', event.event_id).eq('change_request_id', Number(id)).eq('status', 'pending');
      if (error) throw new Error('Change requests are unavailable.');
    }
  };
}
