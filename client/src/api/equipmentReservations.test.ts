import { afterEach, expect, test, vi } from 'vitest';
import { loadEquipmentReservations, reserveEquipment } from './equipmentReservations';
afterEach(() => vi.unstubAllGlobals());
test('[NORMAL] [SG2-55:AC4] event reservations are read with an authenticated, uncached and cancellable request', async () => {
  const signal = new AbortController().signal; const result = { reservations: [], can_reserve: false };
  const fetch = vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal('fetch', fetch);
  expect(await loadEquipmentReservations(7, 'token', signal)).toEqual(result);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-reservations?event_id=7', { headers: { Authorization: 'Bearer token' }, cache: 'no-store', signal });
});
test('[NORMAL] [BOUNDARY] [SG2-55:AC1] [SG2-55:AC2] reservation submits the request version and exact chosen period without a client quantity override', async () => {
  const signal = new AbortController().signal; const result = { reservations: [{ reservation_id: 81 }], can_reserve: true, coordinator_notified: true };
  const values = { version: 2, starts_at: '2030-06-01T10:00:00+08:00', ends_at: '2030-06-01T12:00:00+08:00' };
  const fetch = vi.fn().mockResolvedValue(Response.json(result, { status: 201 })); vi.stubGlobal('fetch', fetch);
  expect(await reserveEquipment(7, 11, 'token', signal, values)).toEqual(result);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-requests/11/reservation', { method: 'POST', body: JSON.stringify({ event_id: 7, ...values }), headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', signal });
});
test.each([
  [400, 'invalid', 'Choose a valid reservation period, with the end after the start.'],
  [401, 'private', 'Your session has expired. Sign in again.'],
  [403, 'private', 'You do not have permission to view or reserve equipment for this event.'],
  [404, 'missing', 'This event or equipment request is no longer available to you.'],
  [409, 'insufficient', 'There is not enough available equipment for these dates. Refresh reservations and requirements before trying again.'],
  [409, 'closed', 'The request, event or reservation changed. Refresh reservations and requirements before trying again.'],
  [409, 'conflict', 'The request, event or reservation changed. Refresh reservations and requirements before trying again.'],
  [503, 'private', 'Equipment reservations are unavailable. Please try again.'],
])('[FAILURE] [CONFLICT] [SG2-55:AC3] HTTP %i with reason %s returns only the safe recovery message', async (status, code, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code, error: 'Private diagnostics' }, { status: Number(status) })));
  await expect(loadEquipmentReservations(7, 'token', new AbortController().signal)).rejects.toMatchObject({ status, message });
});
test.each([null, 'not json'])('[FAILURE] [SG2-55:AC3] missing error metadata %s still produces a safe status error', async body => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body === null ? Response.json(null, { status: 409 }) : new Response(body, { status: 409 })));
  await expect(loadEquipmentReservations(7, 'token', new AbortController().signal)).rejects.toMatchObject({ status: 409, message: 'The request, event or reservation changed. Refresh reservations and requirements before trying again.' });
});
test('[CONFLICT] [SG2-55:AC1] an aborted reservation propagates cancellation without inventing a successful receipt', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
  await expect(reserveEquipment(7, 11, 'token', new AbortController().signal, { version: 2, starts_at: '2030-06-01T02:00:00Z', ends_at: '2030-06-01T04:00:00Z' })).rejects.toMatchObject({ name: 'AbortError' });
});
