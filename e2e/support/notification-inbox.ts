import { AccessError } from '../../server/src/auth/policy';
import { currentActingRole } from '../../server/src/auth/actingRole';
import { hasEventRelationship } from '../../server/src/events/eventRelationship';
import type { MemoryDatabase } from './memory-database';
import type { NotificationInboxStore, InboxCursor, InboxNotification, NotificationSource } from '../../server/src/db/notificationInbox';

/** Browser-only provider: real handlers and production UI, isolated storage.
 * Native SQL/PostgREST tests supply the database and scheduler evidence. */
export function createMemoryNotificationInbox(database: MemoryDatabase) {
  return (token: string): NotificationInboxStore => {
    const user = () => database.sessions.get(token)!;
    const role = () => {
      const selected = currentActingRole();
      if (!selected || !database.tables.account_roles.some(row => row.user_id === user() && row.role === selected)) throw new AccessError(403);
      return selected;
    };
    const table = (source: NotificationSource) => database.tables[source === 'event' ? 'notifications' : 'venue_hold_notifications'];
    const own = (source: NotificationSource, id: number) => table(source).find(row => row.recipient_id === user() && row.notification_id === id);
    const compare = (a: InboxCursor, b: InboxCursor) => Date.parse(b.created_at) - Date.parse(a.created_at)
      || b.source.localeCompare(a.source) || b.notification_id - a.notification_id;
    const all = (): InboxNotification[] => (['event', 'hold'] as const).flatMap(source => table(source)
      .filter(row => row.recipient_id === user()).map(row => ({
        source, notification_id: Number(row.notification_id), event_id: row.event_id == null ? null : Number(row.event_id),
        kind: String(row.kind), message: String(row.message), created_at: String(row.created_at), read_at: row.read_at == null ? null : String(row.read_at),
      }))).sort(compare) as InboxNotification[];
    const unread = () => all().filter(row => row.read_at === null).length;
    const preference = () => {
      if (role() !== 'event_coordinator') throw new AccessError(403);
      return database.tables.notification_reminder_preferences.find(row => row.user_id === user());
    };
    return {
      async inbox(cursor) {
        const remaining = all().filter(row => !cursor || compare(row, cursor) > 0);
        const notifications = remaining.slice(0, 50);
        const last = notifications.at(-1);
        return { notifications, unread_count: unread(), next_cursor: remaining.length > 50 && last
          ? { created_at: last.created_at, source: last.source, notification_id: last.notification_id } : null };
      },
      async read(source, id) {
        const row = own(source, id);
        if (!row) return null;
        row.read_at ??= new Date().toISOString();
        return { notification: all().find(entry => entry.source === source && entry.notification_id === id)!, unread_count: unread() };
      },
      async readAll() {
        const now = new Date().toISOString();
        for (const source of ['event', 'hold'] as const) for (const row of table(source)) {
          if (row.recipient_id === user()) row.read_at ??= now;
        }
        return { unread_count: unread() };
      },
      async event(source, id) {
        const row = own(source, id);
        const event = row && database.tables.events.find(event => event.event_id === row.event_id);
        if (!event) return null;
        const selectedRole = role();
        const viewer = database.tables.users.find(row => row.user_id === user());
        if (selectedRole === 'attendee') {
          if (!database.tables.registrations.some(row => row.event_id === event.event_id && row.user_id === user())) return null;
        } else {
          const relationship = await hasEventRelationship(database.client, selectedRole, user(), {
            event_id: Number(event.event_id), organiser_id: String(event.organiser_id),
            coordinator_id: event.coordinator_id == null ? null : String(event.coordinator_id), status: String(event.status),
          });
          if (!relationship.ok || !relationship.related) return null;
          if (selectedRole === 'event_organiser' && (!String(viewer?.organisation ?? '').trim() || event.organisation !== viewer?.organisation)) return null;
        }
        return { event_id: Number(event.event_id), name: String(event.name), status: String(event.status), proposed_date: event.proposed_date == null ? null : String(event.proposed_date) };
      },
      async preferences() { return { frequency_days: Number(preference()?.frequency_days ?? 1) }; },
      async setPreferences(frequency_days) {
        const existing = preference();
        if (existing) existing.frequency_days = frequency_days;
        else database.tables.notification_reminder_preferences.push({ user_id: user(), frequency_days });
        return { frequency_days };
      },
    };
  };
}

/** Repeated numeric IDs in different sources are intentional. */
export function seedNotificationInbox(database: MemoryDatabase, large = false, multiRole = false) {
  if (multiRole) database.tables.account_roles.push({ user_id: 'user-coordinator', role: 'attendee' });
  database.tables.events.push({ ...database.tables.events[0], event_id: 691, name: 'Reminder Forum',
    coordinator_id: 'user-coordinator', status: 'planning', proposed_date: '2030-06-20T02:00:00.000Z' });
  const base = { recipient_id: 'user-coordinator', event_id: 691, request_id: null, read_at: null };
  database.tables.notifications.push(
    { ...base, notification_id: 1, kind: 'outstanding_arrangements', message: 'Reminder Forum still needs: Venue booking, Equipment.', created_at: '2030-06-01T03:00:00.000Z' },
    { ...base, notification_id: 2, kind: 'coordinator_assigned', message: 'You are coordinating Reminder Forum.', created_at: '2030-06-01T01:00:00.000Z', read_at: '2030-06-01T01:05:00.000Z' },
    { ...base, notification_id: 90, recipient_id: 'user-organiser2', kind: 'event_confirmed', message: 'Private other organisation notice.', created_at: '2030-06-01T04:00:00.000Z' },
  );
  database.tables.venue_hold_notifications.push({ ...base, notification_id: 1, hold_id: 1, kind: 'expired',
    message: 'Reminder Forum tentative venue hold expired.', created_at: '2030-06-01T02:00:00.000Z' });
  if (large) for (let id = 3; id <= 53; id++) database.tables.notifications.push({ ...base, notification_id: id,
    kind: 'coordinator_assigned', message: `Earlier notice ${id}`, created_at: '2030-05-31T00:00:00.000Z' });
}
