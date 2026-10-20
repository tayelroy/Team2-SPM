import { afterEach, expect, test, vi } from 'vitest';
import { loadNotificationInbox, readNotification, readAllNotifications, loadNotificationEvent,
  loadReminderPreferences, saveReminderPreferences } from './notificationInboxApi';

afterEach(() => vi.unstubAllGlobals());
const entry = { source: 'event', notification_id: 2, event_id: 8, kind: 'outstanding_arrangements',
  message: 'Forum still needs: Venue booking.', created_at: '2026-10-20T01:00:00Z', read_at: null };
const page = { notifications: [entry], unread_count: 80, next_cursor: { created_at: entry.created_at, source: 'hold' as const, notification_id: 1 } };
function respond(value: unknown, status = 200) {
  const fetch = vi.fn(async () => Response.json(value, { status })); vi.stubGlobal('fetch', fetch); return fetch;
}

test('[NORMAL] [SG2-69:AC1] inbox requests use the session token, no-store, global count and an encoded complete cursor', async () => {
  const fetch = respond(page);
  expect(await loadNotificationInbox('token')).toEqual({ ok: true, value: page });
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications/inbox', { method: 'GET', headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
  await loadNotificationInbox('token', page.next_cursor);
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications/inbox?before_created_at=2026-10-20T01%3A00%3A00Z&before_source=hold&before_id=1', expect.objectContaining({ cache: 'no-store' }));
});

test('[NORMAL] [SG2-69:AC3] [SG2-69:AC4] read-one and read-all send recipient-authenticated POSTs', async () => {
  const read = { notification: { ...entry, read_at: entry.created_at }, unread_count: 79 };
  const fetch = respond(read);
  expect(await readNotification('token', 'event', 2)).toEqual({ ok: true, value: read });
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications/event/2/read', expect.objectContaining({ method: 'POST' }));
  fetch.mockResolvedValue(Response.json({ unread_count: 0 }));
  expect(await readAllNotifications('token')).toEqual({ ok: true, value: { unread_count: 0 } });
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications/read-all', expect.objectContaining({ method: 'POST' }));
});

test('[NORMAL] [SG2-69:AC3] target is looked up by notification identity and accepts an absent event date', async () => {
  const value = { event: { event_id: 8, name: 'Forum', status: 'planning', proposed_date: null } };
  const fetch = respond(value);
  expect(await loadNotificationEvent('token', 'hold', 5)).toEqual({ ok: true, value });
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications/hold/5/event', expect.objectContaining({ method: 'GET' }));
  fetch.mockResolvedValue(Response.json({ event: { ...value.event, proposed_date: '2030-01-01' } }));
  expect((await loadNotificationEvent('token', 'event', 5)).ok).toBe(true);
});

test.each([1, 30])('[BOUNDARY] [SG2-69:AC6] preference endpoint accepts valid %i-day boundary and saves exact JSON', async days => {
  const fetch = respond({ frequency_days: days });
  expect(await loadReminderPreferences('token')).toEqual({ ok: true, value: { frequency_days: days } });
  expect(await saveReminderPreferences('token', days)).toEqual({ ok: true, value: { frequency_days: days } });
  expect(fetch).toHaveBeenLastCalledWith('/api/notifications/reminder-preferences', { method: 'PUT',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ frequency_days: days }) });
});

test.each([401, 403, 404, 503])('[FAILURE] [SG2-69:AC1] inbox HTTP %i has a safe recoverable message', async status => {
  respond({ error: 'private database detail' }, status);
  const result = await loadNotificationInbox('token');
  expect(result.ok).toBe(false);
  if (!result.ok) { expect(result.message).not.toContain('private'); expect(result.message).toMatch(/session|access|available|try again/i); }
});

test.each(['offline', 'invalid json'])('[FAILURE] [SG2-69:AC1] %s becomes a safe failed outcome', async failure => {
  vi.stubGlobal('fetch', vi.fn(async () => { if (failure === 'offline') throw Error('network'); return new Response('{'); }));
  expect((await loadNotificationInbox('token')).ok).toBe(false);
});

const malformedPages = [null, [], {}, { ...page, notifications: null }, { ...page, notifications: [null] },
  { ...page, notifications: [{ ...entry, source: 'other' }] }, { ...page, notifications: [{ ...entry, notification_id: 0 }] },
  { ...page, notifications: [{ ...entry, notification_id: 1.5 }] }, { ...page, notifications: [{ ...entry, notification_id: '2' }] },
  { ...page, notifications: [{ ...entry, created_at: 'no date' }] }, { ...page, notifications: [{ ...entry, created_at: null }] },
  { ...page, notifications: [{ ...entry, event_id: -1 }] }, { ...page, notifications: [{ ...entry, message: null }] },
  { ...page, notifications: [{ ...entry, kind: null }] }, { ...page, notifications: [{ ...entry, kind: 'unknown' }] },
  { ...page, notifications: [{ ...entry, source: 'hold', kind: 'event_submitted' }] },
  { ...page, notifications: [{ ...entry, read_at: 'invalid' }] }, { ...page, unread_count: -1 },
  { ...page, unread_count: 1.5 }, { ...page, unread_count: '1' }, { ...page, next_cursor: {} }];
test.each(malformedPages.map((value, index) => [index, value] as const))('[FAILURE] [SG2-69:AC1] malformed inbox response %i cannot become a trusted count/list', async (_index, value) => {
  respond(value); expect((await loadNotificationInbox('token')).ok).toBe(false);
});

test('[BOUNDARY] [SG2-69:AC2] empty inbox and a read hold with no event are valid', async () => {
  const fetch = respond({ notifications: [], unread_count: 0, next_cursor: null });
  expect((await loadNotificationInbox('token')).ok).toBe(true);
  fetch.mockResolvedValue(Response.json({ notifications: [{ ...entry, source: 'hold', kind: 'expired', event_id: null,
    read_at: entry.created_at }], unread_count: 0, next_cursor: null }));
  expect((await loadNotificationInbox('token')).ok).toBe(true);
});

test.each([null, {}, { notification: null, unread_count: 0 }, { notification: entry, unread_count: -1 }])(
  '[FAILURE] [SG2-69:AC3] malformed read response %j is rejected', async value => {
    respond(value); expect((await readNotification('token', 'event', 2)).ok).toBe(false);
  });
test.each([null, {}, { unread_count: -1 }])('[FAILURE] [SG2-69:AC4] invalid mark-all count %j is rejected', async value => {
  respond(value); expect((await readAllNotifications('token')).ok).toBe(false);
});
test.each([null, {}, { frequency_days: '1' }, { frequency_days: 0 }, { frequency_days: 31 }, { frequency_days: 1.5 }])(
  '[FAILURE] [SG2-69:AC6] invalid server preference %j is rejected', async value => {
    respond(value); expect((await loadReminderPreferences('token')).ok).toBe(false);
  });
test.each([null, {}, { event: null }, { event: {} },
  { event: { event_id: 1, name: null, status: 'planning', proposed_date: null } },
  { event: { event_id: 1, name: 'Forum', status: null, proposed_date: null } },
  { event: { event_id: 1, name: 'Forum', status: 'planning', proposed_date: 'invalid' } }])(
  '[FAILURE] [SG2-69:AC3] invalid event summary %j is rejected', async value => {
    respond(value); expect((await loadNotificationEvent('token', 'event', 2)).ok).toBe(false);
  });
