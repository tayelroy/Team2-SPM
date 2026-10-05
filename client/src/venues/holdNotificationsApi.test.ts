import { afterEach, expect, test, vi } from 'vitest';
import { loadHoldNotifications, type HoldNotification } from './holdNotificationsApi';

afterEach(() => vi.unstubAllGlobals());

const notification: HoldNotification = {
  notification_id: 1, event_id: 8, hold_id: 3, kind: 'placed',
  message: 'A tentative hold was placed on Atrium.', created_at: '2026-10-05T02:00:00.000Z',
};

test('[NORMAL] [SG2-84:AC6] [SG2-85:AC4] loads recipient notifications with bearer authentication and retains only public fields', async () => {
  const notifications = ['placed', 'warning', 'expired'].map((kind, index) => ({
    ...notification, notification_id: index + 1, kind, secret: 'not retained',
  }));
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ notifications, secret: 'not retained' }));
  vi.stubGlobal('fetch', fetchMock);

  expect(await loadHoldNotifications('coordinator-token')).toEqual({
    ok: true, notifications: notifications.map(({ secret: _secret, ...entry }) => entry),
  });
  expect(fetchMock).toHaveBeenCalledWith('/api/venue-holds/notifications', {
    headers: { Authorization: 'Bearer coordinator-token' }, cache: 'no-store',
  });
});

test('[BOUNDARY] [SG2-84:AC6] [SG2-85:AC4] accepts an empty recipient inbox', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ notifications: [] })));
  expect(await loadHoldNotifications('token')).toEqual({ ok: true, notifications: [] });
});

test.each([
  [401, 'unauthorized', 'Your session has expired. Sign in again to view notifications.'],
  [403, 'forbidden', 'You do not have access to hold notifications.'],
  [503, 'unavailable', 'Could not load hold notifications. Please try again.'],
  [500, 'unavailable', 'Could not load hold notifications. Please try again.'],
])('[FAILURE] [SG2-84:AC6] [SG2-85:AC4] maps HTTP %s into a safe recoverable state', async (status, kind, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server details', { status: Number(status) })));
  expect(await loadHoldNotifications('token')).toEqual({ ok: false, kind, message });
});

test('[FAILURE] [SG2-84:AC6] [SG2-85:AC4] handles unreachable service and invalid JSON without throwing', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
  expect(await loadHoldNotifications('token')).toEqual({ ok: false, kind: 'unavailable', message: 'Could not load hold notifications. Please try again.' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')));
  expect((await loadHoldNotifications('token')).ok).toBe(false);
});

test.each([
  null, {}, { notifications: null }, { notifications: [null] },
  ...['notification_id', 'event_id', 'hold_id', 'kind', 'message', 'created_at'].map(field => ({ notifications: [{ ...notification, [field]: null }] })),
  ...['notification_id', 'event_id', 'hold_id'].flatMap(field => [0, 1.5, -1, '1', Number.MAX_SAFE_INTEGER + 1].map(value => ({ notifications: [{ ...notification, [field]: value }] }))),
  { notifications: [{ ...notification, kind: 'booking' }] },
  { notifications: [{ ...notification, created_at: 'not a timestamp' }] },
])('[FAILURE] [SG2-84:AC6] [SG2-85:AC4] rejects malformed inbox data %j', async data => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
  expect(await loadHoldNotifications('token')).toEqual({ ok: false, kind: 'unavailable', message: 'Could not load hold notifications. Please try again.' });
});
