/** SG2-69: one recipient-scoped inbox for event and tentative-hold notices. */
export type NotificationSource = 'event' | 'hold';
export interface NotificationCursor { created_at: string; source: NotificationSource; notification_id: number }
export interface InboxNotification extends NotificationCursor {
  event_id: number | null; kind: string; message: string; read_at: string | null;
}
export interface InboxPage { notifications: InboxNotification[]; unread_count: number; next_cursor: NotificationCursor | null }
export interface ReadNotificationResult { notification: InboxNotification; unread_count: number }
export interface NotificationEventSummary { event_id: number; name: string; status: string; proposed_date: string | null }
export interface ReminderPreferences { frequency_days: number }
export type InboxOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

const EVENT_KINDS = new Set(['venue_request_approved', 'venue_request_rejected', 'venue_booking_released',
  'equipment_reserved', 'venue_booking_clash', 'venue_unavailable', 'event_confirmed', 'event_submitted',
  'coordinator_assigned', 'clarification_requested', 'event_approved', 'event_rejected',
  'event_returned_to_planning', 'safety_decision', 'outstanding_arrangements',
  // SG2-63 AC10: registration opened or closed on a confirmed event.
  'registration_opened', 'registration_closed',
  // SG2-83 AC4: Venue Staff hear of a cancelled or changed venue booking.
  'venue_booking_cancelled', 'venue_change_requested',
  // SG2-67: the organiser asked to cancel, and the event was cancelled.
  'cancellation_requested', 'event_cancelled',
  // SG2-60: an attendee's registration is confirmed.
  'registration_confirmed',
  // SG2-64 AC2: the organiser asked for a change to the coordinator's event.
  'change_requested',
  // SG2-62 AC5: an attendee withdrew from the organiser's or coordinator's event.
  'registration_withdrawn',
  // SG2-65 AC1/AC2: the coordinator accepted or refused the organiser's change.
  'change_accepted', 'change_refused',
  // SG2-102 AC1: the date, time or venue of the attendee's event changed.
  'event_changed']);
const HOLD_KINDS = new Set(['placed', 'warning', 'expired', 'expiry_changed']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const source = (value: unknown): value is NotificationSource => value === 'event' || value === 'hold';
const cursor = (value: unknown): value is NotificationCursor => record(value) && source(value.source) && positiveId(value.notification_id) && instant(value.created_at);
const notification = (value: unknown): value is InboxNotification => cursor(value) && record(value)
  && (value.event_id === null || positiveId(value.event_id)) && typeof value.message === 'string'
  && typeof value.kind === 'string' && (value.source === 'event' ? EVENT_KINDS : HOLD_KINDS).has(value.kind)
  && (value.read_at === null || instant(value.read_at));
const page = (value: unknown): value is InboxPage => record(value) && Array.isArray(value.notifications)
  && value.notifications.every(notification) && count(value.unread_count) && (value.next_cursor === null || cursor(value.next_cursor));
const readResult = (value: unknown): value is ReadNotificationResult => record(value) && notification(value.notification) && count(value.unread_count);
const unread = (value: unknown): value is { unread_count: number } => record(value) && count(value.unread_count);
const preferences = (value: unknown): value is ReminderPreferences => record(value) && typeof value.frequency_days === 'number'
  && Number.isInteger(value.frequency_days) && value.frequency_days >= 1 && value.frequency_days <= 30;
const eventSummary = (value: unknown): value is { event: NotificationEventSummary } => record(value) && record(value.event)
  && positiveId(value.event.event_id) && typeof value.event.name === 'string' && typeof value.event.status === 'string'
  && (value.event.proposed_date === null || instant(value.event.proposed_date));

async function request<T>(accessToken: string, path: string, validate: (value: unknown) => value is T,
  method = 'GET', body?: string): Promise<InboxOutcome<T>> {
  try {
    const response = await fetch(`/api/notifications${path}`, {
      method, headers: { Authorization: `Bearer ${accessToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      cache: 'no-store', ...(body === undefined ? {} : { body })
    });
    if (response.status === 401) return { ok: false, message: 'Your session has expired. Sign in again to view notifications.' };
    if (response.status === 403) return { ok: false, message: 'You do not have access to this notification action.' };
    if (response.status === 404) return { ok: false, message: 'This notification or its event is no longer available to you.' };
    if (!response.ok) return { ok: false, message: 'Could not update or load notifications. Please try again.' };
    const value: unknown = await response.json();
    return validate(value) ? { ok: true, value } : { ok: false, message: 'Could not update or load notifications. Please try again.' };
  } catch {
    return { ok: false, message: 'Could not update or load notifications. Please try again.' };
  }
}

export function loadNotificationInbox(token: string, before?: NotificationCursor): Promise<InboxOutcome<InboxPage>> {
  const query = before ? `?${new URLSearchParams({ before_created_at: before.created_at, before_source: before.source, before_id: String(before.notification_id) })}` : '';
  return request(token, `/inbox${query}`, page);
}
export const readNotification = (token: string, from: NotificationSource, id: number) => request(token, `/${from}/${id}/read`, readResult, 'POST');
export const readAllNotifications = (token: string) => request(token, '/read-all', unread, 'POST');
export const loadNotificationEvent = (token: string, from: NotificationSource, id: number) => request(token, `/${from}/${id}/event`, eventSummary);
export const loadReminderPreferences = (token: string) => request(token, '/reminder-preferences', preferences);
export const saveReminderPreferences = (token: string, days: number) => request(token, '/reminder-preferences', preferences, 'PUT', JSON.stringify({ frequency_days: days }));
