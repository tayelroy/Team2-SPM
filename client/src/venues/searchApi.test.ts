import { afterEach, expect, test, vi } from 'vitest';
import { EMPTY_SEARCH, VenueSearchError, formatSgt, isoToSgtLocal, searchVenues, sgtToIso } from './searchApi';

afterEach(() => vi.unstubAllGlobals());

test('[BOUNDARY] [SG2-46:AC2] Singapore-time form values convert to and from UTC instants', () => {
  expect(sgtToIso('2030-06-15T00:00')).toBe('2030-06-14T16:00:00.000Z');
  expect(isoToSgtLocal('2030-06-14T16:00:00.000Z')).toBe('2030-06-15T00:00');
  expect(formatSgt('2030-06-14T16:00:00.000Z')).toBe('15 Jun 2030, 12:00 am');
});

test.each([
  [401, undefined, 'Your session has expired. Sign in again.'],
  [403, undefined, 'Only Event Coordinators can search venues.'],
  [400, undefined, 'Check the search criteria and try again.'],
  [400, 'The search period must not exceed 31 days.', 'The search period must not exceed 31 days.'],
  [503, undefined, 'Venue search is unavailable right now. Please try again.']
] as const)('[FAILURE] [SG2-46:AC2] VenueSearchError(%i) carries a safe message', (status, detail, message) => {
  expect(new VenueSearchError(status, detail).message).toBe(message);
});

test('[NORMAL] [SG2-46:AC2] searchVenues sends only the criteria that are filled in, with the bearer token', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ venues: [{ venue_id: 1 }] }));
  vi.stubGlobal('fetch', fetchMock);
  const venues = await searchVenues('session-token', controller.signal, {
    ...EMPTY_SEARCH, from: '2030-06-15T00:00', until: '2030-06-15T23:59', attendance: ' 80 ', layout: 'theatre', accessibility: 'step-free'
  });
  expect(venues).toEqual([{ venue_id: 1 }]);
  const [url, init] = fetchMock.mock.calls[0];
  const query = new URL(url, 'http://local').searchParams;
  expect(Object.fromEntries(query)).toEqual({
    from: '2030-06-14T16:00:00.000Z', to: '2030-06-15T15:59:00.000Z', attendance: '80', layout: 'theatre', accessibility: 'step-free'
  });
  expect(init).toEqual({ headers: { Authorization: 'Bearer session-token' }, cache: 'no-store', signal: controller.signal });
});

const values = { ...EMPTY_SEARCH, from: '2030-06-15T00:00', until: '2030-06-15T23:59' };

test('[FAILURE] [SG2-46:AC2] a 400 surfaces the server\'s reason when it gives one', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'from must be earlier than to.' }, { status: 400 })));
  await expect(searchVenues('t', new AbortController().signal, values)).rejects.toThrow('from must be earlier than to.');
  for (const response of [new Response('not json', { status: 400 }), Response.json({ error: 7 }, { status: 400 })]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(searchVenues('t', new AbortController().signal, values)).rejects.toThrow('Check the search criteria');
  }
});

test('[FAILURE] [SG2-46:AC2] other failures throw a VenueSearchError for their status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(searchVenues('t', new AbortController().signal, values)).rejects.toThrow('Venue search is unavailable');
});
