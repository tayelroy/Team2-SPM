import { afterEach, expect, test, vi } from 'vitest';
import { loadNotifications } from './notificationsApi';

afterEach(() => { vi.unstubAllGlobals(); });

const rejected = { notification_id: 8, event_id: 7, request_id: 41, kind: 'venue_request_rejected',
  message: 'Atrium Hall was rejected for Forum: Rewiring', created_at: '2026-10-06T02:00:00.000Z' };

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('[NORMAL] [SG2-49:AC2] the caller\'s notifications are loaded with their token, uncached', async () => {
  const fetch = respond(() => Response.json({ notifications: [rejected, { ...rejected, notification_id: 9, event_id: null, request_id: null, kind: 'venue_request_approved' }] }));
  const result = await loadNotifications('coordinator-token');
  expect(result).toEqual({ ok: true, notifications: [rejected, { ...rejected, notification_id: 9, event_id: null, request_id: null, kind: 'venue_request_approved' }] });
  expect(fetch).toHaveBeenCalledWith('/api/notifications', { headers: { Authorization: 'Bearer coordinator-token' }, cache: 'no-store' });
});

test('[FAILURE] [SG2-49:AC1] an expired session, a server failure or a network error are explained', async () => {
  const unavailable = { ok: false, message: 'Could not load notifications. Please try again.' };
  respond(() => new Response(null, { status: 401 }));
  expect(await loadNotifications('token')).toEqual({ ok: false, message: 'Your session has expired. Sign in again to view notifications.' });
  respond(() => new Response(null, { status: 503 }));
  expect(await loadNotifications('token')).toEqual(unavailable);
  respond(() => { throw new TypeError('Failed to fetch'); });
  expect(await loadNotifications('token')).toEqual(unavailable);
});

test('[BOUNDARY] [SG2-49:AC1] a response of the wrong shape is treated as unavailable; an empty inbox is valid', async () => {
  const unavailable = { ok: false, message: 'Could not load notifications. Please try again.' };
  for (const body of [null, {}, { notifications: 'none' }, { notifications: [{ ...rejected, kind: 'placed' }] },
    { notifications: [{ ...rejected, created_at: 'never' }] }, { notifications: [{ ...rejected, notification_id: '8' }] }]) {
    respond(() => Response.json(body));
    expect(await loadNotifications('token')).toEqual(unavailable);
  }
  respond(() => Response.json({ notifications: [] }));
  expect(await loadNotifications('token')).toEqual({ ok: true, notifications: [] });
});
