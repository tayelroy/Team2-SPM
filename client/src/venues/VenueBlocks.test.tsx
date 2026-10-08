vi.hoisted(() => vi.stubEnv('TZ', 'UTC'));

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import Venues from '../screens/Venues';
import type { Venue } from './api';
import { type AffectedBooking, type VenueBlock } from './blocksApi';

const venue: Venue = { venue_id: 1, name: 'Atrium Hall', location: 'North Wing', capacity: 100,
  facilities: 'Stage', accessibility_features: 'Hearing loop', operating_information: 'Weekdays, 09:00–18:00' };
const staff = { userId: 'staff', role: 'venue_staff',
  permissions: ['venues.read', 'venues.create', 'venues.update', 'venues.blocks.manage'] };
const coordinator = { userId: 'coordinator', role: 'event_coordinator', permissions: ['venues.read'] };
const recorded = { created_at: '2026-10-05T01:00:00.000Z', created_by_name: 'Vera Staff' };
const existing: VenueBlock = { unavailability_id: 1, starts_at: '2030-08-01T01:00:00.000Z', ends_at: '2030-08-02T01:00:00.000Z',
  category: 'maintenance', reason: 'Scheduled maintenance', ...recorded, affected: [] };
const gala: AffectedBooking = { booking_id: 7, event_id: 3, event_name: 'Gala Night', event_status: 'confirmed',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z' };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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
      const block = { unavailability_id: nextId++, ...JSON.parse(init.body as string), ...recorded, affected: [] };
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
  const view = render(<Venues accessToken="test-token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Block Atrium Hall' }));
  expect(screen.getByRole('heading', { name: 'Block Atrium Hall' })).toBeInTheDocument();
  return { fetch, ...view };
}

function fillBlock(start: string, end: string, reason: string, category = 'maintenance') {
  fireEvent.change(screen.getByLabelText('Unavailable from'), { target: { value: start } });
  fireEvent.change(screen.getByLabelText('Unavailable until'), { target: { value: end } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: category } });
  fireEvent.change(screen.getByLabelText('Note'), { target: { value: reason } });
  fireEvent.submit(screen.getByRole('form', { name: 'Block venue' }));
}

function abortable(_url: string, init?: RequestInit) {
  return new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
}

test('[FAILURE] [SG2-45:AC1] only callers who may manage blocks see the block control', async () => {
  api(coordinator);
  render(<Venues accessToken="test-token" />);
  await screen.findByRole('searchbox');
  expect(screen.queryByRole('button', { name: /^Block/ })).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-45:AC1] [SG2-80:AC6] the block screen lists upcoming blocks with reason, note, recorder and time, or says there are none', async () => {
  await openBlocks([existing, { ...existing, unavailability_id: 2, category: 'other', reason: 'Legacy closure', created_at: null, created_by_name: null }]);
  const item = await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  expect(item).toHaveTextContent('1 Aug 2030, 1:00 am – 2 Aug 2030, 1:00 am');
  expect(item).toHaveTextContent('Maintenance: Scheduled maintenance');
  expect(item).toHaveTextContent('Recorded by Vera Staff on 5 Oct 2026, 1:00 am');
  expect(within(item).queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByRole('listitem', { name: 'Legacy closure' })).toHaveTextContent('Other: Legacy closureRecorded before who and when were kept');
  cleanup();
  await openBlocks([]);
  expect(await screen.findByText(/No upcoming blocks/)).toBeInTheDocument();
});

test('[NORMAL] [SG2-45:AC1] [SG2-80:AC1] blocking a free period with a reason and a note records it and shows it in the list, earliest first', async () => {
  const { fetch } = await openBlocks([existing]);
  await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  fillBlock('2030-07-01T09:00', '2030-07-01T17:00', '  Carpet replacement ', 'renovation');
  const starts = '2030-07-01T09:00:00.000Z';
  const ends = '2030-07-01T17:00:00.000Z';
  expect(await screen.findByRole('status')).toHaveTextContent('Atrium Hall is blocked 1 Jul 2030, 9:00 am – 1 Jul 2030, 5:00 pm.');
  expect(fetch).toHaveBeenCalledWith('/api/venues/1/blocks', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ starts_at: starts, ends_at: ends, category: 'renovation', reason: 'Carpet replacement' })
  }));
  expect(screen.getAllByRole('listitem').map(item => item.getAttribute('aria-label'))).toEqual(['Carpet replacement', 'Scheduled maintenance']);
  expect(screen.getByRole('listitem', { name: 'Carpet replacement' })).toHaveTextContent('Renovation: Carpet replacement');
  expect(screen.getByLabelText('Reason')).toHaveValue('');
  expect(screen.getByLabelText('Note')).toHaveValue('');
});

