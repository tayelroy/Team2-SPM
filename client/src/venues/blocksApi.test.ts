import { afterEach, expect, test, vi } from 'vitest';
import { VenueBlockError, createVenueBlock, describePeriod, fetchVenueBlocks, removeVenueBlock } from './blocksApi';

afterEach(() => vi.unstubAllGlobals());

const block = { unavailability_id: 4, starts_at: '2030-07-01T01:00:00.000Z', ends_at: '2030-07-01T09:00:00.000Z', reason: 'Carpet replacement' };
const booking = { booking_id: 7, event_id: 3, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z' };

test('describePeriod joins the formatted start and end', () => {
  const format = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
  expect(describePeriod(block.starts_at, block.ends_at))
    .toBe(`${format.format(new Date(block.starts_at))} – ${format.format(new Date(block.ends_at))}`);
});

test.each([
  [401, 'Your session has expired. Sign in again.'],
  [403, 'You no longer have permission to do this.'],
  [400, 'Enter a start and an end, with the end after the start and not in the past, and a reason.'],
  [404, 'This venue or block no longer exists. Reload the catalogue.'],
  [409, 'This period already holds a confirmed booking.'],
  [503, 'Unable to reach the venue service. Please try again.']
] as const)('VenueBlockError(%i) carries a safe, user-facing message', (status, message) => {
  expect(new VenueBlockError(status).message).toBe(message);
});

test('a conflict names the confirmed booking, with its event when there is one', () => {
  const period = describePeriod(booking.starts_at, booking.ends_at);
  expect(new VenueBlockError(409, booking).message)
    .toBe(`This period already holds a confirmed booking: booking #7 for event 3, ${period}.`);
  expect(new VenueBlockError(409, { ...booking, event_id: null }).message)
    .toBe(`This period already holds a confirmed booking: booking #7, ${period}.`);
});

test('fetchVenueBlocks requests the venue\'s blocks with the bearer token and no caching', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ blocks: [block] }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await fetchVenueBlocks('session-token', controller.signal, 7)).toEqual([block]);
  expect(fetchMock).toHaveBeenCalledWith('/api/venues/7/blocks', {
    headers: { Authorization: 'Bearer session-token' }, cache: 'no-store', signal: controller.signal
  });
});

test('fetchVenueBlocks throws VenueBlockError on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(fetchVenueBlocks('token', new AbortController().signal, 7)).rejects.toThrow('Unable to reach the venue service');
});

test('createVenueBlock POSTs the period and reason as JSON', async () => {
  const controller = new AbortController();
  const values = { starts_at: block.starts_at, ends_at: block.ends_at, reason: block.reason };
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ block }, { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await createVenueBlock('session-token', controller.signal, 7, values)).toEqual(block);
  expect(fetchMock).toHaveBeenCalledWith('/api/venues/7/blocks', {
    method: 'POST',
    headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
    cache: 'no-store', signal: controller.signal,
    body: JSON.stringify(values)
  });
});

test('createVenueBlock surfaces the conflicting booking from a 409', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'conflict', booking }, { status: 409 })));
  const failure = await createVenueBlock('token', new AbortController().signal, 7, block).catch(error => error);
  expect(failure).toBeInstanceOf(VenueBlockError);
  expect(failure.booking).toEqual(booking);
});

test('a 409 without a readable body still reports the conflict', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 409 })));
  await expect(createVenueBlock('token', new AbortController().signal, 7, block)).rejects.toThrow(/^This period already holds a confirmed booking\.$/);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'conflict' }, { status: 409 })));
  await expect(createVenueBlock('token', new AbortController().signal, 7, block)).rejects.toThrow(/^This period already holds a confirmed booking\.$/);
});

test('removeVenueBlock DELETEs the block and throws on failure', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  await removeVenueBlock('session-token', controller.signal, 7, 4);
  expect(fetchMock).toHaveBeenCalledWith('/api/venues/7/blocks/4', {
    method: 'DELETE', headers: { Authorization: 'Bearer session-token' }, cache: 'no-store', signal: controller.signal
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
  await expect(removeVenueBlock('token', controller.signal, 7, 4)).rejects.toThrow('no longer exists');
});
