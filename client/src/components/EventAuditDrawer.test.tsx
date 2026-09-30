import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { EventAuditDrawer, formatSgtTimestamp, humanizeFieldName } from './EventAuditDrawer';
import * as eventRequestsApi from '../api/eventRequests';
import type { EventAuditLogEntry } from '../api/eventRequests';

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
    actor_id: 'coord-uuid-1',
    actor_name: 'Sarah Coordinator',
    field_name: 'venue_requirements',
    old_value: null,
    new_value: 'Auditorium with stage lighting',
    created_at: '2026-09-25T14:00:00.000Z',
  },
  {
    log_id: 100,
    event_id: 42,
    actor_id: 'coord-uuid-1',
    actor_name: 'Sarah Coordinator',
    field_name: 'accessibility_needs',
    old_value: 'Wheelchair ramp',
    new_value: null,
    created_at: '2026-09-25T13:30:00.000Z',
  },
];

describe('EventAuditDrawer Component (SG2-40)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('helper functions', () => {
    test('formatSgtTimestamp formats ISO date into SGT representation', () => {
      const formatted = formatSgtTimestamp('2026-09-25T14:30:00.000Z');
      expect(formatted).toContain('2026');
      expect(formatted).toContain('22:30');
      expect(formatted).toContain('SGT');
    });

    test('formatSgtTimestamp handles invalid dates gracefully', () => {
      expect(formatSgtTimestamp('invalid-date')).toBe('Date not available');
      expect(formatSgtTimestamp(null)).toBe('Date not available');
    });

    test('humanizeFieldName translates snake_case fields into user-friendly labels', () => {
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
    test('does not render drawer content when isOpen is false', () => {
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

    test('renders dialog with accessible title and header when isOpen is true', async () => {
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

    test('calls onClose when close button is clicked', async () => {
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

    test('calls onClose when Escape key is pressed', async () => {
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

    test('does not call onClose when a key other than Escape is pressed', async () => {
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

    test('calls onClose when clicking outside backdrop', async () => {
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
    test('renders loading indicator while fetching history', () => {
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

    test('displays error notice and retry button when fetching fails', async () => {
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

    test('displays friendly empty placeholder when event has no history records', async () => {
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

    test('renders timeline entries with actor names, SGT timestamps, humanized labels, and diffs', async () => {
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
        expect(screen.getAllByText('Sarah Coordinator').length).toBe(3);
      });

      // Entry 1: expected_attendance
      expect(screen.getByText('Expected Attendance')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('250')).toBeInTheDocument();

      // Entry 2: venue_requirements (with null old value)
      expect(screen.getByText('Venue Requirements')).toBeInTheDocument();
      expect(screen.getAllByText('(empty)').length).toBe(2);
      expect(screen.getByText('Auditorium with stage lighting')).toBeInTheDocument();

      // Entry 3: accessibility_needs (with null new value)
      expect(screen.getByText('Accessibility Needs')).toBeInTheDocument();
      expect(screen.getByText('Wheelchair ramp')).toBeInTheDocument();
    });

    test('displays signed-out error if no token is available', async () => {
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

    test('handles unexpected fetch exception gracefully', async () => {
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
  });
});

