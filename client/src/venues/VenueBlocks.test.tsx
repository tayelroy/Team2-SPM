import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Venues from '../screens/Venues';
import type { Venue } from './api';
import { describePeriod, type VenueBlock } from './blocksApi';

const venue: Venue = { venue_id: 1, name: 'Atrium Hall', location: 'North Wing', capacity: 100,
  facilities: 'Stage', accessibility_features: 'Hearing loop', operating_information: 'Weekdays, 09:00–18:00' };
const staff = { userId: 'staff', role: 'venue_staff',
  permissions: ['venues.read', 'venues.create', 'venues.update', 'venues.blocks.manage'] };
const coordinator = { userId: 'coordinator', role: 'event_coordinator', permissions: ['venues.read'] };
const existing: VenueBlock = { unavailability_id: 1, starts_at: '2030-08-01T01:00:00.000Z', ends_at: '2030-08-02T01:00:00.000Z', reason: 'Scheduled maintenance' };
const booking = { booking_id: 7, event_id: 3, starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z' };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response | undefined;

function api(identity = staff, blocks: VenueBlock[] = [], override?: Handler) {
  let rows = structuredClone(blocks);
  let nextId = 10;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const custom = await override?.(url, init);
    if (custom) return custom;
    if (url === '/api/auth/me') return Response.json(identity);
    if (url === '/api/venues') return Response.json({ venues: [venue] });
    if (url === '/api/venues/1/blocks' && !init?.method) return Response.json({ blocks: rows });
    if (url === '/api/venues/1/blocks' && init?.method === 'POST') {
      const block = { unavailability_id: nextId++, ...JSON.parse(init.body as string) };
      rows.push(block);
      return Response.json({ block }, { status: 201 });
    }
    const removal = /^\/api\/venues\/1\/blocks\/(\d+)$/.exec(url);
    if (removal && init?.method === 'DELETE') {
      rows = rows.filter(row => row.unavailability_id !== Number(removal[1]));
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

async function openBlocks(blocks: VenueBlock[] = [], override?: Handler) {
  const fetch = api(staff, blocks, override);
  const view = render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Block Atrium Hall' }));
  expect(screen.getByRole('heading', { name: 'Block Atrium Hall' })).toBeInTheDocument();
  return { fetch, ...view };
}

function fillBlock(start: string, end: string, reason: string) {
  fireEvent.change(screen.getByLabelText('Unavailable from'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Unavailable until'), { target: { value: end } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: reason } });
  fireEvent.submit(screen.getByRole('form', { name: 'Block venue' }));
}

function abortable(_url: string, init?: RequestInit) {
  return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
}

test('only callers who may manage blocks see the block control', async () => {
  api(coordinator);
  render(<Venues accessToken="test-token" onBook={vi.fn()} />);
  await screen.findByRole('searchbox');
  expect(screen.queryByRole('button', { name: /^Block/ })).not.toBeInTheDocument();
});

test('the block screen lists the venue\'s upcoming blocks, or says there are none', async () => {
  await openBlocks([existing]);
  const item = await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  expect(item).toHaveTextContent(describePeriod(existing.starts_at, existing.ends_at));
  cleanup();
  await openBlocks([]);
  expect(await screen.findByText(/No upcoming blocks/)).toBeInTheDocument();
});

test('AC1: blocking a free period with a reason records it and shows it in the list, earliest first', async () => {
  const { fetch } = await openBlocks([existing]);
  await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  fillBlock('2030-07-01T09:00', '2030-07-01T17:00', '  Carpet replacement ');
  const starts = new Date('2030-07-01T09:00').toISOString();
  const ends = new Date('2030-07-01T17:00').toISOString();
  expect(await screen.findByRole('status')).toHaveTextContent(`Atrium Hall is blocked ${describePeriod(starts, ends)}.`);
  expect(fetch).toHaveBeenCalledWith('/api/venues/1/blocks', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ starts_at: starts, ends_at: ends, reason: 'Carpet replacement' })
  }));
  expect(screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Carpet replacement', 'Scheduled maintenance']);
  expect(screen.getByLabelText('Reason')).toHaveValue('');
});

test('AC2: a period holding a confirmed booking is refused and the booking is identified', async () => {
  await openBlocks([], (url, init) => url === '/api/venues/1/blocks' && init?.method === 'POST'
    ? Response.json({ error: 'conflict', booking }, { status: 409 }) : undefined);
  await screen.findByText(/No upcoming blocks/);
  fillBlock('2030-06-15T09:00', '2030-06-15T13:00', 'Deep clean');
  expect(await screen.findByRole('alert')).toHaveTextContent(`booking #7 for event 3, ${describePeriod(booking.starts_at, booking.ends_at)}`);
  expect(screen.getByText(/No upcoming blocks/)).toBeInTheDocument();
  expect(screen.getByLabelText('Reason')).toHaveValue('Deep clean');
});

test('AC3: removing a block makes the venue available for that period again', async () => {
  const { fetch } = await openBlocks([existing]);
  const item = await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  fireEvent.click(within(item).getByRole('button', { name: 'Remove block' }));
  expect(await screen.findByRole('status')).toHaveTextContent(`Block removed. Atrium Hall is available again ${describePeriod(existing.starts_at, existing.ends_at)}.`);
  expect(fetch).toHaveBeenCalledWith('/api/venues/1/blocks/1', expect.objectContaining({ method: 'DELETE' }));
  expect(screen.getByText(/No upcoming blocks/)).toBeInTheDocument();
});

test('an invalid period or missing reason is caught before any request', async () => {
  const { fetch } = await openBlocks();
  await screen.findByText(/No upcoming blocks/);
  for (const [start, end, reason] of [
    ['', '2030-07-01T17:00', 'Reason'],
    ['2030-07-01T09:00', '', 'Reason'],
    ['2030-07-01T17:00', '2030-07-01T09:00', 'Reason'],
    ['2020-07-01T09:00', '2020-07-01T17:00', 'Reason'],
    ['2030-07-01T09:00', '2030-07-01T17:00', '   '],
    ['2030-07-01T09:00', '2030-07-01T17:00', 'x'.repeat(501)]
  ]) {
    fillBlock(start, end, reason);
    expect(screen.getByRole('alert')).toHaveTextContent('reason within 500 characters');
  }
  expect(fetch).not.toHaveBeenCalledWith('/api/venues/1/blocks', expect.objectContaining({ method: 'POST' }));
});

test('a failed read of the blocks is reported without leaving the screen', async () => {
  await openBlocks([], url => url === '/api/venues/1/blocks' ? new Response('', { status: 503 }) : undefined);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the venue service');
  expect(screen.getByText(/No upcoming blocks/)).toBeInTheDocument();
});

test('a network failure while saving keeps the form and reports a generic error', async () => {
  await openBlocks([], (url, init) => {
    if (url === '/api/venues/1/blocks' && init?.method === 'POST') throw new TypeError('Failed to fetch');
    return undefined;
  });
  await screen.findByText(/No upcoming blocks/);
  fillBlock('2030-07-01T09:00', '2030-07-01T17:00', 'Carpet replacement');
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the venue service. Please try again.');
  expect(screen.getByLabelText('Reason')).toHaveValue('Carpet replacement');
});

test('a lost session drops the catalogue and asks the user to sign in again', async () => {
  await openBlocks([existing], (_url, init) => init?.method === 'DELETE' ? new Response('', { status: 401 }) : undefined);
  const item = await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  fireEvent.click(within(item).getByRole('button', { name: 'Remove block' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your session has expired. Sign in again.');
  expect(screen.queryByRole('heading', { name: 'Block Atrium Hall' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('back to catalogue returns to the venue list', async () => {
  await openBlocks();
  fireEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
  expect(screen.getByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
});

test('leaving while the blocks are loading discards the stale request', async () => {
  const { fetch, rerender } = await openBlocks([], (url, init) => url === '/api/venues/1/blocks' ? abortable(url, init) : undefined);
  expect(screen.getByRole('status')).toHaveTextContent('Loading blocks…');
  rerender(<Venues accessToken={null} onBook={vi.fn()} />);
  await waitFor(() => expect(fetch.mock.calls.find(([url]) => url === '/api/venues/1/blocks')![1]!.signal!.aborted).toBe(true));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('leaving mid-save aborts the request without reporting an error', async () => {
  const { fetch, rerender } = await openBlocks([], (url, init) =>
    url === '/api/venues/1/blocks' && init?.method === 'POST' ? abortable(url, init) : undefined);
  await screen.findByText(/No upcoming blocks/);
  fillBlock('2030-07-01T09:00', '2030-07-01T17:00', 'Carpet replacement');
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
  rerender(<Venues accessToken={null} onBook={vi.fn()} />);
  await act(async () => {});
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[1]!.signal!.aborted).toBe(true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
