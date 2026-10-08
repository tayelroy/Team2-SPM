vi.hoisted(() => vi.stubEnv('TZ', 'UTC'));

import { afterAll, afterEach, expect, test, vi } from 'vitest';
import {
  UNAVAILABILITY_CATEGORIES, VenueBlockError, createVenueBlock, describePeriod, describeRecorded, fetchVenueBlocks, removeVenueBlock
} from './blocksApi';

afterEach(() => vi.unstubAllGlobals());

const values = { starts_at: '2030-07-01T01:00:00.000Z', ends_at: '2030-07-01T09:00:00.000Z', category: 'renovation' as const, reason: 'Carpet replacement' };
const block = { unavailability_id: 4, ...values, created_at: '2026-10-05T01:00:00.000Z', created_by_name: 'Vera Staff', affected: [] };

test('[NORMAL] [SG2-45:block-period] describePeriod joins the formatted start and end', () => {
  expect(describePeriod(block.starts_at, block.ends_at))
    .toBe('1 Jul 2030, 1:00 am – 1 Jul 2030, 9:00 am');
});

test('[NORMAL] [SG2-80:AC1] the reasons offered are exactly the five listed in the story', () => {
  expect(Object.values(UNAVAILABILITY_CATEGORIES)).toEqual(['Maintenance', 'Equipment failure', 'Renovation', 'Safety concern', 'Other']);
});

test('[BOUNDARY] [SG2-80:AC6] describeRecorded names the recorder and time, a removed recorder, or a period from before recording began', () => {
  expect(describeRecorded(block)).toBe('Recorded by Vera Staff on 5 Oct 2026, 1:00 am');
  expect(describeRecorded({ ...block, created_by_name: null })).toBe('Recorded by a former user on 5 Oct 2026, 1:00 am');
  expect(describeRecorded({ created_at: null, created_by_name: null })).toBe('Recorded before who and when were kept');
});

test.each([
  [401, 'Your session has expired. Sign in again.'],
  [403, 'You no longer have permission to do this.'],
  [400, 'Enter a start and an end, with the end after the start and not in the past, a reason and a note.'],
  [404, 'This venue or block no longer exists. Reload the catalogue.'],
  [409, 'Unable to reach the venue service. Please try again.'],
  [503, 'Unable to reach the venue service. Please try again.']
] as const)('[FAILURE] [SG2-45:block-errors] VenueBlockError(%i) carries a safe, user-facing message', (status, message) => {
  expect(new VenueBlockError(status).message).toBe(message);
});

test('[NORMAL] [SG2-45:AC1] fetchVenueBlocks requests the venue\'s blocks with the bearer token and no caching', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ blocks: [block] }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await fetchVenueBlocks('session-token', controller.signal, 7)).toEqual([block]);
  expect(fetchMock).toHaveBeenCalledWith('/api/venues/7/blocks', {
    headers: { Authorization: 'Bearer session-token' }, cache: 'no-store', signal: controller.signal
  });
});

test('[FAILURE] [SG2-45:AC1] fetchVenueBlocks throws VenueBlockError on a non-ok response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
  await expect(fetchVenueBlocks('token', new AbortController().signal, 7)).rejects.toThrow('Unable to reach the venue service');
});

test('[NORMAL] [SG2-80:AC1] createVenueBlock POSTs the period, reason and note as JSON', async () => {
  const controller = new AbortController();
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

test('[FAILURE] [SG2-80:AC1] createVenueBlock throws VenueBlockError when the server refuses the values', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'bad' }, { status: 400 })));
  const failure = await createVenueBlock('token', new AbortController().signal, 7, values).catch(error => error);
  expect(failure).toBeInstanceOf(VenueBlockError);
  expect(failure.status).toBe(400);
});

test('[NORMAL] [SG2-45:AC3] removeVenueBlock DELETEs the block and throws on failure', async () => {
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

afterAll(() => vi.unstubAllEnvs());
