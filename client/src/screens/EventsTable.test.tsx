import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import { ROLES } from '../mock/types';
import EventsTable, { formatProposedDate } from './EventsTable';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('formatProposedDate', () => {
  test('handles null or empty date string', () => {
    expect(formatProposedDate(null)).toBe('—');
    expect(formatProposedDate('')).toBe('—');
  });

  test('formats valid ISO date string', () => {
    const formatted = formatProposedDate('2026-10-12T00:00:00.000Z');
    expect(formatted).toMatch(/12 Oct 2026/);
  });

  test('returns original string when date is invalid', () => {
    expect(formatProposedDate('not-a-date')).toBe('not-a-date');
  });
});

describe('EventsTable role boundary', () => {
  test.each(ROLES.filter((role) => role !== 'Event Organiser'))('%s cannot fetch or see organisation events', (role) => {
    const fetch = vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests');
    render(<EventsTable role={role} accessToken="token" onOpenEvent={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('available only to Event Organisers');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Product Launch — Tideline')).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });
});

describe('EventsTable for Event Organiser (API consumption)', () => {
  test('does not fetch when accessToken is missing', () => {
    const fetchSpy = vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests');
    render(<EventsTable role="Event Organiser" onOpenEvent={vi.fn()} />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText('No event requests found.')).toBeInTheDocument();
  });

  test('TC-SG2-31-01 & TC-SG2-31-02: displays metadata, formatted date, coordinator, status, and action chips', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests').mockResolvedValue({
      ok: true,
      requests: [
        {
          eventId: 101,
          name: 'Annual Tech Summit',
          proposedDate: '2026-10-15T09:00:00.000Z',
          status: 'draft',
          coordinatorId: null,
          coordinatorName: null,
          canManage: true,
          waitingOnMe: true,
        },
        {
          eventId: 102,
          name: '',
          proposedDate: null,
          status: 'submitted',
          coordinatorId: 'coord-1',
          coordinatorName: 'A. Vance',
          canManage: true,
          waitingOnMe: false,
        },
      ],
    });

    const onOpen = vi.fn();
    render(
      <EventsTable
        role="Event Organiser"
        accessToken="test-token"
        onOpenEvent={onOpen}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading event requests…');

    expect(await screen.findByText('Annual Tech Summit')).toBeInTheDocument();
    expect(screen.getByText('#101')).toBeInTheDocument();
    expect(screen.getByText(/15 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByText('Waiting on you')).toBeInTheDocument();

    // Second row: blank name fallback, null date, coordinator name, with coordinator chip
    expect(screen.getByText('Untitled event')).toBeInTheDocument();
    expect(screen.getByText('#102')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('A. Vance')).toBeInTheDocument();
    expect(screen.getByText('submitted')).toBeInTheDocument();
    expect(screen.getByText('With coordinator')).toBeInTheDocument();

    // TC-SG2-31-04: Row selection routing
    fireEvent.click(screen.getByRole('button', { name: /Annual Tech Summit/ }));
    expect(onOpen).toHaveBeenCalledWith(101);
  });

  test('TC-SG2-31-03: status filtering and empty boundary state', async () => {
    const fetchSpy = vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests')
      .mockResolvedValueOnce({
        ok: true,
        requests: [
          {
            eventId: 201,
            name: 'Strategy Session',
            proposedDate: '2026-11-01T10:00:00.000Z',
            status: 'draft',
            coordinatorId: null,
            coordinatorName: null,
            canManage: true,
            waitingOnMe: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        requests: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        requests: [],
      });

    render(
      <EventsTable
        role="Event Organiser"
        accessToken="test-token"
        onOpenEvent={vi.fn()}
      />,
    );

    expect(await screen.findByText('Strategy Session')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith('test-token', 'All');

    // Click Draft filter pill
    const draftButton = screen.getByRole('button', { name: 'Draft' });
    fireEvent.click(draftButton);
    expect(draftButton).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('No draft events found.')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith('test-token', 'Draft');

    // Click All to restore
    const allButton = screen.getByRole('button', { name: 'All' });
    fireEvent.click(allButton);
    expect(await screen.findByText('No event requests found.')).toBeInTheDocument();
  });

  test('renders error state on unauthorized rejection', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests').mockResolvedValue({
      ok: false,
      kind: 'unauthorized',
    });

    render(
      <EventsTable
        role="Event Organiser"
        accessToken="expired-token"
        onOpenEvent={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session has expired. Please sign in again.',
    );
  });

  test('renders error state on unavailable rejection and retries', async () => {
    const fetchSpy = vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests')
      .mockResolvedValueOnce({
        ok: false,
        kind: 'unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        requests: [],
      });

    render(
      <EventsTable
        role="Event Organiser"
        accessToken="test-token"
        onOpenEvent={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Event requests are temporarily unavailable. Please try again later.',
    );

    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);

    expect(await screen.findByText('No event requests found.')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('renders custom error message and handles network exceptions', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests')
      .mockResolvedValueOnce({
        ok: false,
        kind: 'error',
        message: 'Server error 500',
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: 'error',
        message: '',
      })
      .mockRejectedValueOnce(new Error('Network disconnected'));

    render(
      <EventsTable
        role="Event Organiser"
        accessToken="test-token"
        onOpenEvent={vi.fn()}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error 500');

    // Click retry for empty error fallback
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load event requests.');

    // Click retry for exception catch
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Event requests are temporarily unavailable. Please try again later.',
    );
  });

  test('cleans up cancelled effect on unmount', async () => {
    let resolvePromise!: (val: any) => void;
    vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests').mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; }),
    );

    const { unmount } = render(
      <EventsTable
        role="Event Organiser"
        accessToken="test-token"
        onOpenEvent={vi.fn()}
      />,
    );

    unmount();
    resolvePromise({ ok: true, requests: [] });
  });

  test('handles cancelled fetch rejection when unmounted', () => {
    let rejectPromise!: (err: any) => void;
    vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests').mockImplementation(
      () => new Promise((_, reject) => { rejectPromise = reject; }),
    );

    const { unmount } = render(
      <EventsTable
        role="Event Organiser"
        accessToken="test-token"
        onOpenEvent={vi.fn()}
      />,
    );

    unmount();
    rejectPromise(new Error('unmounted rejection'));
  });
});

test('colleague events remain visible but never show a personal action', async () => {
  vi.spyOn(eventRequestsApi, 'fetchOwnEventRequests').mockResolvedValue({ ok: true, requests: [{
    eventId: 77, name: 'Colleague event', proposedDate: null, status: 'draft', coordinatorId: null,
    coordinatorName: null, canManage: false, waitingOnMe: false,
  }] });
  const open = vi.fn();
  render(<EventsTable role="Event Organiser" accessToken="token" onOpenEvent={open} />);
  expect(await screen.findByText('View only')).toBeInTheDocument();
  expect(screen.queryByText('Waiting on you')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View Colleague event' }));
  expect(open).toHaveBeenCalledWith(77);
});
