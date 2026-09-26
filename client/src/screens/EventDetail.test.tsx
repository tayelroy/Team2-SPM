import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import EventDetail from './EventDetail';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EventDetail access boundaries', () => {
  test.each(['Venue Staff', 'Technical Support Staff', 'Attendee'] as const)('%s cannot fetch or see event detail', (role) => {
    const fetch = vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail');
    render(<EventDetail role={role} selectedEventId={101} accessToken="token" onNavigate={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('available only to Event Organisers');
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
    expect(screen.queryByText('Quarterly Partner Dinner')).not.toBeInTheDocument();
  });

  test('Event Coordinator without selected request cannot see event detail', () => {
    const fetch = vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail');
    render(<EventDetail role="Event Coordinator" accessToken="token" onNavigate={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('available only to Event Organisers');
    expect(fetch).not.toHaveBeenCalled();
  });

  test('an organiser without a selected request never sees a mock organisation event', () => {
    const onNavigate = vi.fn();
    render(<EventDetail role="Event Organiser" onNavigate={onNavigate} />);
    expect(screen.getByText(/Select an event from your organisation/)).toBeInTheDocument();
    expect(screen.queryByText('Northbridge Investor Forum')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to events' }));
    expect(onNavigate).toHaveBeenCalledWith('events');
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
        canManage: true,
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

    expect(screen.queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument();

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
        canManage: true,
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
    expect(screen.getAllByText('None specified')).toHaveLength(3);
    expect(screen.getByText('No')).toBeInTheDocument();

    // Editable buttons available
    const editBtn = screen.getByRole('button', { name: 'Edit request' });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);
    expect(onNavigate).toHaveBeenCalledWith('drafts');

    expect(screen.queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument();
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
        canManage: true,
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

  test.each(['success', 'rejection'] as const)('ignores a stale %s after a different request is selected', async (outcome) => {
    type Result = Awaited<ReturnType<typeof eventRequestsApi.fetchOwnEventDetail>>;
    let resolveOld!: (value: Result) => void;
    let rejectOld!: (error: Error) => void;
    const oldRequest: eventRequestsApi.EventRequestDetail = {
      eventId: 101, organiserId: 'org-1', organisation: null, status: 'draft',
      name: 'Previous request', purpose: '', description: '', proposedDate: null,
      expectedAttendance: null, venueRequirements: null, accessibilityNeeds: null,
      equipmentRequirements: null, registrationNeeded: false, coordinatorId: null,
      coordinatorName: null, canManage: true, waitingOnMe: true,
    };
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail')
      .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockResolvedValueOnce({ ok: true, request: { ...oldRequest, eventId: 102, name: 'Current request' } });

    const { rerender } = render(<EventDetail role="Event Organiser" selectedEventId={101} accessToken="test-token" onNavigate={vi.fn()} />);
    rerender(<EventDetail role="Event Organiser" selectedEventId={102} accessToken="test-token" onNavigate={vi.fn()} />);
    await screen.findByRole('heading', { name: 'Current request' });
    await act(async () => {
      if (outcome === 'success') resolveOld({ ok: true, request: oldRequest });
      else rejectOld(new Error('Previous request failed'));
    });
    expect(screen.getByRole('heading', { name: 'Current request' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Previous request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

test.each(['draft', 'rejected', 'submitted'])('colleague %s detail is strictly view only', async (status) => {
  vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({ ok: true, request: {
    eventId: 77, organiserId: 'colleague', organisation: 'Shared organisation', status,
    name: 'Colleague event', purpose: 'Shared work', description: '', proposedDate: null,
    expectedAttendance: null, venueRequirements: null, accessibilityNeeds: null,
    equipmentRequirements: null, registrationNeeded: false, coordinatorId: null,
    coordinatorName: null, canManage: false, waitingOnMe: false,
  } });
  render(<EventDetail role="Event Organiser" accessToken="token" selectedEventId={77} onNavigate={vi.fn()} />);
  expect(await screen.findByText(/View only. This event/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Request a change' })).not.toBeInTheDocument();
  expect(screen.queryByText('Request returned for revision')).not.toBeInTheDocument();
  expect(screen.queryByText('Confirmed arrangements')).not.toBeInTheDocument();
  expect(screen.queryByText('Activity')).not.toBeInTheDocument();
});

describe('EventDetail EventStageTracker integration (SG2-38)', () => {
  test('renders EventStageTracker with stage API response and displays arrangements recheck banner', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        eventId: 101,
        organiserId: 'org-1',
        organisation: 'Acme Corp',
        status: 'approved',
        name: 'Annual Tech Summit',
        purpose: 'Showcase innovation',
        description: 'Tech conference',
        proposedDate: '2026-11-20T08:00:00.000Z',
        expectedAttendance: 250,
        venueRequirements: 'Main Auditorium',
        accessibilityNeeds: null,
        equipmentRequirements: null,
        registrationNeeded: true,
        coordinatorId: 'coord-1',
        coordinatorName: 'Sarah Jenkins',
        canManage: true,
        waitingOnMe: false,
      },
    });

    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: {
        event_id: 101,
        raw_status: 'approved',
        stage: 'Approved — In Planning',
        stage_key: 'in_planning',
        description: 'Event approved; coordinator is actively arranging venue and equipment.',
        waiting_on: {
          persona: 'Event Coordinator (Sarah Jenkins)',
          action: 'Complete venue suitability check and equipment reservation',
        },
        stepper_steps: [
          { key: 'draft', label: 'Draft', status: 'completed' },
          { key: 'submitted', label: 'Submitted', status: 'completed' },
          { key: 'under_review', label: 'Under Review', status: 'completed' },
          { key: 'in_planning', label: 'Approved — In Planning', status: 'current' },
          { key: 'confirmed', label: 'Confirmed', status: 'upcoming' },
        ],
        arrangements_recheck_needed: true,
        outstanding_arrangements: ['venue', 'equipment'],
      },
    });

    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={101}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Annual Tech Summit' })).toBeInTheDocument();
    expect(screen.getByTestId('stage-badge')).toHaveTextContent('Approved — In Planning');
    expect(screen.getByText('Event approved; coordinator is actively arranging venue and equipment.')).toBeInTheDocument();
    expect(screen.getByTestId('waiting-on-persona')).toHaveTextContent('Event Coordinator (Sarah Jenkins)');
    expect(screen.getByTestId('waiting-on-action')).toHaveTextContent('Next step: Complete venue suitability check and equipment reservation');

    // Stepper steps are rendered
    expect(screen.getByRole('list', { name: 'Lifecycle steps' })).toBeInTheDocument();

    // Recheck banner is visible
    expect(await screen.findByTestId('arrangements-recheck-banner')).toBeInTheDocument();
    expect(
      screen.getByText('Arrangements Outstanding: Venue & Equipment Recheck Needed'),
    ).toBeInTheDocument();
  });

  test('renders EventDetail smoothly even if getEventStage fails', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        eventId: 102,
        organiserId: 'org-1',
        organisation: 'Acme Corp',
        status: 'draft',
        name: 'Planning Meeting',
        purpose: 'Internal alignment',
        description: '',
        proposedDate: null,
        expectedAttendance: null,
        venueRequirements: null,
        accessibilityNeeds: null,
        equipmentRequirements: null,
        registrationNeeded: false,
        coordinatorId: null,
        coordinatorName: null,
        canManage: true,
        waitingOnMe: true,
      },
    });

    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: false,
      kind: 'unavailable',
      message: 'Service down',
    });

    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={102}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Planning Meeting' })).toBeInTheDocument();
    expect(screen.queryByTestId('stage-badge')).not.toBeInTheDocument();
  });

  test('renders EventDetail smoothly when getEventStage rejects with an exception', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        eventId: 103,
        organiserId: 'org-1',
        organisation: 'Acme Corp',
        status: 'draft',
        name: 'Daily Standup',
        purpose: 'Team alignment',
        description: '',
        proposedDate: null,
        expectedAttendance: null,
        venueRequirements: null,
        accessibilityNeeds: null,
        equipmentRequirements: null,
        registrationNeeded: false,
        coordinatorId: null,
        coordinatorName: null,
        canManage: true,
        waitingOnMe: true,
      },
    });

    vi.spyOn(eventRequestsApi, 'getEventStage').mockRejectedValue(new Error('Stage service unavailable'));

    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={103}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Daily Standup' })).toBeInTheDocument();
    expect(screen.queryByTestId('stage-badge')).not.toBeInTheDocument();
  });
});

