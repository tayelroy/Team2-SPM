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

test('[NORMAL] [SG2-55:AC4] an equipment reservation notice survives response validation with its event and receipt message', async () => {
  const reserved = { notification_id: 10, event_id: 55, request_id: null, kind: 'equipment_reserved',
    message: '6 × Wireless microphones reserved for Equipment Reservation Forum.', created_at: '2026-10-11T02:00:00.000Z' };
  respond(() => Response.json({ notifications: [reserved] }));
  expect(await loadNotifications('coordinator-token')).toEqual({ ok: true, notifications: [reserved] });
});

test('[NORMAL] [SG2-58:AC1] an event confirmation notice survives response validation for the organiser', async () => {
  const confirmed = { notification_id: 11, event_id: 7, request_id: null, kind: 'event_confirmed',
    message: 'Your event Confirmation Forum is confirmed.', created_at: '2026-10-11T02:00:00.000Z' };
  respond(() => Response.json({ notifications: [confirmed] }));
  expect(await loadNotifications('organiser-token')).toEqual({ ok: true, notifications: [confirmed] });
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

test('[NORMAL] [SG2-68:AC1] [SG2-68:AC2] every event lifecycle notice survives response validation with its event, message and time', async () => {
  const lifecycle = [
    ['event_submitted', 'Partner Forum was submitted and is waiting for a coordinator.'],
    ['coordinator_assigned', 'You are now coordinating Partner Forum.'],
    ['clarification_requested', 'Your coordinator has a question about Partner Forum.'],
    ['event_approved', 'Partner Forum was approved.'],
    ['event_rejected', 'Partner Forum was not approved: Clashes with the AGM']
  ].map(([kind, message], index) => ({ notification_id: 20 + index, event_id: 7, request_id: null, kind, message,
    created_at: '2026-10-13T02:00:00.000Z' }));
  respond(() => Response.json({ notifications: lifecycle }));
  expect(await loadNotifications('token')).toEqual({ ok: true, notifications: lifecycle });
});

test('[FAILURE] [SG2-68:AC2] a near-miss or inherited kind name is refused rather than shown unlabelled', async () => {
  for (const kind of ['event_submitted ', 'Event_approved', 'event_cancelled', 'toString', 7]) {
    respond(() => Response.json({ notifications: [{ ...rejected, kind }] }));
    expect(await loadNotifications('token')).toEqual({ ok: false, message: 'Could not load notifications. Please try again.' });
  }
});
