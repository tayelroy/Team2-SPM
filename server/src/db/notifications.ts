import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';
import type { EventNoticeKind } from './eventNotifications';

/** A notice for one person: a venue request was approved or rejected (SG2-49),
 * a venue booking was released (SG2-51), equipment was reserved (SG2-55),
 * the organiser's event was confirmed (SG2-58), or a step in the event's
 * request lifecycle happened (SG2-68, see eventNotifications.ts), or a booked
 * venue became unavailable (SG2-81), or an event moved back to Planning (SG2-66). */
export interface NotificationRecord {
  notification_id: number;
  event_id: number | null;
  request_id: number | null;
  kind: 'venue_request_approved' | 'venue_request_rejected' | 'venue_booking_released' | 'equipment_reserved' | 'venue_booking_clash'
    | 'venue_unavailable' | 'event_confirmed' | EventNoticeKind;
  message: string;
  created_at: string;
}

const COLUMNS = 'notification_id,event_id,request_id,kind,message,created_at';
/** The newest notices only; older ones stay stored. */
export const NOTIFICATION_LIMIT = 50;

/** Reads with the caller's token: row level security already limits the rows
 * to their own, and the recipient filter keeps that true in the query too. */
export async function listNotifications(token: string, userId: string, makeClient = createUserScopedClient): Promise<NotificationRecord[]> {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  const { data, error } = await client.from('notifications').select(COLUMNS).eq('recipient_id', userId)
    .order('created_at', { ascending: false }).order('notification_id', { ascending: false }).range(0, NOTIFICATION_LIMIT - 1);
  if (error || !data) throw new AccessError(503);
  return data as NotificationRecord[];
}
