import { afterEach, expect, test, vi } from 'vitest';
import { loadAllVenuesAvailability } from './availability';

afterEach(() => vi.unstubAllGlobals());

const VALID = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-31T00:00:00.000Z',
  venues: [
    {
      venueId: 1,
      name: 'Atrium',
      entries: [{ start: '2026-10-05T09:00:00.000Z', end: '2026-10-05T12:00:00.000Z', kind: 'booking', label: 'held' }]
    }
  ]
};

test('no session token denies access without making a request', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expect(await loadAllVenuesAvailability(null, VALID.from, VALID.to)).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('loads and validates the response with the session token and date range', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ ...VALID, secret: 'not retained' }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await loadAllVenuesAvailability('session-token', VALID.from, VALID.to, controller.signal);

  expect(result).toEqual(VALID);
  expect(fetchMock).toHaveBeenCalledWith(
    `/api/venues/availability?from=${encodeURIComponent(VALID.from)}&to=${encodeURIComponent(VALID.to)}`,
    { headers: { Authorization: 'Bearer session-token' }, cache: 'no-store', signal: controller.signal }
  );
});

test.each([401, 403])('denies access when the server returns %s', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status })));
  expect(await loadAllVenuesAvailability('token', VALID.from, VALID.to)).toBeNull();
});

test('outage and abort failures cannot produce a result', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(loadAllVenuesAvailability('token', VALID.from, VALID.to)).rejects.toThrow('Unable to load venue availability');

  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')));
  await expect(loadAllVenuesAvailability('token', VALID.from, VALID.to)).rejects.toThrow('Aborted');
});

test.each([
  null,
  {},
  { from: 1, to: VALID.to, venues: [] },
  { from: VALID.from, to: 2, venues: [] },
  { from: VALID.from, to: VALID.to, venues: 'nope' },
  { from: VALID.from, to: VALID.to, venues: [{ venueId: '1', name: 'A', entries: [] }] },
  { from: VALID.from, to: VALID.to, venues: [{ venueId: 1, name: 5, entries: [] }] },
  { from: VALID.from, to: VALID.to, venues: [{ venueId: 1, name: 'A', entries: 'nope' }] },
  { from: VALID.from, to: VALID.to, venues: [{ venueId: 1, name: 'A', entries: [{ start: 1, end: 'e', kind: 'booking', label: 'l' }] }] },
  { from: VALID.from, to: VALID.to, venues: [{ venueId: 1, name: 'A', entries: [{ start: 's', end: 1, kind: 'booking', label: 'l' }] }] },
  { from: VALID.from, to: VALID.to, venues: [{ venueId: 1, name: 'A', entries: [{ start: 's', end: 'e', kind: 'nope', label: 'l' }] }] },
  { from: VALID.from, to: VALID.to, venues: [{ venueId: 1, name: 'A', entries: [{ start: 's', end: 'e', kind: 'booking', label: 5 }] }] }
])('rejects malformed responses: %j', async (data) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
  await expect(loadAllVenuesAvailability('token', VALID.from, VALID.to)).rejects.toThrow('Invalid venue availability response');
});