test('[CONFLICT] [SG2-80:AC2] [SG2-80:AC3] [SG2-80:AC4] a period holding confirmed bookings is accepted and lists each affected event as not cancelled', async () => {
  const affected: AffectedBooking[] = [
    gala,
    { ...gala, booking_id: 8, event_id: 4, event_name: null, event_status: null },
    { ...gala, booking_id: 9, event_id: null, event_name: null, event_status: null }
  ];
  await openBlocks([], (url, init) => url === '/api/venues/1/blocks' && init?.method === 'POST'
    ? Response.json({ block: { unavailability_id: 5, ...JSON.parse(init.body as string), ...recorded, affected } }, { status: 201 }) : undefined);
  await screen.findByText(/No upcoming blocks/);
  fillBlock('2030-06-15T00:00', '2030-06-16T00:00', 'Air conditioning failed', 'equipment_failure');
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Atrium Hall is blocked 15 Jun 2030, 12:00 am – 16 Jun 2030, 12:00 am. 3 booked events are flagged as affected and not cancelled.');
  const item = screen.getByRole('listitem', { name: 'Air conditioning failed' });
  expect(item).toHaveTextContent('Equipment failure: Air conditioning failed');
  expect(item).toHaveTextContent('Affected by venue unavailability (not cancelled)');
  expect(within(screen.getByRole('list', { name: 'Events affected by Air conditioning failed' })).getAllByRole('listitem').map(row => row.textContent)).toEqual([
    'Gala Night (confirmed) · 15 Jun 2030, 2:00 am – 15 Jun 2030, 4:00 am',
    'Event 4 · 15 Jun 2030, 2:00 am – 15 Jun 2030, 4:00 am',
    'Booking #9 · 15 Jun 2030, 2:00 am – 15 Jun 2030, 4:00 am'
  ]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-80:AC3] a single affected event is reported in the singular', async () => {
  await openBlocks([], (url, init) => url === '/api/venues/1/blocks' && init?.method === 'POST'
    ? Response.json({ block: { unavailability_id: 5, ...JSON.parse(init.body as string), ...recorded, affected: [gala] } }, { status: 201 }) : undefined);
  await screen.findByText(/No upcoming blocks/);
  fillBlock('2030-06-15T03:59', '2030-06-15T05:00', 'Safety inspection', 'safety_concern');
  expect(await screen.findByRole('status')).toHaveTextContent('1 booked event is flagged as affected and not cancelled.');
});

