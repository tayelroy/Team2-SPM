/** The signed-in person's own notices (SG2-49): Venue Staff decisions on their
 * venue requests. Mirrors server/src/db/notifications.ts. */
export interface Notification {
  notification_id: number;
  event_id: number | null;
  request_id: number | null;
  kind: 'venue_request_approved' | 'venue_request_rejected' | 'venue_booking_released';
  message: string;
  created_at: string;
}

export type NotificationsOutcome =
  | { ok: true; notifications: Notification[] }
  | { ok: false; message: string };

const UNAVAILABLE: NotificationsOutcome = { ok: false, message: 'Could not load notifications. Please try again.' };

function isNotification(value: unknown): value is Notification {
  const entry = value as Notification | null;
  return typeof entry?.notification_id === 'number'
    && (entry.kind === 'venue_request_approved' || entry.kind === 'venue_request_rejected' || entry.kind === 'venue_booking_released')
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
