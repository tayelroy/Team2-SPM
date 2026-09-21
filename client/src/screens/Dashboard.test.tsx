import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Dashboard from './Dashboard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const requests = [
  { event_id: 1, name: 'My draft', status: 'draft', can_manage: true },
  { event_id: 2, name: 'Colleague draft', status: 'draft', can_manage: false },
  { event_id: 3, name: '', status: 'submitted', can_manage: true, coordinator_name: 'A. Coordinator' },
];

test('organisation dashboard shows real shared events, owned draft count and correct navigation', async () => {
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

test.each([false, true])('unavailable organisation data never falls back to mock events (token %s)', async (hasToken) => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetch);
  render(<Dashboard role="Event Organiser" accessToken={hasToken ? 'token' : undefined} onNavigate={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable');
  expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();
  expect(screen.getByText('My drafts').closest('div')).toHaveTextContent('—');
});

test('empty organisation has explicit empty state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [] })));
  render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  expect(await screen.findByText('No event requests found.')).toBeInTheDocument();
});

test('unmount ignores pending organisation fetch', async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((yes) => { resolve = yes; })));
  const { unmount } = render(<Dashboard role="Event Organiser" accessToken="token" onNavigate={vi.fn()} />);
  unmount();
  await act(async () => resolve(Response.json({ requests })));
});

test('coordinator retains existing operational dashboard and navigation', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const onNavigate = vi.fn();
  render(<Dashboard role="Event Coordinator" onNavigate={onNavigate} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Product Launch — Tideline/ }));
  expect(onNavigate).toHaveBeenCalledWith('detail');
  fireEvent.click(screen.getByRole('button', { name: 'See all events' }));
  expect(onNavigate).toHaveBeenCalledWith('events');
});
