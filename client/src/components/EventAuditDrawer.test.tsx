import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, act, within } from '@testing-library/react';
import { EventAuditDrawer, formatSgtTimestamp, humanizeFieldName, humanizeFieldValue } from './EventAuditDrawer';
import * as eventRequestsApi from '../api/eventRequests';
import type { EventAuditLogEntry, GetEventHistoryOutcome } from '../api/eventRequests';

const MOCK_ENTRIES: EventAuditLogEntry[] = [
  {
    log_id: 102,
    event_id: 42,
    actor_id: 'coord-uuid-1',
    actor_name: 'Sarah Coordinator',
    field_name: 'expected_attendance',
    old_value: '100',
    new_value: '250',
    created_at: '2026-09-25T14:30:00.000Z',
  },
  {
    log_id: 101,
    event_id: 42,
    actor_id: 'coord-uuid-2',
    actor_name: 'Priya Coordinator',
    field_name: 'venue_requirements',
    old_value: null,
    new_value: 'Auditorium with stage lighting',
    created_at: '2026-09-25T14:00:00.000Z',
  },
  {
    log_id: 100,
    event_id: 42,
    actor_id: 'support-uuid-3',
    actor_name: 'Daniel Support',
    field_name: 'accessibility_needs',
    old_value: 'Wheelchair ramp',
    new_value: null,
    created_at: '2026-09-25T13:30:00.000Z',
  },
];

