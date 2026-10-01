import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as eventRequestsApi from '../api/eventRequests';
import EventPlanningDrawer, {
  formatForDateTimeInput,
  toIsoOrNull,
  validatePlanningForm,
} from './EventPlanningDrawer';

const SESSION_KEY = 'connectsphere.session';

function setMockSession(token = 'valid-token') {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: token,
      user: { userId: 'coord-1', email: 'coord@example.com', role: 'event_coordinator' },
    }),
  );
}

describe('Helper functions', () => {
  test('formatForDateTimeInput formats dates and handles falsy/invalid inputs', () => {
    expect(formatForDateTimeInput(null)).toBe('');
    expect(formatForDateTimeInput(undefined)).toBe('');
    expect(formatForDateTimeInput('')).toBe('');
    expect(formatForDateTimeInput('not-a-date')).toBe('');

    const formatted = formatForDateTimeInput('2026-11-15T09:30:00.000Z');
    expect(formatted).toMatch(/^2026-11-\d{2}T\d{2}:30$/);
  });

  test('toIsoOrNull converts non-empty strings and returns null for invalid/empty', () => {
    expect(toIsoOrNull('')).toBeNull();
    expect(toIsoOrNull('   ')).toBeNull();
    expect(toIsoOrNull('invalid-date')).toBeNull();

    const iso = toIsoOrNull('2026-11-15T10:00');
    expect(iso).toBeTruthy();
    expect(new Date(iso!).toISOString()).toBe(iso);
  });

  describe('validatePlanningForm', () => {
    const baseValid = {
      proposedDate: '2026-11-15T09:00',
      expectedAttendance: '150',
      registrationNeeded: false,
      registrationCapacity: '',
      registrationOpensAt: '',
      registrationClosesAt: '',
      venueRequirements: 'Auditorium',
      equipmentRequirements: 'Mics',
      accessibilityNeeds: 'Ramp',
      planningNotes: 'Internal note',
    };

    test('returns empty array when form values are valid', () => {
      expect(validatePlanningForm(baseValid)).toEqual([]);
    });

    test('validates proposedDate format when provided', () => {
      const errors = validatePlanningForm({
        ...baseValid,
        proposedDate: 'not-a-valid-date',
      });
      expect(errors).toContain('Proposed date must be a valid date and time.');
    });

    test('validates expectedAttendance boundary conditions', () => {
      expect(
        validatePlanningForm({ ...baseValid, expectedAttendance: '0' }),
      ).toContain('Expected attendance must be a positive whole number.');

      expect(
        validatePlanningForm({ ...baseValid, expectedAttendance: '-10' }),
      ).toContain('Expected attendance must be a positive whole number.');

      expect(
        validatePlanningForm({ ...baseValid, expectedAttendance: '12.5' }),
      ).toContain('Expected attendance must be a positive whole number.');

      expect(
        validatePlanningForm({ ...baseValid, expectedAttendance: '2147483648' }),
      ).toContain('Expected attendance must be at most 2147483647.');
    });

    test('validates text field length limits', () => {
      const longText = 'a'.repeat(5001);
      const errors = validatePlanningForm({
        ...baseValid,
        venueRequirements: longText,
        equipmentRequirements: longText,
        accessibilityNeeds: longText,
        planningNotes: longText,
      });

      expect(errors).toContain('Venue requirements must be 5000 characters or fewer.');
      expect(errors).toContain('Equipment requirements must be 5000 characters or fewer.');
      expect(errors).toContain('Accessibility needs must be 5000 characters or fewer.');
      expect(errors).toContain('Planning notes must be 5000 characters or fewer.');
    });

    test('validates registration parameters when registration is needed', () => {
      const regInvalid = {
        ...baseValid,
        registrationNeeded: true,
        registrationCapacity: '-5',
        registrationOpensAt: 'invalid-open',
        registrationClosesAt: 'invalid-close',
      };

      const errors = validatePlanningForm(regInvalid);
      expect(errors).toContain('Registration capacity must be a positive whole number.');
      expect(errors).toContain('Registration opening time must be a valid date and time.');
      expect(errors).toContain('Registration closing time must be a valid date and time.');

      // Check capacity overflow
      const overflow = validatePlanningForm({
        ...baseValid,
        registrationNeeded: true,
        registrationCapacity: '3000000000',
      });
      expect(overflow).toContain('Registration capacity must be at most 2147483647.');

      // Check registration window sequence
      const badWindow = validatePlanningForm({
        ...baseValid,
        registrationNeeded: true,
        registrationOpensAt: '2026-11-20T10:00',
        registrationClosesAt: '2026-11-10T10:00',
      });
      expect(badWindow).toContain('Registration closing time must be after opening time.');

      // Equal times also invalid
      const equalWindow = validatePlanningForm({
        ...baseValid,
        registrationNeeded: true,
        registrationOpensAt: '2026-11-10T10:00',
        registrationClosesAt: '2026-11-10T10:00',
      });
      expect(equalWindow).toContain('Registration closing time must be after opening time.');
    });

    test('ignores registration fields when registrationNeeded is false', () => {
      const errors = validatePlanningForm({
        ...baseValid,
        registrationNeeded: false,
        registrationCapacity: '-10',
        registrationOpensAt: '2026-11-20T10:00',
        registrationClosesAt: '2026-11-10T10:00',
      });
      expect(errors).toEqual([]);
    });
  });
});

