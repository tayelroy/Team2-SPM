import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

export type NotificationSource = 'event' | 'hold';
export interface NotificationCursor { created_at: string; source: NotificationSource; notification_id: number }
export type InboxCursor = NotificationCursor;
export interface InboxNotification extends NotificationCursor {
  event_id: number | null;
  kind: string;
  message: string;
  read_at: string | null;
}
export interface NotificationInboxPage {
  notifications: InboxNotification[];
  unread_count: number;
  next_cursor: NotificationCursor | null;
}
export interface NotificationReadResult { notification: InboxNotification; unread_count: number }
export interface NotificationEvent { event_id: number; name: string; status: string; proposed_date: string | null }
export interface NotificationReminderPreferences { frequency_days: number }
export interface NotificationInboxStore {
  inbox(cursor?: NotificationCursor): Promise<NotificationInboxPage>;
  read(source: NotificationSource, id: number): Promise<NotificationReadResult | null>;
  readAll(): Promise<{ unread_count: number }>;
  event(source: NotificationSource, id: number): Promise<NotificationEvent | null>;
  preferences(): Promise<NotificationReminderPreferences>;
  setPreferences(days: number): Promise<NotificationReminderPreferences>;
}

/** Every RPC receives the authenticated caller's JWT, never the service key.
 * Recipient ownership and current event relationships are checked in SQL too. */
export function createNotificationInboxStore(token: string, makeClient = createUserScopedClient): NotificationInboxStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  async function rpc<T>(name: string, args?: Record<string, unknown>, nullable = false): Promise<T> {
    const { data, error, status } = await client!.rpc(name, args);
    if (error || (data === null && !nullable)) {
      throw new AccessError(status === 401 ? 401 : status === 403 || error?.code === '42501' ? 403 : 503);
    }
    return data as T;
  }
  return {
    inbox: cursor => rpc('notification_inbox', { p_limit: 50, p_before_created_at: cursor?.created_at ?? null,
      p_before_source: cursor?.source ?? null, p_before_id: cursor?.notification_id ?? null }),
    read: (source, id) => rpc('read_notification', { p_source: source, p_notification_id: id }, true),
    readAll: () => rpc('read_all_notifications'),
    event: (source, id) => rpc('notification_event', { p_source: source, p_notification_id: id }, true),
    preferences: () => rpc('notification_reminder_preferences'),
    setPreferences: days => rpc('set_notification_reminder_preferences', { p_frequency_days: days })
  };
}
