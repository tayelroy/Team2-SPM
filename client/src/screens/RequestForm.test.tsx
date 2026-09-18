/**
 * RequestForm — Vitest / React Testing Library tests.
 *
 * SG2-28 (create/save a draft):
 *   "Save draft" posts to `POST /api/event-requests` and shows the server's
 *   outstanding-field list back to the user without blocking the save.
 * SG2-30 (submit an event request), Phase 4:
 *   AC1: Successful submission calls `PATCH /api/event-requests/:id/submit`
 *        with a Bearer token and fires `onSuccess`.
 *   AC2: Submit button is disabled while mandatory fields are empty; inline
 *        errors appear after a failed submit attempt; server errors
 *        (400/409/503) surface as a visible alert banner.
 *   AC3: EventDetail locks the organiser action panel when `eventStatus === 'submitted'`.
 *
 * A same-session "Submit request" after a real "Save draft" targets the
 * event id the draft call just returned — see "save then submit" below.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import EventDetail from './EventDetail';
import RequestForm from './RequestForm';

const SESSION_KEY = 'connectsphere.session';

beforeEach(() => {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: 'test-token',
      user: { userId: 'u1', email: 'organiser@example.com', role: 'event_organiser' },
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_PROPS = {
  eventId: 'evt-abc-123',
  accessToken: 'test-token',
  onSuccess: vi.fn(),
  onSaveDraft: vi.fn(),
};

/** Fill all mandatory fields so the submit button becomes enabled. */
function fillAllFields() {
  fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Forum 2026' } });
  fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: 'Partner briefing' } });
  fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '12 Oct 2026' } });
  fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: '180' } });
  fireEvent.change(screen.getByLabelText(/Venue requirements/i), { target: { value: 'Stage + loop' } });
  fireEvent.change(screen.getByLabelText(/Description/i), {
    target: { value: 'A half-day forum with keynotes and a panel.' },
  });
}

function draftResponse(missing: string[] = [], eventId = 12) {
  return new Response(
    JSON.stringify({ request: { event_id: eventId, status: 'draft' }, missingForSubmission: missing }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Returns the JSON body of the single POST the component made. */
function sentDraftBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.find(([url]) => url === '/api/event-requests');
  return JSON.parse(call![1].body);
}

// ─── AC2: Submit button disabled state ──────────────────────────────────────

describe('AC2 — submit button disabled until all fields are filled', () => {
  test('submit button is disabled when the form is empty', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: /Submit request/i })).toBeDisabled();
  });

  test('submit button is disabled when only some fields are filled', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Forum' } });
    expect(screen.getByRole('button', { name: /Submit request/i })).toBeDisabled();
  });

  test('submit button becomes enabled when all required fields are filled', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    expect(screen.getByRole('button', { name: /Submit request/i })).not.toBeDisabled();
  });

  test('shows a count of empty required fields after first interaction', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    // Initially shows the default hint (no interaction yet).
    expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();
    // After touching a field and clearing it, the count appears.
    const nameField = screen.getByLabelText(/Event name/i);
    fireEvent.change(nameField, { target: { value: 'x' } });
    fireEvent.change(nameField, { target: { value: '' } });
    expect(screen.getByText(/required field/i)).toBeInTheDocument();
  });

  test('inline error appears for a touched field left blank', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    // Touch and clear the event name field.
    const nameField = screen.getByLabelText(/Event name/i);
    fireEvent.change(nameField, { target: { value: 'x' } });
    fireEvent.change(nameField, { target: { value: '' } });
    expect(screen.getByText('Event name is required')).toBeInTheDocument();
  });

  test('shows inline errors for the description and venue fields when cleared', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);

    const description = screen.getByLabelText(/Description/i);
    fireEvent.change(description, { target: { value: 'details' } });
    fireEvent.change(description, { target: { value: '' } });
    expect(screen.getByText('Description is required')).toBeInTheDocument();

    const venue = screen.getByLabelText(/Venue requirements/i);
    fireEvent.change(venue, { target: { value: 'loop' } });
    fireEvent.change(venue, { target: { value: '' } });
    expect(screen.getByText('Venue requirements is required')).toBeInTheDocument();
  });
});