describe('EventAuditDrawer Component (SG2-40)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  describe('helper functions', () => {
    test('[NORMAL] [SG2-40:AC1] formatSgtTimestamp formats ISO date into SGT representation', () => {
      const formatted = formatSgtTimestamp('2026-09-25T14:30:00.000Z');
      expect(formatted).toBe('25 Sept 2026, 22:30 SGT');
    });

    test('[FAILURE] [SG2-40:timestamp-fallback] formatSgtTimestamp handles invalid dates gracefully', () => {
      expect(formatSgtTimestamp('invalid-date')).toBe('Date not available');
      expect(formatSgtTimestamp(null)).toBe('Date not available');
    });

    test('[NORMAL] [SG2-40:AC2] humanizeFieldName translates snake_case fields into user-friendly labels', () => {
      expect(humanizeFieldName('expected_attendance')).toBe('Expected Attendance');
      expect(humanizeFieldName('proposed_date')).toBe('Proposed Date');
      expect(humanizeFieldName('venue_requirements')).toBe('Venue Requirements');
      expect(humanizeFieldName('equipment_requirements')).toBe('Equipment Requirements');
      expect(humanizeFieldName('accessibility_needs')).toBe('Accessibility Needs');
      expect(humanizeFieldName('registration_needed')).toBe('Registration Needed');
      expect(humanizeFieldName('registration_capacity')).toBe('Registration Capacity');
      expect(humanizeFieldName('registration_opens_at')).toBe('Registration Opens At');
      expect(humanizeFieldName('registration_closes_at')).toBe('Registration Closes At');
      expect(humanizeFieldName('planning_notes')).toBe('Planning Notes');
      expect(humanizeFieldName('arrangements_recheck_needed')).toBe('Arrangements Recheck Needed');
      expect(humanizeFieldName('custom_unknown_field')).toBe('custom_unknown_field');
    });
  });

  describe('drawer visibility and accessibility', () => {
    test('[NORMAL] [SG2-40:drawer-visibility] does not render drawer content when isOpen is false', () => {
      render(
        <EventAuditDrawer
          isOpen={false}
          onClose={vi.fn()}
          eventId={42}
          eventName="Tech Symposium"
          accessToken="token-1"
        />
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    test('[NORMAL] [SG2-40:drawer-visibility] renders dialog with accessible title and header when isOpen is true', async () => {
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({
        ok: true,
        history: [],
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          eventName="Tech Symposium"
          accessToken="token-1"
        />
      );

      const dialog = screen.getByRole('dialog', { name: /change history/i });
      expect(dialog).toBeInTheDocument();
      expect(screen.getByText(/Tech Symposium/i)).toBeInTheDocument();
      expect(screen.getByText(/#42/i)).toBeInTheDocument();
    });

    test('[NORMAL] [SG2-40:drawer-visibility] calls onClose when close button is clicked', async () => {
      const handleClose = vi.fn();
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({
        ok: true,
        history: [],
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={handleClose}
          eventId={42}
          eventName="Tech Symposium"
          accessToken="token-1"
        />
      );

      const closeButton = screen.getByRole('button', { name: /close change history/i });
      fireEvent.click(closeButton);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    test('[NORMAL] [SG2-40:drawer-visibility] calls onClose when Escape key is pressed', async () => {
      const handleClose = vi.fn();
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({
        ok: true,
        history: [],
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={handleClose}
          eventId={42}
          eventName="Tech Symposium"
          accessToken="token-1"
        />
      );

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    test('[BOUNDARY] [SG2-40:drawer-visibility] does not call onClose when a key other than Escape is pressed', async () => {
      const handleClose = vi.fn();
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({
        ok: true,
        history: [],
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={handleClose}
          eventId={42}
          eventName="Tech Symposium"
          accessToken="token-1"
        />
      );

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', code: 'Tab' });
      expect(handleClose).not.toHaveBeenCalled();
    });

    test('[NORMAL] [SG2-40:drawer-visibility] calls onClose when clicking outside backdrop', async () => {
      const handleClose = vi.fn();
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({
        ok: true,
        history: [],
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={handleClose}
          eventId={42}
          eventName="Tech Symposium"
          accessToken="token-1"
        />
      );

      const backdrop = screen.getByTestId('audit-drawer-backdrop');
      fireEvent.click(backdrop);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('data fetching states', () => {
    test('[NORMAL] [SG2-85:AC5] automatic hold expiry identifies the actor as System and gives the hold field a readable label', async () => {
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({ ok: true, history: [{
        ...MOCK_ENTRIES[0], actor_id: null, actor_name: 'Unknown', field_name: 'venue_hold_status', old_value: 'Active', new_value: 'Expired',
      }] });
      render(<EventAuditDrawer isOpen={true} onClose={vi.fn()} eventId={42} accessToken="token" />);
      expect(await screen.findByText('System')).toBeInTheDocument();
      expect(screen.getByText('Automatic')).toBeInTheDocument();
      expect(screen.getByText('Tentative Hold Status')).toBeInTheDocument();
      expect(screen.getByTestId('diff-old')).toHaveTextContent('Active');
      expect(screen.getByTestId('diff-new')).toHaveTextContent('Expired');
      expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    });

    test('[NORMAL] [SG2-40:loading-state] renders loading indicator while fetching history', () => {
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockImplementation(
        () => new Promise(() => {}) // never resolves
      );

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          accessToken="token-1"
        />
      );

      expect(screen.getByRole('status')).toHaveTextContent(/loading change history/i);
    });

    test('[FAILURE] [SG2-40:error-retry] displays error notice and retry button when fetching fails', async () => {
      const getHistorySpy = vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValueOnce({
        ok: false,
        kind: 'unavailable',
        message: 'Database connection failed.',
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          accessToken="token-1"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Database connection failed.');
      });

      // Clicking Retry calls getEventHistory again
      getHistorySpy.mockResolvedValueOnce({
        ok: true,
        history: MOCK_ENTRIES,
      });

      const retryBtn = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText('Expected Attendance')).toBeInTheDocument();
      });
      expect(getHistorySpy).toHaveBeenCalledTimes(2);
    });

    test('[BOUNDARY] [SG2-40:AC1] displays friendly empty placeholder when event has no history records', async () => {
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({
        ok: true,
        history: [],
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          accessToken="token-1"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/no change history recorded for this event yet/i)).toBeInTheDocument();
      });
    });

    test('[NORMAL] [SG2-40:AC1] [SG2-40:AC2] renders timeline entries newest-first with expected SGT timestamps, field labels, and old/new values', async () => {
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockResolvedValue({
        ok: true,
        history: MOCK_ENTRIES,
      });

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          eventName="Tech Symposium"
          accessToken="token-1"
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('audit-entry-102')).toBeInTheDocument();
      });

      // Rendered entry order must match the newest-first order of MOCK_ENTRIES (log_id 102, 101, 100).
      const entries = screen.getAllByTestId(/^audit-entry-/);
      expect(entries.map((entry) => entry.getAttribute('data-testid'))).toEqual([
        'audit-entry-102',
        'audit-entry-101',
        'audit-entry-100',
      ]);

      // Entry 1 (log_id 102): expected_attendance, 100 -> 250
      const entry102 = within(entries[0]);
      expect(entry102.getByText('Sarah Coordinator')).toBeInTheDocument();
      expect(entry102.getByText('Expected Attendance')).toBeInTheDocument();
      expect(entry102.getByText('25 Sept 2026, 22:30 SGT')).toBeInTheDocument();
      expect(entry102.getByTestId('diff-old')).toHaveTextContent('100');
      expect(entry102.getByTestId('diff-new')).toHaveTextContent('250');

      // Entry 2 (log_id 101): venue_requirements, (empty) -> Auditorium with stage lighting
      const entry101 = within(entries[1]);
      expect(entry101.getByText('Priya Coordinator')).toBeInTheDocument();
      expect(entry101.getByText('Venue Requirements')).toBeInTheDocument();
      expect(entry101.getByText('25 Sept 2026, 22:00 SGT')).toBeInTheDocument();
      expect(entry101.getByTestId('diff-old')).toHaveTextContent('(empty)');
      expect(entry101.getByTestId('diff-new')).toHaveTextContent('Auditorium with stage lighting');

      // Entry 3 (log_id 100): accessibility_needs, Wheelchair ramp -> (empty)
      const entry100 = within(entries[2]);
      expect(entry100.getByText('Daniel Support')).toBeInTheDocument();
      expect(entry100.getByText('Accessibility Needs')).toBeInTheDocument();
      expect(entry100.getByText('25 Sept 2026, 21:30 SGT')).toBeInTheDocument();
      expect(entry100.getByTestId('diff-old')).toHaveTextContent('Wheelchair ramp');
      expect(entry100.getByTestId('diff-new')).toHaveTextContent('(empty)');
    });

    test('[FAILURE] [SG2-40:signed-out-history] displays signed-out error if no token is available', async () => {
      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          accessToken={null}
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('You are signed out. Sign in again to view change history.');
      });
    });

    test('[FAILURE] [SG2-40:service-failure] handles unexpected fetch exception gracefully', async () => {
      vi.spyOn(eventRequestsApi, 'getEventHistory').mockRejectedValue(new Error('Network error'));

      render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          accessToken="token-1"
        />
      );

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Could not reach the server. Please try again.');
      });
    });

    test('[CONFLICT] [SG2-40:history-isolation] ignores a stale fetch response when eventId flips mid-fetch', async () => {
      let resolveFirst!: (value: GetEventHistoryOutcome) => void;
      let resolveSecond!: (value: GetEventHistoryOutcome) => void;

      const getHistory = vi.spyOn(eventRequestsApi, 'getEventHistory')
        .mockImplementationOnce(
          () => new Promise((resolve) => { resolveFirst = resolve; })
        )
        .mockImplementationOnce(
          () => new Promise((resolve) => { resolveSecond = resolve; })
        );

      const { rerender } = render(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={42}
          accessToken="token-1"
        />
      );

      // Flip to a different event before the first fetch has resolved.
      rerender(
        <EventAuditDrawer
          isOpen={true}
          onClose={vi.fn()}
          eventId={99}
          accessToken="token-1"
        />
      );

      expect(getHistory).toHaveBeenCalledTimes(2);
      expect(getHistory).toHaveBeenNthCalledWith(1, 42, 'token-1');
      expect(getHistory).toHaveBeenNthCalledWith(2, 99, 'token-1');

      // The newer request (for event 99) resolves first.
      resolveSecond({ ok: true, history: [{ ...MOCK_ENTRIES[0], event_id: 99 }] });
      await waitFor(() => {
        expect(screen.getByText('Expected Attendance')).toBeInTheDocument();
      });

      // The stale request (for event 42) resolves afterwards and must be ignored.
      await act(async () => {
        resolveFirst({ ok: true, history: [MOCK_ENTRIES[1]] });
      });

      expect(screen.queryByText('Venue Requirements')).not.toBeInTheDocument();
      expect(screen.getByText('Expected Attendance')).toBeInTheDocument();
    });

    test('[CONFLICT] [SG2-40:history-isolation] reopening during a pending fetch keeps the refreshed history', async () => {
      let resolveFirst!: (value: GetEventHistoryOutcome) => void;
      let resolveSecond!: (value: GetEventHistoryOutcome) => void;
      const getHistory = vi.spyOn(eventRequestsApi, 'getEventHistory')
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
        .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
      const props = { onClose: vi.fn(), eventId: 42, accessToken: 'token-1' };
      const { rerender } = render(<EventAuditDrawer {...props} isOpen={true} />);

      rerender(<EventAuditDrawer {...props} isOpen={false} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      rerender(<EventAuditDrawer {...props} isOpen={true} />);
      expect(getHistory).toHaveBeenCalledTimes(2);

      await act(async () => {
        resolveFirst({ ok: true, history: [MOCK_ENTRIES[0]] });
      });
      expect(screen.getByRole('status')).toHaveTextContent('Loading change history');
      expect(screen.queryByText('Expected Attendance')).not.toBeInTheDocument();

      await act(async () => {
        resolveSecond({ ok: true, history: [MOCK_ENTRIES[1]] });
      });
      expect(screen.getByText('Venue Requirements')).toBeInTheDocument();
      expect(screen.queryByText('Expected Attendance')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});


describe('humanizeFieldValue (SG2-100 AC5)', () => {
  test('[NORMAL] [SG2-100:AC5] a status row reads in plain language, not as a stored value', () => {
    expect(humanizeFieldValue('status', 'awaiting_safety_check')).toBe('Awaiting Safety Check');
    expect(humanizeFieldValue('status', 'unassigned')).toBe('Awaiting Assignment');
    expect(humanizeFieldValue('status', 'completed')).toBe('Completed');
  });

  test('[BOUNDARY] [SG2-100:AC5] every other field is passed through untouched', () => {
    // Deliberately a value that collides with a status name: only `status`
    // rows are translated, so a note that happens to say "preparation" is
    // not rewritten.
    expect(humanizeFieldValue('planning_notes', 'preparation')).toBe('preparation');
    expect(humanizeFieldValue('coordinator_id', 'Jane Doe')).toBe('Jane Doe');
    expect(humanizeFieldValue('expected_attendance', '120')).toBe('120');
  });

  test('[FAILURE] [SG2-100:AC5] an absent value reads as empty for any field', () => {
    expect(humanizeFieldValue('status', null)).toBe('(empty)');
    expect(humanizeFieldValue('planning_notes', null)).toBe('(empty)');
  });
});
