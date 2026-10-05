/** Recipient-scoped notifications for tentative venue holds. */
export interface HoldNotification {
  notification_id: number;
  event_id: number;
  hold_id: number;
  kind: 'placed' | 'warning' | 'expired';
  message: string;
  created_at: string;
}

export type HoldNotificationsOutcome =
  | { ok: true; notifications: HoldNotification[] }
  | { ok: false; kind: 'unauthorized' | 'forbidden' | 'unavailable'; message: string };

const UNAVAILABLE: HoldNotificationsOutcome = {
  ok: false, kind: 'unavailable', message: 'Could not load hold notifications. Please try again.',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNotification(value: unknown): value is HoldNotification {
  return isRecord(value) &&
    isId(value.notification_id) && isId(value.event_id) && isId(value.hold_id) &&
    (value.kind === 'placed' || value.kind === 'warning' || value.kind === 'expired') &&
    typeof value.message === 'string' && typeof value.created_at === 'string' &&
    Number.isFinite(Date.parse(value.created_at));
}

/** The server scopes this inbox to the authenticated recipient. */
export async function loadHoldNotifications(accessToken: string): Promise<HoldNotificationsOutcome> {
  try {
    const response = await fetch('/api/venue-holds/notifications', {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
    });
    if (response.status === 401) return {
      ok: false, kind: 'unauthorized', message: 'Your session has expired. Sign in again to view notifications.',
    };
    if (response.status === 403) return {
      ok: false, kind: 'forbidden', message: 'You do not have access to hold notifications.',
    };
    if (!response.ok) return UNAVAILABLE;
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.notifications) || !body.notifications.every(isNotification)) return UNAVAILABLE;
    return { ok: true, notifications: body.notifications.map(entry => ({
      notification_id: entry.notification_id, event_id: entry.event_id, hold_id: entry.hold_id,
      kind: entry.kind, message: entry.message, created_at: entry.created_at,
    })) };
  } catch {
    return UNAVAILABLE;
  }
}
