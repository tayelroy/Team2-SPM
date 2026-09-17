import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import EventDetail from './EventDetail';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EventDetail with mock data (unselected event or non-organiser roles)', () => {
  test('an attendee detail view hides the internal capacity warning and approval control', () => {
    render(<EventDetail role="Attendee" onNavigate={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Quarterly Partner Dinner' })).toBeInTheDocument();
    expect(screen.queryByText(/Capacity check/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
  });

  test('a coordinator gets decision actions, and approving goes to venues', () => {
    const onNavigate = vi.fn();
    render(<EventDetail role="Event Coordinator" onNavigate={onNavigate} />);
    expect(screen.getByText('Review actions')).toBeInTheDocument();
    expect(screen.getByText(/Capacity check/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Approve request' }));
    expect(onNavigate).toHaveBeenCalledWith('venues');
  });

  test('an organiser gets amendment actions when not submitted', () => {
    const onNavigate = vi.fn();
    render(<EventDetail role="Event Organiser" onNavigate={onNavigate} />);
    expect(screen.getByText('Your options')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit request' }));
    expect(onNavigate).toHaveBeenCalledWith('form');

    fireEvent.click(screen.getByRole('button', { name: 'Request a change' }));
    expect(onNavigate).toHaveBeenCalledWith('change');
  });

  test('an organiser gets a read-only locked notice when submitted', () => {
    render(<EventDetail role="Event Organiser" onNavigate={vi.fn()} eventStatus="submitted" />);
    expect(
      screen.getByText(/This request has been submitted and is now with your coordinator/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
  });
});

describe('EventDetail for Event Organiser with selected event (API consumption)', () => {
  test('TC-SG2-31-04: loads and displays full event details for selectedEventId', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        eventId: 101,
        organiserId: 'org-1',
        organisation: 'Acme Corp',
        status: 'under_review',
        name: 'Leadership Retreat',
        purpose: 'Executive leadership alignment',
        description: 'Two-day retreat focusing on strategic vision.',
        proposedDate: '2026-11-20T08:00:00.000Z',
        expectedAttendance: 45,
        venueRequirements: 'Private hall with breakout areas',
        accessibilityNeeds: 'Step-free access',
        equipmentRequirements: 'Projector and 4 microphones',
        registrationNeeded: true,
        coordinatorId: 'coord-2',
        coordinatorName: 'Sarah Jenkins',
        waitingOnMe: false,
      },
    });

    const onNavigate = vi.fn();
    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={101}
        accessToken="test-token"
        onNavigate={onNavigate}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading event details…');

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();
    expect(screen.getByText('#101')).toBeInTheDocument();
    expect(screen.getByText('Executive leadership alignment')).toBeInTheDocument();
    expect(screen.getByText('Two-day retreat focusing on strategic vision.')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText(/20 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('Private hall with breakout areas')).toBeInTheDocument();
    expect(screen.getByText('Sarah Jenkins')).toBeInTheDocument();
    expect(screen.getByText('Step-free access')).toBeInTheDocument();
    expect(screen.getByText('Projector and 4 microphones')).toBeInTheDocument();
    expect(screen.getByText('Yes')).toBeInTheDocument();

    // Locked notice since waitingOnMe is false
    expect(
      screen.getByText(/This request has been submitted and is now with your coordinator/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();

    // Click Request a change
    fireEvent.click(screen.getByRole('button', { name: 'Request a change' }));
    expect(onNavigate).toHaveBeenCalledWith('change');

    // Click Back to events
    fireEvent.click(screen.getByRole('button', { name: '← Back to events' }));
    expect(onNavigate).toHaveBeenCalledWith('events');
  });

  test('displays draft event with action buttons and handles missing optional attributes', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        eventId: 105,
        organiserId: 'org-1',
        organisation: null,
        status: 'draft',
        name: '',
        purpose: '',
        description: '',
        proposedDate: null,
        expectedAttendance: null,
        venueRequirements: null,
        accessibilityNeeds: null,
        equipmentRequirements: null,
        registrationNeeded: false,
        coordinatorId: null,
        coordinatorName: null,
        waitingOnMe: true,
      },
    });

    const onNavigate = vi.fn();
    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={105}
        accessToken="test-token"
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Untitled event' })).toBeInTheDocument();
    expect(screen.getByText('No purpose specified')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getAllByText('None specified').length).toBeGreaterThan(0);
    expect(screen.getByText('No')).toBeInTheDocument();

    // Editable buttons available
    const editBtn = screen.getByRole('button', { name: 'Edit request' });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);
    expect(onNavigate).toHaveBeenCalledWith('form');

    const changeBtn = screen.getByRole('button', { name: 'Request a change' });
    expect(changeBtn).toBeInTheDocument();
    fireEvent.click(changeBtn);
    expect(onNavigate).toHaveBeenCalledWith('change');
  });

  test('displays rejection notice for rejected request', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        eventId: 106,
        organiserId: 'org-1',
        organisation: 'Beta LLC',
        status: 'rejected',
        name: 'Product Showcase',
        purpose: 'Showcase Q4 products',
        description: 'Showcase evening',
        proposedDate: '2026-12-01T12:00:00.000Z',
        expectedAttendance: 200,
        venueRequirements: 'Auditorium',
        accessibilityNeeds: null,
        equipmentRequirements: null,
        registrationNeeded: true,
        coordinatorId: 'coord-1',
        coordinatorName: 'A. Vance',
        waitingOnMe: true,
      },
    });

    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={106}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByText('Request returned for revision')).toBeInTheDocument();
    expect(
      screen.getByText(/This request was returned by your coordinator. Please review the details/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit request' })).toBeInTheDocument();
  });

  test('handles 404 not_found with return button', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: false,
      kind: 'not_found',
    });

    const onNavigate = vi.fn();
    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={999}
        accessToken="test-token"
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Event request not found' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to events' }));
    expect(onNavigate).toHaveBeenCalledWith('events');
  });

  test('handles unauthorized error and unavailable error with retry and back buttons', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail')
      .mockResolvedValueOnce({
        ok: false,
        kind: 'unauthorized',
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: 'unavailable',
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: 'error',
        message: 'Database query timeout',
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: 'error',
        message: '',
      })
      .mockRejectedValueOnce(new Error('Network error'));

    const onNavigate = vi.fn();
    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={101}
        accessToken="expired-token"
        onNavigate={onNavigate}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session has expired. Please sign in again.',
    );

    // Click retry to trigger unavailable
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Event request details are temporarily unavailable. Please try again later.',
    );

    // Click retry to trigger custom error
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database query timeout');

    // Click retry for empty error message fallback
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load event details.');

    // Click retry for exception catch
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Event request details are temporarily unavailable. Please try again later.',
    );

    // Click Back to events from error notice
    fireEvent.click(screen.getByRole('button', { name: 'Back to events' }));
    expect(onNavigate).toHaveBeenCalledWith('events');
  });

  test('cleans up cancelled effect on unmount', () => {
    let resolvePromise!: (val: any) => void;
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockImplementation(
      () => new Promise((resolve) => { resolvePromise = resolve; }),
    );

    const { unmount } = render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={101}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    unmount();
    resolvePromise({ ok: true, request: {} as any });
  });

  test('handles cancelled fetch rejection when unmounted', () => {
    let rejectPromise!: (err: any) => void;
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockImplementation(
      () => new Promise((_, reject) => { rejectPromise = reject; }),
    );

    const { unmount } = render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={101}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    unmount();
    rejectPromise(new Error('unmounted detail rejection'));
  });
});