describe('EventDetail coordinator planning integration (SG2-39)', () => {
  const baseDetail: eventRequestsApi.EventRequestDetail = {
    eventId: 101,
    organiserId: 'org-1',
    organisation: 'Acme Corp',
    status: 'under_review',
    name: 'Leadership Retreat',
    purpose: 'Executive leadership alignment',
    description: 'Two-day retreat focusing on strategic vision.',
    proposedDate: '2026-11-20T08:00:00.000Z',
    expectedAttendance: 45,
    venueRequirements: 'Private hall',
    accessibilityNeeds: 'Step-free access',
    equipmentRequirements: 'Projector',
    registrationNeeded: true,
    coordinatorId: 'coord-1',
    coordinatorName: 'Sarah Jenkins',
    canManage: false,
    waitingOnMe: false,
  };

  const baseStage: eventRequestsApi.EventStageResult = {
    event_id: 101,
    raw_status: 'under_review',
    stage: 'Under Review',
    stage_key: 'under_review',
    description: 'Under review by coordinator',
    waiting_on: null,
    stepper_steps: [],
    arrangements_recheck_needed: false,
    outstanding_arrangements: [],
  };

  test('assigned Event Coordinator sees "Edit Planning Information" button on non-terminal event', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: baseDetail,
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: baseStage,
    });

    render(
      <EventDetail
        role="Event Coordinator"
        selectedEventId={101}
        accessToken="test-token"
        currentUserId="coord-1"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Planning Information' })).toBeInTheDocument();
    expect(
      screen.getByText('Update event planning information, dates, attendance, and requirements.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
  });

  test('clicking "Edit Planning Information" opens EventPlanningDrawer and executes impact warning modal flow (AC 2)', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: baseDetail,
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: baseStage,
    });

    const updateSpy = vi.spyOn(eventRequestsApi, 'updateEventPlanning')
      .mockResolvedValueOnce({
        ok: false,
        kind: 'confirmation_required',
        affected_arrangements: ['venue_recheck', 'equipment_recheck'],
        impact_notes: ['Attendance increased from 45 to 150. Existing venue suitability and equipment requirements must be rechecked.'],
        message: 'Arrangements require rechecking.',
      })
      .mockResolvedValueOnce({
        ok: true,
        arrangements_recheck_needed: true,
        outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
        event: {
          event_id: 101,
          status: 'planning',
          expected_attendance: 150,
          proposed_date: '2026-11-20T08:00:00.000Z',
          venue_requirements: 'Private hall',
          equipment_requirements: 'Projector',
          accessibility_needs: 'Step-free access',
          registration_needed: true,
          registration_capacity: null,
          registration_opens_at: null,
          registration_closes_at: null,
          planning_notes: null,
          arrangements_recheck_needed: true,
          outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
        },
      });

    render(
      <EventDetail
        role="Event Coordinator"
        selectedEventId={101}
        accessToken="test-token"
        currentUserId="coord-1"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();

    // Open drawer
    fireEvent.click(screen.getByRole('button', { name: 'Edit Planning Information' }));
    expect(await screen.findByRole('dialog', { name: 'Event Planning Details' })).toBeInTheDocument();

    // Change attendance
    const attendanceInput = screen.getByLabelText(/Expected Attendance/i);
    fireEvent.change(attendanceInput, { target: { value: '150' } });

    // Attempt save -> triggers confirmation required (AC 2)
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    expect(await screen.findByTestId('impact-confirmation-banner')).toBeInTheDocument();
    expect(screen.getByText('Arrangements Require Rechecking')).toBeInTheDocument();
    expect(screen.getByText('Venue Suitability Recheck')).toBeInTheDocument();
    expect(screen.getByText('Equipment Recheck')).toBeInTheDocument();
    expect(screen.getByText(/Attendance increased from 45 to 150/)).toBeInTheDocument();

    // Confirm & Save
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save Changes' }));

    expect(await screen.findByText('150')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(updateSpy).toHaveBeenLastCalledWith(
      101,
      expect.objectContaining({
        expected_attendance: 150,
        confirm_impact: true,
      }),
      'test-token',
    );
  });

  test('Event Coordinator on terminal event (completed, cancelled, rejected) cannot edit planning (AC 5)', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        ...baseDetail,
        status: 'completed',
      },
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: {
        ...baseStage,
        raw_status: 'completed',
        stage: 'Completed',
      },
    });

    render(
      <EventDetail
        role="Event Coordinator"
        selectedEventId={101}
        accessToken="test-token"
        currentUserId="coord-1"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();
    expect(screen.getByText('Planning details cannot be modified for terminal events.')).toBeInTheDocument();
  });

  test('Event Coordinator not assigned to event does not see "Edit Planning Information" button', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        ...baseDetail,
        coordinatorId: 'coord-different',
      },
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: baseStage,
    });

    render(
      <EventDetail
        role="Event Coordinator"
        selectedEventId={101}
        accessToken="test-token"
        currentUserId="coord-1"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();
    expect(screen.getByText('Awaiting assignment to coordinator.')).toBeInTheDocument();
  });

  test('unassigned coordinator event (coordinatorId null) does not show "Edit Planning Information" button', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: {
        ...baseDetail,
        coordinatorId: null,
      },
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: baseStage,
    });

    render(
      <EventDetail
        role="Event Coordinator"
        selectedEventId={101}
        accessToken="test-token"
        currentUserId="coord-1"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();
    expect(screen.getByText('Awaiting assignment to coordinator.')).toBeInTheDocument();
  });

  test('Event Organiser does not see "Edit Planning Information" button', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: baseDetail,
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: baseStage,
    });

    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={101}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Planning Information' })).not.toBeInTheDocument();
  });

  test('displays outstanding arrangements tags when stage contains custom or registration arrangements (AC 3)', async () => {
    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: baseDetail,
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: {
        ...baseStage,
        arrangements_recheck_needed: true,
        outstanding_arrangements: ['venue_recheck', 'registration_recheck', 'custom_arrangement'],
      },
    });

    render(
      <EventDetail
        role="Event Organiser"
        selectedEventId={101}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByTestId('arrangements-recheck-banner')).toBeInTheDocument();
    const tags = screen.getByTestId('outstanding-arrangements-tags');
    expect(tags).toBeInTheDocument();
    expect(screen.getByText('Venue Suitability Recheck')).toBeInTheDocument();
    expect(screen.getByText('Registration Capacity Recheck')).toBeInTheDocument();
    expect(screen.getByText('custom_arrangement')).toBeInTheDocument();
  });

  test('resolves coordinator identity from loadSession when currentUserId prop is omitted', async () => {
    sessionStorage.setItem(
      'connectsphere.session',
      JSON.stringify({
        accessToken: 'stored-token',
        user: { userId: 'coord-1', email: 'coord@test.com', role: 'Event Coordinator' },
      }),
    );

    vi.spyOn(eventRequestsApi, 'fetchOwnEventDetail').mockResolvedValue({
      ok: true,
      request: baseDetail,
    });
    vi.spyOn(eventRequestsApi, 'getEventStage').mockResolvedValue({
      ok: true,
      stage: baseStage,
    });

    render(
      <EventDetail
        role="Event Coordinator"
        selectedEventId={101}
        accessToken="test-token"
        onNavigate={vi.fn()}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Leadership Retreat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Planning Information' })).toBeInTheDocument();
    sessionStorage.clear();
  });
});

