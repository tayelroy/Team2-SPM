import { afterEach, expect, test, vi } from 'vitest';
import { VenueLayoutError, describeLayouts, fetchVenueLayouts, saveVenueLayouts } from './layoutsApi';

afterEach(() => vi.unstubAllGlobals());

test('describeLayouts summarises the recorded set, falling back to "Other" for an unnamed custom layout', () => {
  expect(describeLayouts([])).toBe('NA');
  expect(describeLayouts([{ layout: 'classroom', other_description: null }])).toBe('Classroom');
  expect(describeLayouts([
    { layout: 'classroom', other_description: null },
    { layout: 'theatre', other_description: null },
    { layout: 'other', other_description: 'U-shape' }
  ])).toBe('Classroom, Theatre, U-shape');
  expect(describeLayouts([{ layout: 'other', other_description: null }])).toBe('Other');
});

test.each([
  [401, 'Your session has expired. Sign in again.'],
  [403, 'You no longer have permission to do this.'],
  [400, 'Choose a layout for each entry; "Other" needs a short description.'],
  [404, 'This venue is no longer available. Reload the catalogue.'],
  [503, 'Unable to reach the venue service. Please try again.']
] as const)('VenueLayoutError(%i) carries a safe, user-facing message', (status, message) => {
  expect(new VenueLayoutError(status).message).toBe(message);
});

test('fetchVenueLayouts requests the venue\'s layouts with the bearer token and no caching', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ layouts: [{ layout: 'classroom', other_description: null }] }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await fetchVenueLayouts('session-token', controller.signal, 7);

  expect(result).toEqual([{ layout: 'classroom', other_description: null }]);
  expect(fetchMock).toHaveBeenCalledWith('/api/venues/7/layouts', {
    headers: { Authorization: 'Bearer session-token' }, cache: 'no-store', signal: controller.signal
  });
});

test('fetchVenueLayouts throws VenueLayoutError on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(fetchVenueLayouts('token', new AbortController().signal, 7)).rejects.toThrow('Unable to reach the venue service');
});

test('saveVenueLayouts PUTs the complete replacement set as JSON', async () => {
  const controller = new AbortController();
  const layouts = [{ layout: 'classroom' as const }];
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ layouts: [{ layout: 'classroom', other_description: null }] }));
  vi.stubGlobal('fetch', fetchMock);

  const result = await saveVenueLayouts('session-token', controller.signal, 7, layouts);

  expect(result).toEqual([{ layout: 'classroom', other_description: null }]);
  expect(fetchMock).toHaveBeenCalledWith('/api/venues/7/layouts', {
    method: 'PUT',
    headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
    cache: 'no-store', signal: controller.signal,
    body: JSON.stringify({ layouts })
  });
});

test('saveVenueLayouts throws VenueLayoutError on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 400 })));
  await expect(saveVenueLayouts('token', new AbortController().signal, 7, [])).rejects.toThrow('Choose a layout for each entry');
});