test('[NORMAL] [SG2-45:AC3] AC3: removing a block makes the venue available for that period again', async () => {
  const { fetch } = await openBlocks([existing]);
  const item = await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  fireEvent.click(within(item).getByRole('button', { name: 'Remove block' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Block removed. Atrium Hall is available again 1 Aug 2030, 1:00 am – 2 Aug 2030, 1:00 am.');
  expect(fetch).toHaveBeenCalledWith('/api/venues/1/blocks/1', expect.objectContaining({ method: 'DELETE' }));
  expect(screen.getByText(/No upcoming blocks/)).toBeInTheDocument();
});

test('[BOUNDARY] [SG2-45:AC1] [SG2-80:AC1] an invalid period, missing reason or missing note is caught before any request', async () => {
  const { fetch } = await openBlocks();
  await screen.findByText(/No upcoming blocks/);
  for (const [start, end, reason, category = 'other'] of [
    ['', '2030-07-01T17:00', 'Reason'],
    ['2030-07-01T09:00', '', 'Reason'],
    ['2030-07-01T17:00', '2030-07-01T09:00', 'Reason'],
    ['2030-07-01T09:00', '2030-07-01T09:00', 'Reason'],
    ['2026-09-30T23:59', '2026-10-01T00:00', 'Reason'],
    ['2020-07-01T09:00', '2020-07-01T17:00', 'Reason'],
    ['2030-07-01T09:00', '2030-07-01T17:00', '   '],
    ['2030-07-01T09:00', '2030-07-01T17:00', 'x'.repeat(501)],
    ['2030-07-01T09:00', '2030-07-01T17:00', 'Reason', '']
  ]) {
    fillBlock(start, end, reason, category);
    expect(screen.getByRole('alert')).toHaveTextContent('choose a reason, and add a note within 500 characters');
  }
  expect(fetch).not.toHaveBeenCalledWith('/api/venues/1/blocks', expect.objectContaining({ method: 'POST' }));
});

test('[BOUNDARY] [SG2-45:AC1] a one-minute free period accepts a reason of exactly 500 characters', async () => {
  const { fetch } = await openBlocks();
  await screen.findByText(/No upcoming blocks/);
  const reason = '🧹'.repeat(500);
  fillBlock('2030-07-01T09:00', '2030-07-01T09:01', reason);
  expect(await screen.findByRole('listitem', { name: reason })).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/venues/1/blocks', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ starts_at: '2030-07-01T09:00:00.000Z', ends_at: '2030-07-01T09:01:00.000Z', category: 'maintenance', reason }),
  }));
});

test('[FAILURE] [SG2-45:AC1] a failed read of the blocks is reported without leaving the screen', async () => {
  await openBlocks([], url => url === '/api/venues/1/blocks' ? new Response('', { status: 503 }) : undefined);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the venue service');
  expect(screen.getByText(/No upcoming blocks/)).toBeInTheDocument();
});

test('[FAILURE] [SG2-45:AC1] a network failure while saving keeps the form and reports a generic error', async () => {
  await openBlocks([], (url, init) => {
    if (url === '/api/venues/1/blocks' && init?.method === 'POST') throw new TypeError('Failed to fetch');
    return undefined;
  });
  await screen.findByText(/No upcoming blocks/);
  fillBlock('2030-07-01T09:00', '2030-07-01T17:00', 'Carpet replacement');
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach the venue service. Please try again.');
  expect(screen.getByLabelText('Note')).toHaveValue('Carpet replacement');
});

test('[FAILURE] [SG2-45:AC1] a lost session drops the catalogue and asks the user to sign in again', async () => {
  await openBlocks([existing], (_url, init) => init?.method === 'DELETE' ? new Response('', { status: 401 }) : undefined);
  const item = await screen.findByRole('listitem', { name: 'Scheduled maintenance' });
  fireEvent.click(within(item).getByRole('button', { name: 'Remove block' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your session has expired. Sign in again.');
  expect(screen.queryByRole('heading', { name: 'Block Atrium Hall' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('[NORMAL] [SG2-45:AC1] back to catalogue returns to the venue list', async () => {
  await openBlocks();
  fireEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
  expect(screen.getByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
});

test('[CONFLICT] [SG2-45:block-isolation] leaving while the blocks are loading discards the stale request', async () => {
  const { fetch, rerender } = await openBlocks([], (url, init) => url === '/api/venues/1/blocks' ? abortable(url, init) : undefined);
  expect(screen.getByRole('status')).toHaveTextContent('Loading blocks…');
  rerender(<Venues accessToken={null} />);
  await waitFor(() => expect(fetch.mock.calls.find(([url]) => url === '/api/venues/1/blocks')![1]!.signal!.aborted).toBe(true));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('[CONFLICT] [SG2-45:block-isolation] leaving mid-save aborts the request without reporting an error', async () => {
  const { fetch, rerender } = await openBlocks([], (url, init) =>
    url === '/api/venues/1/blocks' && init?.method === 'POST' ? abortable(url, init) : undefined);
  await screen.findByText(/No upcoming blocks/);
  fillBlock('2030-07-01T09:00', '2030-07-01T17:00', 'Carpet replacement');
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
  rerender(<Venues accessToken={null} />);
  await act(async () => {});
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[1]!.signal!.aborted).toBe(true);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

afterAll(() => vi.unstubAllEnvs());
