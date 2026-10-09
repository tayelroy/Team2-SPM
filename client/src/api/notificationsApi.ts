/** The signed-in person's own notices (SG2-49): Venue Staff decisions on their
 * venue requests. Mirrors server/src/db/notifications.ts. */
/** Venue decisions and releases (SG2-49, SG2-51) and coordinator assignment notices (SG2-88). */
export const NOTIFICATION_KINDS = [
  'venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
  'coordinator_assigned', 'coordinator_removed', 'event_coordinator_changed',
] as const;
export type NotificationKind = typeof NOTIFICATION_KINDS[number];

export interface Notification {
  notification_id: number;
  event_id: number | null;
  request_id: number | null;
  kind: NotificationKind;
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
    && (NOTIFICATION_KINDS as readonly string[]).includes(entry.kind)
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
