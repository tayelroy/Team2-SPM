import { afterEach, expect, test, vi } from 'vitest';
import { loadEquipmentAvailability } from './equipmentAvailability';
afterEach(() => vi.unstubAllGlobals());
test('[NORMAL] [SG2-54:AC1] request availability is read with authenticated uncached and cancellable GET', async () => {
  const signal = new AbortController().signal; const result = { status: 'dates_required', proposed_start: null };
  const fetch = vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal('fetch', fetch);
  expect(await loadEquipmentAvailability(7, 11, 'token', signal)).toEqual(result);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-requests/11/availability?event_id=7', { headers: { Authorization: 'Bearer token' }, cache: 'no-store', signal });
});
test('[BOUNDARY] [SG2-54:AC1] explicit zoned dates are encoded without inventing or shifting a period', async () => {
  const signal = new AbortController().signal; const result = { status: 'ready', quantity_remaining: 3 };
  const fetch = vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal('fetch', fetch);
  expect(await loadEquipmentAvailability(7, 11, 'token', signal, { starts_at: '2030-06-01T10:00:00+08:00', ends_at: '2030-06-01T11:00:00+08:00' })).toEqual(result);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/equipment-requests/11/availability?event_id=7&starts_at=2030-06-01T10%3A00%3A00%2B08%3A00&ends_at=2030-06-01T11%3A00%3A00%2B08%3A00', { headers: { Authorization: 'Bearer token' }, cache: 'no-store', signal });
});
test.each([[400, 'Choose a valid start and end, with the end after the start.'], [401, 'Your session has expired. Sign in again.'], [403, 'Only Technical Support Staff can check equipment availability.'], [404, 'This event or equipment request is no longer available.'], [503, 'Equipment availability is unavailable. Please try again.']])('[FAILURE] [SG2-54:AC1] HTTP %i rejects with a safe recovery message', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Private details' }, { status: Number(status) })));
  await expect(loadEquipmentAvailability(7, 11, 'token', new AbortController().signal)).rejects.toMatchObject({ status, message });
});
test('[CONFLICT] [SG2-54:AC1] aborted transport rejects without a stale availability result', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
  await expect(loadEquipmentAvailability(7, 11, 'token', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
});