// ─── AC1: Successful submission ──────────────────────────────────────────────

describe('AC1 — successful submission', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    );
  });

  test('calls the submit endpoint with the correct method, URL, and token', async () => {
    const onSuccess = vi.fn();
    render(<RequestForm {...DEFAULT_PROPS} onSuccess={onSuccess} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/evt-abc-123/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  test('shows a loading label while the request is in flight', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((res) => { resolve = res; })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(screen.getByRole('button', { name: /Submitting…/i })).toBeInTheDocument();
    resolve(new Response(null, { status: 200 }));
  });

  test('button is disabled during submission to prevent double-click', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((res) => { resolve = res; })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    const btn = screen.getByRole('button', { name: /Submitting…/i });
    expect(btn).toBeDisabled();
    resolve(new Response(null, { status: 200 }));
  });

  test('submits immediately in mockup mode when no event id is provided or created', async () => {
    const onSuccess = vi.fn();
    render(<RequestForm onSuccess={onSuccess} onSaveDraft={vi.fn()} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });
});

describe('draft and presentation callbacks', () => {
  test('fires the save-draft callback when provided', () => {
    const onSaveDraft = vi.fn();
    render(<RequestForm {...DEFAULT_PROPS} onSaveDraft={onSaveDraft} />);

    fireEvent.click(screen.getByRole('button', { name: /Save draft/i }));
    expect(onSaveDraft).toHaveBeenCalledOnce();
  });

  test('saves a real draft and shows the server confirmation when no callback is given', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse()));
    render(<RequestForm {...DEFAULT_PROPS} onSaveDraft={undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /Save draft/i }));

    expect(await screen.findByText('Draft 12 saved — ready to submit.')).toBeInTheDocument();
  });

  test('hides the suitability warning when conflicts are disabled', () => {
    render(<RequestForm {...DEFAULT_PROPS} showConflicts={false} />);

    expect(screen.queryByText(/180 expected attendance rules out/i)).not.toBeInTheDocument();
  });

  test('toggles requirement chips on and off', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    const chip = screen.getByRole('button', { name: 'Hearing loop' });

    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
  });
});

// ─── SG2-28: real "Save draft" behaviour ────────────────────────────────────

