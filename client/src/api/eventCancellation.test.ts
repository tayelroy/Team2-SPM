import { afterEach, describe, expect, test, vi } from 'vitest';
import { cancelEvent, requestCancellation } from './eventCancellation';

afterEach(() => {
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UNAVAILABLE = { ok: false, message: 'Cancellation is temporarily unavailable. Please try again.' };

describe('requestCancellation (SG2-67 AC1)', () => {
  test('[NORMAL] [SG2-67:AC1] posts the reason with the caller token and returns when it was asked', async () => {
    const fetchMock = vi.fn(async () => json({ event_id: 7, cancellation_requested_at: '2026-10-21T07:00:00Z', coordinator_notified: true }, 201));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestCancellation(7, 'Speaker withdrew', 'organiser-token')).resolves.toEqual({
      ok: true, value: { requestedAt: '2026-10-21T07:00:00Z', coordinatorNotified: true }
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/7/cancellation-request', {
      method: 'POST',
      headers: { Authorization: 'Bearer organiser-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Speaker withdrew' })
    });
  });

  test('[CONFLICT] [SG2-67:AC1] a refusal shows the server\'s own words, or a plain fallback when it gives none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'A cancellation has already been requested for this event.', code: 'requested' }, 409)));
    await expect(requestCancellation(7, 'Again', 't')).resolves.toEqual({
      ok: false, message: 'A cancellation has already been requested for this event.'
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 404 })));
    await expect(requestCancellation(7, 'Again', 't')).resolves.toEqual({ ok: false, message: 'That cancellation was not accepted.' });
  });

  test('[FAILURE] [SG2-67:AC1] another role, a lost connection, a server error or a malformed success are never shown as success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Access denied' }, 403)));
    await expect(requestCancellation(7, 'r', 't')).resolves.toEqual({
      ok: false, message: 'Only the organiser who created this event can ask to cancel it.'
    });
    for (const respond of [
      async () => { throw new TypeError('offline'); },
      async () => json({ error: 'boom' }, 503),
      async () => json({ cancellation_requested_at: 7, coordinator_notified: true }, 201),
      async () => json(['not', 'an', 'object'], 201),
      async () => json(null, 201),
      async () => new Response('not json', { status: 201 })
    ]) {
      vi.stubGlobal('fetch', vi.fn(respond));
      await expect(requestCancellation(7, 'r', 't')).resolves.toEqual(UNAVAILABLE);
    }
  });
});

describe('cancelEvent (SG2-67 AC1-AC4)', () => {
  test('[NORMAL] [SG2-67:AC2] [SG2-67:AC3] patches with the caller token and reports released venues and notified attendees', async () => {
    const fetchMock = vi.fn(async () => json({
      event_id: 7, status: 'cancelled', cancelled_at: '2026-10-21T08:00:00Z', bookings_released: 2, attendees_notified: 3
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(cancelEvent(7, 'coordinator-token')).resolves.toEqual({
      ok: true, value: { cancelledAt: '2026-10-21T08:00:00Z', bookingsReleased: 2, attendeesNotified: 3 }
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/7/cancel', {
      method: 'PATCH', headers: { Authorization: 'Bearer coordinator-token' }
    });
  });

  test('[BOUNDARY] [SG2-67:AC2] [SG2-67:AC3] zero counts are a success; a negative count is not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ cancelled_at: '2026-10-21T08:00:00Z', bookings_released: 0, attendees_notified: 0 })));
    await expect(cancelEvent(7, 't')).resolves.toEqual({
      ok: true, value: { cancelledAt: '2026-10-21T08:00:00Z', bookingsReleased: 0, attendeesNotified: 0 }
    });
    vi.stubGlobal('fetch', vi.fn(async () => json({ cancelled_at: '2026-10-21T08:00:00Z', bookings_released: -1, attendees_notified: 0 })));
    await expect(cancelEvent(7, 't')).resolves.toEqual(UNAVAILABLE);
  });

  test('[FAILURE] [SG2-67:AC1] the organiser or another role is told only the assigned coordinator can cancel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'Authentication required' }, 401)));
    await expect(cancelEvent(7, 't')).resolves.toEqual({
      ok: false, message: 'Only the assigned Event Coordinator can cancel this event.'
    });
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'The organiser has not asked for this event to be cancelled.' }, 409)));
    await expect(cancelEvent(7, 't')).resolves.toEqual({
      ok: false, message: 'The organiser has not asked for this event to be cancelled.'
    });
  });
});
