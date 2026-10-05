import { afterEach, expect, test, vi } from 'vitest';
import { VenueOperationsError, describeTimes, fetchVenueOperations, saveVenueOperations } from './operationsApi';

afterEach(() => { vi.unstubAllGlobals(); });

const operations = { setup_minutes: 30, turnaround_minutes: 45, emergency_access: null, known_restrictions: null, updated_at: null };

test('[NORMAL] [SG2-77:AC1] reads and saves a venue\'s operations with the bearer token and no caching', async () => {
  const fetch = vi.fn(async () => Response.json({ operations }));
  vi.stubGlobal('fetch', fetch);
  const signal = new AbortController().signal;
  expect(await fetchVenueOperations('token-1', signal, 7)).toEqual(operations);
  expect(await saveVenueOperations('token-1', signal, 7, operations)).toEqual(operations);
  expect(fetch).toHaveBeenNthCalledWith(1, '/api/venues/7/operations', { headers: { Authorization: 'Bearer token-1' }, cache: 'no-store', signal });
  expect(fetch).toHaveBeenNthCalledWith(2, '/api/venues/7/operations', expect.objectContaining({
    method: 'PUT', cache: 'no-store', body: JSON.stringify(operations),
    headers: { Authorization: 'Bearer token-1', 'Content-Type': 'application/json' }
  }));
});

test.each([
  [401, 'Your session has expired. Sign in again.'],
  [403, 'You no longer have permission to do this.'],
  [400, 'Enter setup and turnaround times as whole minutes from 0 to 1440, and keep each safety note within 2000 characters.'],
  [404, 'This venue is no longer available. Reload the catalogue.'],
  [503, 'Unable to reach the venue service. Please try again.'],
])('[FAILURE] [SG2-77:AC6] a %i response becomes a plain-language error for both read and save', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
  const signal = new AbortController().signal;
  await expect(fetchVenueOperations('t', signal, 1)).rejects.toEqual(new VenueOperationsError(status));
  await expect(saveVenueOperations('t', signal, 1, operations)).rejects.toThrow(message);
});

test('[BOUNDARY] [SG2-77:AC3] describes 0 minutes as well as recorded times', () => {
  expect(describeTimes({ ...operations, setup_minutes: 0, turnaround_minutes: 0 })).toBe('0 min setup · 0 min turnaround');
  expect(describeTimes(operations)).toBe('30 min setup · 45 min turnaround');
});