describe('Save draft (SG2-28, no onSaveDraft override)', () => {
  test('sends every filled field, trimmed, and omits the blank ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(draftResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: '  Partner Forum  ' } });
    fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: 'Client briefing' } });
    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '2026-11-04T09:00' } });
    fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/Venue requirements/i), { target: { value: '  Stage  ' } });
    fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Two keynotes' } });
    fireEvent.change(screen.getByLabelText('Equipment requirements'), { target: { value: 'Lectern' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Draft 12 saved — ready to submit.')).toBeInTheDocument();

    const body = sentDraftBody(fetchMock);
    expect(body.name).toBe('Partner Forum');
    expect(body.purpose).toBe('Client briefing');
    expect(body.proposed_date).toBe('2026-11-04T09:00');
    expect(body.expected_attendance).toBe(120);
    expect(body.venue_requirements).toBe('Stage');
    expect(body.description).toBe('Two keynotes');
    expect(body.equipment_requirements).toBe('Lectern');
    // Left blank, so never sent — the server stores null rather than ''.
    expect('accessibility_needs' in body).toBe(false);
    expect(body.registration_needed).toBe(false);
  });

  test('toggles the registration chip into the payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(draftResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    const chip = screen.getByRole('button', { name: 'Registration needed' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft 12 saved/);
    expect(sentDraftBody(fetchMock).registration_needed).toBe(true);
  });

  test('records accessibility needs when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(draftResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Accessibility needs (optional)'), {
      target: { value: 'Hearing loop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft 12 saved/);

    expect(sentDraftBody(fetchMock).accessibility_needs).toBe('Hearing loop');
  });

  test('drops a non-numeric attendance rather than sending it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(draftResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: 'many' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft 12 saved/);

    expect('expected_attendance' in sentDraftBody(fetchMock)).toBe(false);
  });

  test('an empty draft still saves and lists what submission still needs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse(['name', 'purpose', 'proposed_date'], 5)));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(
      await screen.findByText('Draft 5 saved. Still needed to submit: Event name, Purpose, Date.'),
    ).toBeInTheDocument();
  });

  test('shows an unrecognised outstanding field under its raw name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse(['surprise_field'], 6)));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByText('Draft 6 saved. Still needed to submit: surprise_field.'),
    ).toBeInTheDocument();
  });

  test('disables the save button while the request is in flight', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();

    release(draftResponse());
    expect(await screen.findByText(/Draft 12 saved/)).toBeInTheDocument();
  });

  test('a second click while saving does not save twice', async () => {
    let release!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release(draftResponse());
    await screen.findByText(/Draft 12 saved/);
  });

  test('shows the server validation details when the draft is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'Invalid event request details', details: ['name must be text.'] }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Invalid event request details');
    expect(alert).toHaveTextContent('name must be text.');
  });

  test('shows a bare error when the failure carries no details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server. Please try again.');
    expect(alert.querySelector('ul')).toBeNull();
  });

  test('submitting hands off to the caller in mockup mode', () => {
    const onSubmit = vi.fn();
    render(<RequestForm onSaveDraft={undefined} onSubmit={onSubmit} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

// ─── SG2-29: editing an existing draft ──────────────────────────────────────

describe('Editing an existing draft (SG2-29)', () => {
  const INITIAL_VALUES = {
    name: 'Partner Forum',
    purpose: 'Client briefing',
    description: 'Two keynotes',
    proposed_date: '2026-11-04T09:00',
    expected_attendance: 120,
    venue_requirements: 'Stage',
    accessibility_needs: 'Hearing loop',
    equipment_requirements: 'Lectern',
    registration_needed: true,
  };

  function updateResponse(missing: string[] = []) {
    return new Response(
      JSON.stringify({ request: { event_id: 7, status: 'draft', ...INITIAL_VALUES }, missingForSubmission: missing }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  test('seeds every field from initialValues, including the numeric one', () => {
    render(
      <RequestForm
        eventId="7"
        accessToken="test-token"
        initialValues={INITIAL_VALUES}
        onSaveDraft={undefined}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Event name/i)).toHaveValue('Partner Forum');
    expect(screen.getByLabelText(/Purpose/i)).toHaveValue('Client briefing');
    expect(screen.getByLabelText(/Description/i)).toHaveValue('Two keynotes');
    expect(screen.getByLabelText(/Date/i)).toHaveValue('2026-11-04T09:00');
    expect(screen.getByLabelText(/Expected attendance/i)).toHaveValue('120');
    expect(screen.getByLabelText(/Venue requirements/i)).toHaveValue('Stage');
    expect(screen.getByLabelText('Accessibility needs (optional)')).toHaveValue('Hearing loop');
    expect(screen.getByLabelText('Equipment requirements')).toHaveValue('Lectern');
    expect(screen.getByRole('button', { name: 'Registration needed' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a blank/absent initialValues field seeds as empty, not "null" or "undefined"', () => {
    render(
      <RequestForm
        eventId="7"
        accessToken="test-token"
        initialValues={{}}
        onSaveDraft={undefined}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Event name/i)).toHaveValue('');
    expect(screen.getByLabelText(/Expected attendance/i)).toHaveValue('');
  });

  test('"Save draft" calls PATCH on the existing id, not POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(updateResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RequestForm
        eventId="7"
        accessToken="test-token"
        initialValues={INITIAL_VALUES}
        onSaveDraft={undefined}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Renamed Forum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByText('Draft 7 saved — ready to submit.')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event-requests/7');
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body).name).toBe('Renamed Forum');
  });

  test('a failed update shows an error without losing the edited values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Only a draft event request can be edited.' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(
      <RequestForm
        eventId="7"
        accessToken="test-token"
        initialValues={INITIAL_VALUES}
        onSaveDraft={undefined}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only a draft request can be edited.');
    expect(screen.getByLabelText(/Event name/i)).toHaveValue('Partner Forum');
  });

  test('submitting an edited draft calls the real submit endpoint, not the mockup hand-off', async () => {
    const onSubmit = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <RequestForm
        eventId="7"
        accessToken="test-token"
        initialValues={INITIAL_VALUES}
        onSaveDraft={undefined}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/7/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });
  });
});

// ─── Reconciling SG2-28 + SG2-30: save then submit in one sitting ───────────

describe('save then submit', () => {
  test('a real "Submit" after a real "Save draft" targets the id the draft call returned', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => draftResponse([], 42))
      .mockImplementationOnce(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<RequestForm accessToken="test-token" onSuccess={onSuccess} onSaveDraft={undefined} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft 42 saved/);

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenLastCalledWith('/api/event-requests/42/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  test('an explicit eventId prop still wins over a locally-created one', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => draftResponse([], 42))
      .mockImplementationOnce(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <RequestForm
        eventId="existing-draft"
        accessToken="test-token"
        onSuccess={onSuccess}
        onSaveDraft={undefined}
      />,
    );
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft 42 saved/);

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenLastCalledWith('/api/event-requests/existing-draft/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });
  });
});

// ─── AC2: Server error banners ───────────────────────────────────────────────

describe('AC2 — server error banners', () => {
  test('shows a 400 banner listing the missing fields returned by the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ missing: ['name', 'description'] }),
          { status: 400 },
        ),
      ),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Event name.*Description/i),
    ).toBeInTheDocument();
  });

  test('preserves an unknown missing-field name from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ missing: ['custom_requirement'] }), { status: 400 }),
      ),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(await screen.findByText(/custom_requirement/)).toBeInTheDocument();
  });

  test('shows a 409 conflict banner when the request is already submitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 409 })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/already been submitted/i),
    ).toBeInTheDocument();
  });

  test('shows a 503 unavailable banner when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Could not reach the server/i),
    ).toBeInTheDocument();
  });

  test('shows an unavailable banner when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Could not reach the server/i),
    ).toBeInTheDocument();
  });

  test('shows the server-provided message for an unexpected error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Submission window is closed' }), { status: 500 }),
      ),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(await screen.findByText('Submission window is closed')).toBeInTheDocument();
  });
});

