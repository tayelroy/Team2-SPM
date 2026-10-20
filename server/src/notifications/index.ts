import { type createAuthorization, AccessError } from '../auth';
import { listNotifications } from '../db/notifications';
import { createNotificationInboxStore, type NotificationCursor, type NotificationSource } from '../db/notificationInbox';
import type { RequestHandler } from 'express';

function notificationId(raw: unknown): number | null {
  return typeof raw === 'string' && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}
function source(raw: unknown): raw is NotificationSource { return raw === 'event' || raw === 'hold'; }
/** Preserve PostgreSQL microseconds in the cursor; normalising to JS milliseconds
 * would skip or repeat notices written within the same millisecond. */
function cursor(query: Record<string, unknown>): NotificationCursor | null | undefined {
  const keys = Object.keys(query);
  if (keys.length === 0) return undefined;
  if (keys.length !== 3 || keys.some(key => !['before_created_at', 'before_source', 'before_id'].includes(key))) return null;
  const { before_created_at: date, before_source, before_id } = query;
  const id = notificationId(before_id);
  if (!source(before_source) || id === null || typeof date !== 'string'
    || !/^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(date)) return null;
  const day = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(Date.parse(date)) || new Date(day).toISOString().slice(0, 10) !== date.slice(0, 10)) return null;
  return { created_at: date, source: before_source, notification_id: id };
}

function frequency(body: unknown): number | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  return Object.keys(value).length === 1 && typeof value.frequency_days === 'number'
    && Number.isInteger(value.frequency_days) && value.frequency_days >= 1 && value.frequency_days <= 30 ? value.frequency_days : null;
}

/**
 * GET /api/notifications — the caller's own notices, newest first (SG2-49
 * AC1/AC2: a coordinator is told when Venue Staff approve or reject their
 * venue request, with the reason for a rejection).
 */
export function createNotificationsRouter(access: ReturnType<typeof createAuthorization>, list = listNotifications, inboxFactory = createNotificationInboxStore) {
  const router = access.protectedRouter();
  const handle = (operation: 'inbox' | 'readAll' | 'preferences' | 'setPreferences' | 'read' | 'event'): RequestHandler => async (req, res) => {
    try {
      const page = operation === 'inbox' ? cursor(req.query) : undefined;
      const identifying = operation === 'read' || operation === 'event';
      const id = identifying ? notificationId(req.params.id) : null;
      const days = operation === 'setPreferences' ? frequency(req.body) : null;
      if (page === null || (identifying && (!source(req.params.source) || id === null))) {
        res.status(400).json({ error: 'Enter a valid notification identity or complete pagination cursor.' }); return;
      }
      if (operation === 'setPreferences' && days === null) {
        res.status(400).json({ error: 'Choose a reminder interval from 1 to 30 whole days.' }); return;
      }
      const store = inboxFactory(req.get('authorization')!.slice(7));
      if (operation === 'inbox') { res.json(await store.inbox(page)); return; }
      if (operation === 'readAll') { res.json(await store.readAll()); return; }
      if (operation === 'preferences') { res.json(await store.preferences()); return; }
      if (operation === 'setPreferences') { res.json(await store.setPreferences(days!)); return; }
      const result = operation === 'read' ? await store.read(req.params.source as NotificationSource, id!)
        : await store.event(req.params.source as NotificationSource, id!);
      if (result === null) { res.status(404).json({ error: 'Notification or related event is no longer available.' }); return; }
      res.json(operation === 'event' ? { event: result } : result);
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };
  const inbox = access.requirePermission('notifications.inbox');
  const reminders = access.requirePermission('notifications.reminders.manage');
  router.get('/inbox', inbox, handle('inbox'));
  router.post('/read-all', inbox, handle('readAll'));
  router.get('/reminder-preferences', reminders, handle('preferences'));
  router.put('/reminder-preferences', reminders, handle('setPreferences'));
  router.post('/:source/:id/read', inbox, handle('read'));
  router.get('/:source/:id/event', inbox, handle('event'));
  router.get('/', access.requirePermission('notifications.read'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const principal = access.getPrincipal(req)!;
      res.json({ notifications: await list(req.get('authorization')!.slice(7), principal.userId) });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  });
  return router;
}
