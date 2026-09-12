import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import AvailabilityCalendar from './AvailabilityCalendar';
import { saveSession } from '../auth/session';

const NOW = new Date('2026-10-15T12:00:00.000Z');

beforeEach(() => {
  // Fake only Date, not timers: findBy*/waitFor rely on real setTimeout polling.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  saveSession({ accessToken: 'test-token', user: { userId: 'u-1', email: 'staff@example.com', role: 'Venue Staff' } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
});

function stubJson(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body)));
}

test('shows a loading state before the response resolves', () => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  render(<AvailabilityCalendar />);
  expect(screen.getByText('Loading venue availability…')).toBeInTheDocument();
});

test('renders bookings and unavailability across every venue for the month', async () => {
  stubJson({
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
    venues: [
      {
        venueId: 1,
        name: 'Atrium',
        entries: [{ start: '2026-10-15T09:00:00.000Z', end: '2026-10-15T12:00:00.000Z', kind: 'booking', label: 'held' }]
      },
      {
        venueId: 2,
        name: 'Rooftop',
        entries: [{ start: '2026-10-15T00:00:00.000Z', end: '2026-10-16T00:00:00.000Z', kind: 'unavailable', label: 'Maintenance' }]
      }
    ]
  });

  render(<AvailabilityCalendar />);

  expect(await screen.findByText('Atrium · held')).toBeInTheDocument();
  expect(screen.getByText('Rooftop · Maintenance')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
});

test('shows a no-access message when there is no session at all', async () => {
  sessionStorage.clear();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  render(<AvailabilityCalendar />);
  expect(await screen.findByText("You don't have access to this view.")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('shows a no-access message when the server denies the request', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
  render(<AvailabilityCalendar />);
  expect(await screen.findByText("You don't have access to this view.")).toBeInTheDocument();
});

test('shows an error message when the request fails', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  render(<AvailabilityCalendar />);
  expect(await screen.findByText("Couldn't load venue availability. Try again.")).toBeInTheDocument();
});

test('moving to the next month re-fetches a new date range', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ from: '', to: '', venues: [] }));
  vi.stubGlobal('fetch', fetchMock);

  render(<AvailabilityCalendar />);
  await screen.findByRole('heading', { name: 'October 2026' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain(encodeURIComponent('2026-10-01T00:00:00.000Z'));

  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  await screen.findByRole('heading', { name: 'November 2026' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[1][0])).toContain(encodeURIComponent('2026-11-01T00:00:00.000Z'));

  fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
  await screen.findByRole('heading', { name: 'October 2026' });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});
