/** The signed-in person's own notices (SG2-49): Venue Staff decisions on their
 * venue requests, and since SG2-68 the steps of their event's request
 * lifecycle. Mirrors server/src/db/notifications.ts. */
export interface Notification {
  notification_id: number;
  event_id: number | null;
  request_id: number | null;
  kind: 'venue_request_approved' | 'venue_request_rejected' | 'venue_booking_released' | 'equipment_reserved' | 'venue_booking_clash'
    | 'venue_unavailable' | 'event_confirmed' | 'event_submitted' | 'coordinator_assigned' | 'clarification_requested' | 'event_approved' | 'event_rejected'
    | 'event_returned_to_planning' | 'safety_decision' | 'outstanding_arrangements' | 'registration_opened'
    | 'registration_closed' | 'cancellation_requested' | 'event_cancelled';
  message: string;
  created_at: string;
}

export type NotificationsOutcome =
  | { ok: true; notifications: Notification[] }
  | { ok: false; message: string };

const UNAVAILABLE: NotificationsOutcome = { ok: false, message: 'Could not load notifications. Please try again.' };

const KINDS: Record<Notification['kind'], true> = {
  venue_request_approved: true, venue_request_rejected: true, venue_booking_released: true, equipment_reserved: true,
  venue_booking_clash: true, venue_unavailable: true, event_confirmed: true, event_submitted: true, coordinator_assigned: true,
  clarification_requested: true, event_approved: true, event_rejected: true, event_returned_to_planning: true,
  safety_decision: true, outstanding_arrangements: true, registration_opened: true, registration_closed: true,
  cancellation_requested: true, event_cancelled: true
};

function isNotification(value: unknown): value is Notification {
  const entry = value as Notification | null;
  return typeof entry?.notification_id === 'number'
    && KINDS[entry.kind] === true
    && typeof entry.message === 'string' && typeof entry.created_at === 'string' && Number.isFinite(Date.parse(entry.created_at));
}

/** GET /api/notifications — the server limits these to the caller. */
export async function loadNotifications(accessToken: string): Promise<NotificationsOutcome> {
  try {
    const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
    if (response.status === 401) return { ok: false, message: 'Your session has expired. Sign in again to view notifications.' };
    if (!response.ok) return UNAVAILABLE;
    const body = await response.json() as { notifications?: unknown } | null;
    if (!Array.isArray(body?.notifications) || !body.notifications.every(isNotification)) return UNAVAILABLE;
    return { ok: true, notifications: body.notifications };
  } catch {
    return UNAVAILABLE;
  }
}
