import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const requests = [
  { event_id: 1, name: 'My draft', status: 'draft', can_manage: true },
  { event_id: 2, name: 'Colleague draft', status: 'draft', can_manage: false },
  { event_id: 3, name: '', status: 'submitted', can_manage: true, coordinator_id: 'coord-1', coordinator_name: 'A. Coordinator' },
];

test('[NORMAL] [SG2-26:AC1] organisation dashboard shows real shared events, owned draft count and correct navigation', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ requests }));
  vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={onNavigate} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();
  await screen.findByText('Colleague draft');
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('1');
  expect(screen.getByText('Organisation events').closest('div')).toHaveTextContent('3');
  expect(screen.getByText('Waiting on me').closest('div')).toHaveTextContent('1');
  const shared = screen.getByRole('button', { name: /Colleague draft/ });
  expect(within(shared).getByText('View only')).toBeInTheDocument();
  fireEvent.click(shared);
  expect(onNavigate).toHaveBeenCalledWith('detail', 2);
  expect(screen.getByText('With coordinator')).toBeInTheDocument();
  expect(screen.getByText('Untitled event')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'See all events' }));
  expect(onNavigate).toHaveBeenCalledWith('events');
  expect(fetch).toHaveBeenCalledWith('/api/event-requests', { method: 'GET', headers: { Authorization: 'Bearer token' } });
});

test('[NORMAL] [SG2-36:AC1] a request returned with a question counts as a draft and as waiting on me', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [
    ...requests, { event_id: 4, name: 'Returned forum', status: 'needs_clarification', can_manage: true },
  ] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  await screen.findByText('Returned forum');
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('2');
  expect(screen.getByText('Waiting on me').closest('div')).toHaveTextContent('2');
});

test.each([false, true])('[FAILURE] [SG2-26:AC1] unavailable organisation data never falls back to mock events (token %s)', async (hasToken) => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Organiser" accessToken={hasToken ? 'token' : undefined} onNavigate={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('—');
});

test('[BOUNDARY] [SG2-26:AC1] empty organisation has explicit empty state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  expect(await screen.findByText('No event requests found.')).toBeInTheDocument();
});

test('[CONFLICT] [SG2-26:session-isolation] a late response for the previous session cannot replace the current organisation', async () => {
  let resolve!: (r: Response) => void;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>((yes) => { resolve = yes; }))
    .mockResolvedValueOnce(Response.json({ requests: [{ event_id: 9, name: 'Current organisation event', status: 'submitted' }] }));
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<Dashboard role="Event Organiser" accessToken="old-token" onNavigate={vi.fn()} />);
  rerender(<Dashboard role="Event Organiser" accessToken="new-token" onNavigate={vi.fn()} />);
  await screen.findByText('Current organisation event');
  await act(async () => resolve(Response.json({ requests })));
  expect(screen.getByText('Current organisation event')).toBeInTheDocument();
  expect(screen.queryByText('My draft')).not.toBeInTheDocument();
  expect(screen.getByText('Organisation events').closest('div')).toHaveTextContent('1');
});

test('[NORMAL] [SG2-20:prototype-dashboard] attendee retains its prototype event dashboard and navigation', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Dashboard role="Attendee" onNavigate={onNavigate} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Registration open.*Quarterly Partner Dinner/ }));
  expect(onNavigate).toHaveBeenCalledWith('attendee');
  fireEvent.click(screen.getByRole('button', { name: 'See all events' }));
  expect(onNavigate).toHaveBeenCalledWith('events');
  for (const button of screen.getAllByRole('button', { name: /^Open:/ })) fireEvent.click(button);
});

test('[NORMAL] [SG2-87:AC4] the organisation dashboard shows a queued request as Unassigned and awaiting a coordinator', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [
    { event_id: 5, name: 'Queued forum', status: 'submitted', can_manage: true, coordinator_id: null },
  ] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  const card = await screen.findByRole('button', { name: /Queued forum/ });
  expect(within(card).getAllByText(/Unassigned/)).toHaveLength(2);
  expect(within(card).getByText('Awaiting a coordinator')).toBeInTheDocument();
  expect(within(card).queryByText('With coordinator')).not.toBeInTheDocument();
});