// ─── AC3: EventDetail — submitted immutability ───────────────────────────────

describe('AC3 — EventDetail locks organiser actions when submitted', () => {
  const navigate = vi.fn();

  test('shows action buttons normally for an organiser when status is draft', () => {
    render(
      <EventDetail role="Event Organiser" onNavigate={navigate} eventStatus="draft" />,
    );
    expect(screen.getByRole('button', { name: 'Edit request' })).toBeInTheDocument();
  });

  test('replaces action buttons with a locked notice when status is submitted', () => {
    render(
      <EventDetail role="Event Organiser" onNavigate={navigate} eventStatus="submitted" />,
    );
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: /Editing disabled/i })).toBeInTheDocument();
    expect(screen.getByText(/has been submitted and is now with your coordinator/i)).toBeInTheDocument();
  });

  test('coordinator sees action buttons regardless of submitted status', () => {
    render(
      <EventDetail role="Event Coordinator" onNavigate={navigate} eventStatus="submitted" />,
    );
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeInTheDocument();
  });

  test('locking notice is case-insensitive to the status string', () => {
    render(
      <EventDetail role="Event Organiser" onNavigate={navigate} eventStatus="Submitted" />,
    );
    expect(screen.getByRole('status', { name: /Editing disabled/i })).toBeInTheDocument();
  });
});
