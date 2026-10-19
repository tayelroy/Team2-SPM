vi.hoisted(() => vi.stubEnv('TZ', 'UTC'));

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
  test('[FAILURE] [SG2-39:planning-date] formatForDateTimeInput formats dates and handles falsy/invalid inputs', () => {
    expect(formatForDateTimeInput(null)).toBe('');
    expect(formatForDateTimeInput(undefined)).toBe('');
    expect(formatForDateTimeInput('')).toBe('');
    expect(formatForDateTimeInput('not-a-date')).toBe('');

    const formatted = formatForDateTimeInput('2026-11-15T09:30:00.000Z');
    expect(formatted).toBe('2026-11-15T09:30');
  });

  test('[FAILURE] [SG2-39:planning-date] toIsoOrNull converts non-empty strings and returns null for invalid/empty', () => {
    expect(toIsoOrNull('')).toBeNull();
    expect(toIsoOrNull('   ')).toBeNull();
    expect(toIsoOrNull('invalid-date')).toBeNull();

    const iso = toIsoOrNull('2026-11-15T10:00');
    expect(iso).toBe('2026-11-15T10:00:00.000Z');
  });

  describe('validatePlanningForm', () => {
    const baseValid = {
      proposedDate: '2026-11-15T09:00',
      initialProposedDate: '2026-11-15T09:00',
      now: Date.parse('2026-10-01T00:00:00.000Z'),
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

    test('[NORMAL] [SG2-39:planning-validation] returns empty array when form values are valid', () => {
      expect(validatePlanningForm(baseValid)).toEqual([]);
    });

    test('[FAILURE] [SG2-39:planning-validation] validates proposedDate format when provided', () => {
      const errors = validatePlanningForm({
        ...baseValid,
        proposedDate: 'not-a-valid-date',
      });
      expect(errors).toContain('Proposed date must be a valid date and time.');
    });

    test('[BOUNDARY] [SG2-39:planning-validation] validates expectedAttendance boundary conditions', () => {
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

    test.each(['1', '2147483647'])('[BOUNDARY] [SG2-39:AC4] accepts the exact inclusive attendance and registration capacity limit %s', (limit) => {
      expect(validatePlanningForm({ ...baseValid, expectedAttendance: limit,
        registrationNeeded: true, registrationCapacity: limit,
        registrationOpensAt: '2026-11-10T10:00', registrationClosesAt: '2026-11-10T10:01',
      })).toEqual([]);
    });

    test('[BOUNDARY] [SG2-39:planning-validation] accepts 5000 characters in each planning text field', () => {
      const text = 'a'.repeat(5000);
      expect(validatePlanningForm({ ...baseValid, venueRequirements: text,
        equipmentRequirements: text, accessibilityNeeds: text, planningNotes: text,
      })).toEqual([]);
    });

    test('[BOUNDARY] [SG2-39:planning-validation] validates text field length limits', () => {
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

    test('[BOUNDARY] [SG2-39:AC4] validates registration parameters when registration is needed', () => {
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

    test('[BOUNDARY] [SG2-39:AC4] a newly chosen proposed date must be in the future', () => {
      const past = 'Proposed date must be in the future.';
      expect(validatePlanningForm({ ...baseValid, proposedDate: '2020-01-01T01:00' })).toEqual([past]);
      expect(validatePlanningForm({ ...baseValid, proposedDate: '2026-10-01T00:00' })).toEqual([past]);
      expect(validatePlanningForm({ ...baseValid, proposedDate: '2026-10-01T00:01' })).toEqual([]);
      // A date the event already had is not re-judged against the clock.
      expect(validatePlanningForm({ ...baseValid, proposedDate: '2020-01-01T01:00',
        initialProposedDate: '2020-01-01T01:00' })).toEqual([]);
    });

    test('[FAILURE] [SG2-39:AC4] registration must open and close before the event starts', () => {
      const event = { ...baseValid, proposedDate: '2030-06-20T01:00', initialProposedDate: '2030-06-20T01:00',
        registrationNeeded: true, registrationCapacity: '50' };
      expect(validatePlanningForm({ ...event, registrationOpensAt: '2030-06-01T01:00',
        registrationClosesAt: '2030-12-31T01:00' })).toEqual(['Registration closing time must be before the event starts.']);
      expect(validatePlanningForm({ ...event, registrationOpensAt: '2030-06-20T01:00',
        registrationClosesAt: '2030-06-21T01:00' })).toEqual([
        'Registration opening time must be before the event starts.',
        'Registration closing time must be before the event starts.',
      ]);
      expect(validatePlanningForm({ ...event, registrationOpensAt: '2030-06-01T01:00',
        registrationClosesAt: '2030-06-20T00:59' })).toEqual([]);
      // Without an event date there is no start to compare against.
      expect(validatePlanningForm({ ...event, proposedDate: '', registrationOpensAt: '2030-06-01T01:00',
        registrationClosesAt: '2030-12-31T01:00' })).toEqual([]);
    });

    test('[NORMAL] [SG2-39:AC4] ignores registration fields when registrationNeeded is false', () => {
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
    // Only the clock is pinned; promises and waitFor keep real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
    // jsdom has no scrollIntoView; the drawer scrolls each new message into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    sessionStorage.clear();
  });

  const storedRegistration = {
    registration_needed: true,
    registration_capacity: 136,
    registration_opens_at: '2026-10-01T13:30:00.000Z',
    registration_closes_at: '2026-10-01T13:31:00.000Z',
    planning_notes: 'Keep the loading bay clear',
    expected_crowd_movement: null,
  };
  const savedPlanning = {
    event_id: 17, status: 'planning', expected_attendance: 136,
    proposed_date: '2030-06-20T01:00:00.000Z', venue_requirements: 'Hall A',
    equipment_requirements: '1 projector', accessibility_needs: null,
    ...storedRegistration, arrangements_recheck_needed: false, outstanding_arrangements: [],
  };

  test('[NORMAL] [SG2-39:AC1] [SG2-41:AC4] saving an unrelated planning edit retains loaded registration values and notes', async () => {
    const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: true, event: savedPlanning, arrangements_recheck_needed: false, outstanding_arrangements: [],
    });
    const onClose = vi.fn();
    render(<EventPlanningDrawer eventId={17} initialValues={savedPlanning} onClose={onClose} />);
    expect(screen.getByLabelText('Registration Capacity')).toHaveValue(136);
    expect(screen.getByLabelText('Opens At')).toHaveValue('2026-10-01T13:30');
    expect(screen.getByLabelText('Closes At')).toHaveValue('2026-10-01T13:31');
    expect(screen.getByLabelText(/Planning Notes/i)).toHaveValue('Keep the loading bay clear');
    fireEvent.change(screen.getByLabelText('Equipment Requirements'), { target: { value: '2 projectors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(17, expect.objectContaining({
      ...storedRegistration, equipment_requirements: '2 projectors',
    }), 'valid-token');
  });

  test('[BOUNDARY] [SG2-39:AC1] distinguishes loaded empty values from omitted fields while retaining explicit clearing', async () => {
    const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: false, kind: 'unavailable', message: 'Planning unavailable.',
    });
    render(<EventPlanningDrawer eventId={17} onClose={vi.fn()} initialValues={{
      registration_needed: true, registration_capacity: 136, registration_opens_at: null,
      registration_closes_at: null, planning_notes: 'Clear this note',
    }} />);
    fireEvent.change(screen.getByLabelText('Registration Capacity'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Planning Notes/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    await screen.findByText('Planning unavailable.');
    expect(update).toHaveBeenCalledWith(17, {
      registration_needed: true, registration_capacity: null, registration_opens_at: null,
      registration_closes_at: null, planning_notes: null, confirm_impact: false,
    }, 'valid-token');
  });

  test('[CONFLICT] [SG2-39:AC1] an incomplete queue form cannot erase registration data stored after the queue was loaded', async () => {
    // The server has data that this older queue response never included.
    const storage = { ...savedPlanning };
    const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockImplementation(async (_id, patch) => {
      Object.assign(storage, patch);
      return { ok: true, event: storage, arrangements_recheck_needed: false, outstanding_arrangements: [] };
    });
    const onClose = vi.fn();
    render(<EventPlanningDrawer eventId={17} onClose={onClose} initialValues={{
      registration_needed: true, equipment_requirements: '1 projector',
    }} />);
    fireEvent.change(screen.getByLabelText('Equipment Requirements'), { target: { value: '2 projectors' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(17, {
      registration_needed: true, equipment_requirements: '2 projectors', confirm_impact: false,
    }, 'valid-token');
    expect(storage).toMatchObject({ ...storedRegistration, equipment_requirements: '2 projectors' });
  });

  test('[FAILURE] [SG2-39:AC1] retrying an unavailable save from missing initial values does not submit unseen fields as empty', async () => {
    const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: false, kind: 'unavailable', message: 'Planning unavailable.',
    });
    render(<EventPlanningDrawer eventId={17} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Planning Notes/i), { target: { value: 'New note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    await screen.findByText('Planning unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    for (const call of update.mock.calls) {
      expect(call).toEqual([17, { planning_notes: 'New note', confirm_impact: false }, 'valid-token']);
    }
    expect(screen.getByRole('dialog', { name: 'Event Planning Details' })).toBeVisible();
  });

  test('[NORMAL] [SG2-39:AC1] cancelling discards unsaved edits, so reopening shows the saved values', () => {
    const saved = { expected_attendance: 100, planning_notes: 'Catering booked', status: 'planning' };
    const onClose = vi.fn();
    const { rerender } = render(<EventPlanningDrawer isOpen eventId={91} onClose={onClose} initialValues={saved} />);
    fireEvent.change(screen.getByLabelText('Expected Attendance'), { target: { value: '999' } });
    fireEvent.change(screen.getByLabelText(/Planning Notes/i), { target: { value: 'Draft thought' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<EventPlanningDrawer isOpen={false} eventId={91} onClose={onClose} initialValues={saved} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<EventPlanningDrawer isOpen eventId={91} onClose={onClose} initialValues={saved} />);
    expect(screen.getByLabelText('Expected Attendance')).toHaveValue(100);
    expect(screen.getByLabelText(/Planning Notes/i)).toHaveValue('Catering booked');
  });

  test('[FAILURE] [SG2-39:AC4] a validation error is scrolled into view and focused, again on every failed save', () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    render(<EventPlanningDrawer eventId={91} onClose={vi.fn()} initialValues={{ expected_attendance: 100 }} />);
    fireEvent.change(screen.getByLabelText('Expected Attendance'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    const alert = within(screen.getByTestId('client-validation-errors')).getByRole('alert');
    expect(alert).toHaveTextContent('Expected attendance must be a positive whole number.');
    expect(alert).toHaveFocus();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(alert);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });

    // The same error again still brings the message back into view.
    screen.getByRole('button', { name: 'Save Planning Details' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(alert).toHaveFocus();
  });

  test('[CONFLICT] [SG2-39:AC2] the arrangements warning is scrolled into view and focused when the server asks to confirm', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: false, kind: 'confirmation_required', message: 'Arrangements require rechecking.',
      affected_arrangements: ['venue_recheck'],
      impact_notes: ['Expected attendance increased from 100 to 120. Existing venue booking must be rechecked.'],
    });
    render(<EventPlanningDrawer eventId={91} accessToken="token" onClose={vi.fn()} initialValues={{ expected_attendance: 100 }} />);
    fireEvent.change(screen.getByLabelText('Expected Attendance'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    const warning = await within(await screen.findByTestId('impact-confirmation-banner')).findByRole('alert');
    expect(warning).toHaveTextContent('Arrangements Require Rechecking');
    await waitFor(() => expect(warning).toHaveFocus());
    expect(scroll.mock.contexts).toEqual([warning]);
  });

  test('[FAILURE] [SG2-39:AC4] a refusal from the server is scrolled into view and focused', async () => {
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: false, kind: 'validation', message: 'Invalid planning details',
      details: ['registration_closes_at must be before the event starts (proposed_date).'],
    });
    render(<EventPlanningDrawer eventId={91} accessToken="token" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));

    const alert = await within(await screen.findByTestId('server-error-notice')).findByRole('alert');
    expect(alert).toHaveTextContent('registration_closes_at must be before the event starts (proposed_date).');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(scroll.mock.contexts).toEqual([alert]);
  });

  test('[FAILURE] [SG2-39:AC4] a past proposed date or a registration window after the start is refused before saving', () => {
    const updateSpy = vi.spyOn(eventRequestsApi, 'updateEventPlanning');
    render(
      <EventPlanningDrawer
        eventId={91}
        onClose={vi.fn()}
        initialValues={{ proposed_date: '2030-06-20T01:00:00.000Z', expected_attendance: 100, status: 'approved' }}
      />,
    );

    fireEvent.change(screen.getByLabelText('Proposed Date & Time'), { target: { value: '2020-01-01T01:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    expect(screen.getByTestId('client-validation-errors')).toHaveTextContent('Proposed date must be in the future.');

    fireEvent.change(screen.getByLabelText('Proposed Date & Time'), { target: { value: '2030-06-20T01:00' } });
    fireEvent.click(screen.getByText('Registration Disabled'));
    fireEvent.change(screen.getByLabelText('Registration Capacity'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Opens At'), { target: { value: '2030-06-01T01:00' } });
    fireEvent.change(screen.getByLabelText('Closes At'), { target: { value: '2030-12-31T01:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    const errors = screen.getByTestId('client-validation-errors');
    expect(errors).toHaveTextContent('Registration closing time must be before the event starts.');
    expect(errors).not.toHaveTextContent('Proposed date must be in the future.');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  test('[BOUNDARY] [SG2-39:AC1] renders nothing when isOpen is false', () => {
    const { container } = render(
      <EventPlanningDrawer
        isOpen={false}
        eventId={42}
        onClose={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  test('[NORMAL] [SG2-39:AC1] renders drawer with initial values populated', () => {
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

  test('[BOUNDARY] [SG2-39:AC1] renders with empty initial values and defaults', () => {
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

  test('[NORMAL] [SG2-39:AC1] toggles registration needed section and updates state', () => {
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

  test('[NORMAL] [SG2-39:AC1] calls onClose when backdrop or close button is clicked', () => {
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

  test('[NORMAL] [SG2-39:AC1] calls onClose when Escape key is pressed in the dialog', () => {
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

  test('[CONFLICT] [SG2-39:AC5] displays terminal status notice and disables editing (AC 5)', () => {
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

  test('[FAILURE] [SG2-39:planning-validation] shows client-side validation errors when invalid inputs are saved', async () => {
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

  test('[FAILURE] [SG2-39:AC1] handles signed-out user when token is missing', async () => {
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

  test('[NORMAL] [SG2-39:AC1] successfully submits form and triggers onSuccess and onClose', async () => {
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
        expected_crowd_movement: null,
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

  test('[CONFLICT] [SG2-39:duplicate-save] a second save while planning is being saved sends one update', async () => {
    let finish!: (result: Awaited<ReturnType<typeof eventRequestsApi.updateEventPlanning>>) => void;
    const updateSpy = vi.spyOn(eventRequestsApi, 'updateEventPlanning')
      .mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<EventPlanningDrawer eventId={42} accessToken="custom-token" onSuccess={onSuccess} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Expected Attendance'), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish({ ok: false, kind: 'unavailable', message: 'Please try again.' }));
    expect(screen.getByText('Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Planning Details' })).toBeEnabled();
    expect(updateSpy).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test('[CONFLICT] [SG2-39:AC2] handles arrangement impact confirmation handshake (AC 2)', async () => {
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
          expected_crowd_movement: null,
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

  test('[FAILURE] [SG2-39:planning-validation] handles server validation errors with details array', async () => {
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

  test('[CONFLICT] [SG2-39:AC5] a refused planning transition keeps the drawer open', async () => {
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

  for (const [status, stage] of [['confirmed', 'Confirmed'], ['PREPARATION', 'in Preparation']] as const) {
    test(`[NORMAL] [SG2-66:AC6] a ${status} event locks its details, points to a change request and saves only registration and notes`, async () => {
      const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
        ok: true, event: { ...savedPlanning, status }, arrangements_recheck_needed: false, outstanding_arrangements: [],
      });
      const onClose = vi.fn();
      render(<EventPlanningDrawer eventId={17} initialValues={{ ...savedPlanning, status }} onClose={onClose} />);
      expect(screen.getByTestId('change-request-lock-notice')).toHaveTextContent(
        `This event is ${stage}, so its date, attendance and requirements can no longer be edited here. Ask for those changes through a change request; registration settings and planning notes can still be updated.`);
      for (const label of ['Proposed Date & Time', 'Expected Attendance', 'Venue Requirements', 'Equipment Requirements', 'Accessibility Needs']) {
        expect(screen.getByLabelText(label)).toBeDisabled();
      }
      expect(screen.getByLabelText('Registration Capacity')).toBeEnabled();
      expect(screen.getByLabelText(/Planning Notes/i)).toBeEnabled();
      fireEvent.change(screen.getByLabelText('Registration Capacity'), { target: { value: '120' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(update).toHaveBeenCalledWith(17, {
        ...storedRegistration, registration_capacity: 120, confirm_impact: false,
      }, 'valid-token');
    });
  }

  test('[BOUNDARY] [SG2-66:AC6] an awaiting safety check event keeps every field editable and shows no lock', () => {
    render(<EventPlanningDrawer eventId={17} initialValues={{ ...savedPlanning, status: 'awaiting_safety_check' }} onClose={vi.fn()} />);
    expect(screen.queryByTestId('change-request-lock-notice')).toBeNull();
    expect(screen.getByLabelText('Expected Attendance')).toBeEnabled();
  });

  test('[CONFLICT] [SG2-66:AC6] the server refusing a direct edit shows its change request message and keeps the drawer open', async () => {
    const message = 'This event is Confirmed, so its details can no longer be edited directly. Ask for the change through a change request instead; only registration settings can still be edited here.';
    vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue({
      ok: false, kind: 'change_request_required', message, fields: ['expected_attendance'],
    });
    const onClose = vi.fn();
    render(<EventPlanningDrawer eventId={17} initialValues={savedPlanning} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    expect(await screen.findByTestId('server-error-notice')).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('expected crowd movement for the safety check (SG2-91)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); sessionStorage.clear(); });
  const saved = (crowd: string | null) => ({
    ok: true as const,
    event: { event_id: 17, status: 'awaiting_safety_check', expected_attendance: 100, proposed_date: null,
      venue_requirements: null, equipment_requirements: null, accessibility_needs: null, registration_needed: false,
      registration_capacity: null, registration_opens_at: null, registration_closes_at: null, planning_notes: null,
      expected_crowd_movement: crowd, arrangements_recheck_needed: false, outstanding_arrangements: [] },
    arrangements_recheck_needed: false, outstanding_arrangements: [],
  });

  test('[NORMAL] [SG2-91:AC3] the coordinator sees the recorded crowd movement and saves a change, trimmed', async () => {
    const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue(saved('Leave by the west exits'));
    const onSuccess = vi.fn();
    render(<EventPlanningDrawer eventId={17} accessToken="tok" onClose={vi.fn()} onSuccess={onSuccess}
      initialValues={{ expected_crowd_movement: 'Enter by the east doors', status: 'awaiting_safety_check' }} />);
    const field = screen.getByLabelText('Expected Crowd Movement');
    expect(field).toHaveValue('Enter by the east doors');
    fireEvent.change(field, { target: { value: '  Leave by the west exits  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(17, expect.objectContaining({ expected_crowd_movement: 'Leave by the west exits' }), 'tok');
  });

  test('[BOUNDARY] [SG2-91:AC3] expected crowd movement takes up to 5000 characters', () => {
    const base = { proposedDate: '', initialProposedDate: '', now: 0, expectedAttendance: '', registrationNeeded: false,
      registrationCapacity: '', registrationOpensAt: '', registrationClosesAt: '', venueRequirements: '',
      equipmentRequirements: '', accessibilityNeeds: '', planningNotes: '' };
    expect(validatePlanningForm({ ...base, expectedCrowdMovement: 'a'.repeat(5000) })).toEqual([]);
    expect(validatePlanningForm({ ...base, expectedCrowdMovement: 'a'.repeat(5001) }))
      .toEqual(['Expected crowd movement must be 5000 characters or fewer.']);
  });

  test('[FAILURE] [SG2-91:AC3] crowd movement over the limit is refused before saving', () => {
    const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning');
    render(<EventPlanningDrawer eventId={17} accessToken="tok" onClose={vi.fn()} initialValues={{ status: 'planning' }} />);
    expect(screen.getByLabelText('Expected Crowd Movement')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Expected Crowd Movement'), { target: { value: 'a'.repeat(5001) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    expect(screen.getByText('Expected crowd movement must be 5000 characters or fewer.')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  test('[BOUNDARY] [SG2-91:AC3] clearing the crowd movement saves it as not recorded', async () => {
    const update = vi.spyOn(eventRequestsApi, 'updateEventPlanning').mockResolvedValue(saved(null));
    render(<EventPlanningDrawer eventId={17} accessToken="tok" onClose={vi.fn()}
      initialValues={{ expected_crowd_movement: 'Enter by the east doors', status: 'planning' }} />);
    fireEvent.change(screen.getByLabelText('Expected Crowd Movement'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Planning Details' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(17, expect.objectContaining({ expected_crowd_movement: null }), 'tok'));
  });
});

afterAll(() => vi.unstubAllEnvs());
