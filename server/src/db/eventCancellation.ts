import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

/** What `public.request_event_cancellation` decided (SG2-67 AC1). */
export type RequestCancellationResult =
  | { outcome: 'ok'; event_id: number; cancellation_requested_at: string; coordinator_notified: boolean }
  | { outcome: 'invalid' | 'missing' }
  | { outcome: 'closed'; status: string }
  | { outcome: 'requested'; cancellation_requested_at: string };

/** What `public.cancel_event` decided (SG2-67 AC1-AC4). */
export type CancelEventResult =
  | {
    outcome: 'ok'; event_id: number; status: 'cancelled'; cancelled_at: string;
    bookings_released: number; attendees_notified: number;
  }
  | { outcome: 'invalid' | 'missing' | 'not_requested' }
  | { outcome: 'closed'; status: string };

type MakeClient = (token: string) => SupabaseClient | null;

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function parseRequest(data: unknown): RequestCancellationResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const row = data as Record<string, unknown>;
  switch (row.outcome) {
    case 'ok':
      return Number.isSafeInteger(row.event_id) && typeof row.cancellation_requested_at === 'string'
        && typeof row.coordinator_notified === 'boolean'
        ? { outcome: 'ok', event_id: row.event_id as number, cancellation_requested_at: row.cancellation_requested_at,
          coordinator_notified: row.coordinator_notified }
        : null;
    case 'invalid':
    case 'missing':
      return { outcome: row.outcome };
    case 'closed':
      return typeof row.status === 'string' ? { outcome: 'closed', status: row.status } : null;
    case 'requested':
      return typeof row.cancellation_requested_at === 'string'
        ? { outcome: 'requested', cancellation_requested_at: row.cancellation_requested_at }
        : null;
    default:
      return null;
  }
}

function parseCancel(data: unknown): CancelEventResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const row = data as Record<string, unknown>;
  switch (row.outcome) {
    case 'ok':
      return Number.isSafeInteger(row.event_id) && row.status === 'cancelled' && typeof row.cancelled_at === 'string'
        && count(row.bookings_released) && count(row.attendees_notified)
        ? { outcome: 'ok', event_id: row.event_id as number, status: 'cancelled', cancelled_at: row.cancelled_at,
          bookings_released: row.bookings_released, attendees_notified: row.attendees_notified }
        : null;
    case 'invalid':
    case 'missing':
    case 'not_requested':
      return { outcome: row.outcome };
    case 'closed':
      return typeof row.status === 'string' ? { outcome: 'closed', status: row.status } : null;
    default:
      return null;
  }
}

/**
 * Calls one cancellation RPC with the caller's JWT, so the stored role, the
 * event relationship, the status guards and every write happen in the
 * database in one transaction. Role, session and provider failures become
 * safe 403, 401 and 503 errors; an unrecognised answer fails closed.
 */
async function callRpc<T>(token: string, makeClient: MakeClient, name: string, args: Record<string, unknown>,
  parse: (data: unknown) => T | null): Promise<T> {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  const { data, error, status } = await client.rpc(name, args);
  if (error) {
    if (error.code === '42501' || status === 403) throw new AccessError(403);
    if (error.code === '28000' || error.code === 'PGRST301' || status === 401) throw new AccessError(401);
    throw new AccessError(503);
  }
  const result = parse(data);
  if (!result) throw new AccessError(503);
  return result;
}

/** The creating organiser asks for the event to be cancelled (SG2-67 AC1). */
export function requestEventCancellation(token: string, eventId: number, reason: string,
  makeClient: MakeClient = createUserScopedClient): Promise<RequestCancellationResult> {
  return callRpc(token, makeClient, 'request_event_cancellation', { p_event_id: eventId, p_reason: reason }, parseRequest);
}

/** The assigned coordinator carries out the outstanding request (SG2-67 AC1-AC4). */
export function cancelEvent(token: string, eventId: number,
  makeClient: MakeClient = createUserScopedClient): Promise<CancelEventResult> {
  return callRpc(token, makeClient, 'cancel_event', { p_event_id: eventId }, parseCancel);
}