describe('EventPlanningDrawer Component', () => {
  beforeEach(() => {
    sessionStorage.clear();
    setMockSession();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  test('renders nothing when isOpen is false', () => {
    const { container } = render(
      <EventPlanningDrawer
        isOpen={false}
        eventId={42}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders drawer with initial values populated', () => {
    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        initialValues={{
          proposed_date: '2026-11-15T09:00:00.000Z',
          expected_attendance: 150,
          venue_requirements: 'Banquet Hall',
          equipment_requirements: 'Dual Mics',
          accessibility_needs: 'Wheelchair access',
          planning_notes: 'Initial discussion logged',
          registration_needed: true,
          registration_capacity: 150,
          registration_opens_at: '2026-10-01T00:00:00.000Z',
          registration_closes_at: '2026-11-14T23:59:59.000Z',
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Event Planning Details' })).toBeDefined();
    expect(screen.getByText('Planning Details — #42')).toBeDefined();

    expect((screen.getByLabelText('Expected Attendance') as HTMLInputElement).value).toBe('150');
    expect((screen.getByLabelText('Venue Requirements') as HTMLTextAreaElement).value).toBe(
      'Banquet Hall',
    );
    expect((screen.getByLabelText('Equipment Requirements') as HTMLTextAreaElement).value).toBe(
      'Dual Mics',
    );
    expect((screen.getByLabelText('Accessibility Needs') as HTMLTextAreaElement).value).toBe(
      'Wheelchair access',
    );
    expect(
      (screen.getByLabelText(/Planning Notes/i) as HTMLTextAreaElement).value,
    ).toBe('Initial discussion logged');

    expect(screen.getByText('Registration Enabled')).toBeDefined();
    expect((screen.getByLabelText('Registration Capacity') as HTMLInputElement).value).toBe('150');
  });

  test('renders with empty initial values and defaults', () => {
    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={99}
        onClose={vi.fn()}
      />,
    );

    expect((screen.getByLabelText('Expected Attendance') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Venue Requirements') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByText('Registration Disabled')).toBeDefined();
    expect(screen.queryByLabelText('Registration Capacity')).toBeNull();
  });

  test('toggles registration needed section and updates state', () => {
    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onClose={vi.fn()}
      />,
    );

    const toggleButton = screen.getByText('Registration Disabled');
    fireEvent.click(toggleButton);

    expect(screen.getByText('Registration Enabled')).toBeDefined();
    expect(screen.getByLabelText('Registration Capacity')).toBeDefined();

    fireEvent.click(screen.getByText('Registration Enabled'));
    expect(screen.getByText('Registration Disabled')).toBeDefined();
    expect(screen.queryByLabelText('Registration Capacity')).toBeNull();
  });

  test('calls onClose when backdrop or close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onClose={handleClose}
      />,
    );

    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Close planning drawer'));
    expect(handleClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(handleClose).toHaveBeenCalledTimes(3);
  });

  test('calls onClose when Escape key is pressed in the dialog', () => {
    const handleClose = vi.fn();
    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onClose={handleClose}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Event Planning Details' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  test('displays terminal status notice and disables editing (AC 5)', () => {
    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        initialValues={{ status: 'cancelled' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('terminal-status-notice')).toBeDefined();
    expect(
      screen.getByText('Cannot update planning details for a cancelled event.'),
    ).toBeDefined();

    const saveButton = screen.getByRole('button', { name: 'Save Planning Details' });
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    // Clicking registration toggle when terminal does nothing
    const toggleButton = screen.getByText('Registration Disabled');
    fireEvent.click(toggleButton);
    expect(screen.getByText('Registration Disabled')).toBeDefined();
  });

  test('shows client-side validation errors when invalid inputs are saved', async () => {
    const updateSpy = vi.spyOn(eventRequestsApi, 'updateEventPlanning');

    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onClose={vi.fn()}
      />,
    );

    const attendanceInput = screen.getByLabelText('Expected Attendance');
    fireEvent.change(attendanceInput, { target: { value: '-20' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    expect(screen.getByTestId('client-validation-errors')).toBeDefined();
    expect(
      screen.getByText('Expected attendance must be a positive whole number.'),
    ).toBeDefined();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('handles signed-out user when token is missing', async () => {
    sessionStorage.clear();

    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    expect(screen.getByTestId('server-error-notice')).toBeDefined();
    expect(
      screen.getByText('You are signed out. Sign in again to update planning details.'),
    ).toBeDefined();
  });

  test('successfully submits form and triggers onSuccess and onClose', async () => {
    const updateSpy = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: true,
      event: {
        event_id: 42,
        name: 'Updated Summit',
        status: 'planning',
        expected_attendance: 250,
        proposed_date: '2026-11-20T10:00:00.000Z',
        venue_requirements: 'Hall A',
        equipment_requirements: 'Projectors',
        accessibility_needs: null,
        registration_needed: true,
        registration_capacity: 250,
        registration_opens_at: '2026-10-01T00:00:00.000Z',
        registration_closes_at: '2026-11-19T23:59:59.000Z',
        planning_notes: 'All confirmed',
        arrangements_recheck_needed: false,
        outstanding_arrangements: [],
      },
      arrangements_recheck_needed: false,
      outstanding_arrangements: [],
    });

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        accessToken="custom-token"
        onSuccess={handleSuccess}
        onClose={handleClose}
      />,
    );

    fireEvent.change(screen.getByLabelText('Proposed Date & Time'), {
      target: { value: '2026-11-20T10:00' },
    });
    fireEvent.change(screen.getByLabelText('Expected Attendance'), {
      target: { value: '250' },
    });
    fireEvent.change(screen.getByLabelText('Venue Requirements'), {
      target: { value: 'Hall A' },
    });
    fireEvent.change(screen.getByLabelText('Equipment Requirements'), {
      target: { value: 'Projectors' },
    });
    fireEvent.change(screen.getByLabelText('Accessibility Needs'), {
      target: { value: 'Wheelchair access ramp' },
    });
    fireEvent.change(screen.getByLabelText(/Planning Notes/i), {
      target: { value: 'All confirmed' },
    });

    // Enable registration and set values
    fireEvent.click(screen.getByText('Registration Disabled'));
    fireEvent.change(screen.getByLabelText('Registration Capacity'), {
      target: { value: '250' },
    });
    fireEvent.change(screen.getByLabelText('Opens At'), {
      target: { value: '2026-10-01T00:00' },
    });
    fireEvent.change(screen.getByLabelText('Closes At'), {
      target: { value: '2026-11-19T23:59' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(
        42,
        expect.objectContaining({
          expected_attendance: 250,
          venue_requirements: 'Hall A',
          equipment_requirements: 'Projectors',
          accessibility_needs: 'Wheelchair access ramp',
          planning_notes: 'All confirmed',
          registration_needed: true,
          registration_capacity: 250,
          confirm_impact: false,
        }),
        'custom-token',
      );
      expect(handleSuccess).toHaveBeenCalledTimes(1);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  test('handles arrangement impact confirmation handshake (AC 2)', async () => {
    const updateSpy = vi
      .spyOn(eventRequestsApi, 'updateEventPlanning')
      .mockResolvedValueOnce({
        ok: false,
        kind: 'confirmation_required',
        affected_arrangements: ['venue_recheck', 'equipment_recheck', 'custom_recheck'],
        impact_notes: ['Proposed date changed.', 'Attendance increased from 100 to 250.'],
        message: 'Arrangements require rechecking.',
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: 'confirmation_required',
        affected_arrangements: ['venue_recheck', 'equipment_recheck', 'custom_recheck'],
        impact_notes: ['Proposed date changed.', 'Attendance increased from 100 to 250.'],
        message: 'Arrangements require rechecking.',
      })
      .mockResolvedValueOnce({
        ok: true,
        event: {
          event_id: 42,
          status: 'planning',
          expected_attendance: 250,
          proposed_date: '2026-11-20T10:00:00.000Z',
          venue_requirements: null,
          equipment_requirements: null,
          accessibility_needs: null,
          registration_needed: false,
          registration_capacity: null,
          registration_opens_at: null,
          registration_closes_at: null,
          planning_notes: null,
          arrangements_recheck_needed: true,
          outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
        },
        arrangements_recheck_needed: true,
        outstanding_arrangements: ['venue_recheck', 'equipment_recheck'],
      });

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onSuccess={handleSuccess}
        onClose={handleClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    await waitFor(() => {
      expect(screen.getByTestId('impact-confirmation-banner')).toBeDefined();
    });

    expect(screen.getByText('Arrangements Require Rechecking')).toBeDefined();
    expect(screen.getByText('Venue Suitability Recheck')).toBeDefined();
    expect(screen.getByText('Equipment Recheck')).toBeDefined();
    expect(screen.getByText('custom_recheck')).toBeDefined();
    expect(screen.getByText('Proposed date changed.')).toBeDefined();

    // Click Back to Editing
    fireEvent.click(screen.getByRole('button', { name: 'Back to Editing' }));
    expect(screen.queryByTestId('impact-confirmation-banner')).toBeNull();

    // Trigger save again and confirm
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    await waitFor(() => {
      expect(screen.getByTestId('impact-confirmation-banner')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save Changes' }));

    await waitFor(() => {
      expect(updateSpy).toHaveBeenLastCalledWith(
        42,
        expect.objectContaining({ confirm_impact: true }),
        'valid-token',
      );
      expect(handleSuccess).toHaveBeenCalledTimes(1);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  test('handles server validation errors with details array', async () => {
    vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: false,
      kind: 'validation',
      message: 'Invalid planning details',
      details: ['registration_closes_at must be after registration_opens_at.'],
    });

    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    await waitFor(() => {
      expect(screen.getByTestId('server-error-notice')).toBeDefined();
      expect(screen.getByText('Invalid planning details')).toBeDefined();
      expect(
        screen.getByText('registration_closes_at must be after registration_opens_at.'),
      ).toBeDefined();
    });
  });

  test('handles general server errors (conflict, forbidden, etc.)', async () => {
    vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: false,
      kind: 'conflict',
      message: 'Cannot update planning information for this event.',
    });

    render(
      <EventPlanningDrawer
        isOpen={true}
        eventId={42}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    await waitFor(() => {
      expect(screen.getByTestId('server-error-notice')).toBeDefined();
      expect(
        screen.getByText('Cannot update planning information for this event.'),
      ).toBeDefined();
    });
  });
});
