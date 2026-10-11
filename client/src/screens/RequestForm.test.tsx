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
 *   Submitted-request action restrictions are tested against API data in
 *   EventDetail.test.tsx.
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
  vi.clearAllMocks();
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
  eventId: '12',
  accessToken: 'test-token',
  onSuccess: vi.fn(),
  onSaveDraft: vi.fn(),
};

/** Fill all mandatory fields so the submit button becomes enabled. */
function fillAllFields() {
  fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Forum 2026' } });
  fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: 'Partner briefing' } });
  fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '2026-10-12T10:00' } });
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
  test('[BOUNDARY] [SG2-30:AC2] submit button is disabled when the form is empty', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: /Submit request/i })).toBeDisabled();
  });

  test.each(['Event name', 'Purpose', 'Date', 'Expected attendance', 'Venue requirements', 'Description'])(
    '[BOUNDARY] [SG2-30:AC2] submit stays disabled when %s is the only blank required field', (label) => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.change(screen.getByLabelText(new RegExp(label, 'i')), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /Submit request/i })).toBeDisabled();
  });

  test('[NORMAL] [SG2-30:AC2] submit button becomes enabled when all required fields are filled', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    expect(screen.getByRole('button', { name: /Submit request/i })).not.toBeDisabled();
  });

  test('[BOUNDARY] [SG2-30:AC2] shows a count of empty required fields after first interaction', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    // Initially shows the default hint (no interaction yet).
    expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();
    // After touching a field and clearing it, the count appears.
    const nameField = screen.getByLabelText(/Event name/i);
    fireEvent.change(nameField, { target: { value: 'x' } });
    fireEvent.change(nameField, { target: { value: '' } });
    expect(screen.getByText('6 required fields still empty.')).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-30:AC2] inline error appears for a touched field left blank', () => {
    render(<RequestForm {...DEFAULT_PROPS} />);
    // Touch and clear the event name field.
    const nameField = screen.getByLabelText(/Event name/i);
    fireEvent.change(nameField, { target: { value: 'x' } });
    fireEvent.change(nameField, { target: { value: '' } });
    expect(screen.getByText('Event name is required')).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-30:AC2] shows inline errors for the description and venue fields when cleared', () => {
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
      vi.fn().mockImplementation(async () => draftResponse()),
    );
  });

  test('[NORMAL] [SG2-30:AC1] calls the submit endpoint with the correct method, URL, and token', async () => {
    const onSuccess = vi.fn();
    render(<RequestForm {...DEFAULT_PROPS} onSuccess={onSuccess} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(onSuccess).toHaveBeenCalledWith(12, 'Forum 2026');
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/12/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  test('[CONFLICT] [SG2-30:duplicate-submit] keeps save and submit disabled through persistence and submission without duplicate requests', async () => {
    let finishSave!: (response: Response) => void;
    let finishSubmit!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSave = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finishSubmit = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const onSuccess = vi.fn();
    render(<RequestForm {...DEFAULT_PROPS} onSuccess={onSuccess} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    const btn = screen.getByRole('button', { name: /Submitting…/i });
    expect(btn).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    fireEvent.click(btn);
    expect(fetchMock).toHaveBeenCalledOnce();
    finishSave(draftResponse());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(btn).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(onSuccess).not.toHaveBeenCalled();
    finishSubmit(new Response(null, { status: 204 }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('[NORMAL] [SG2-30:AC1] creates a filled request before submitting its new id', async () => {
    const onSuccess = vi.fn();
    render(<RequestForm onSuccess={onSuccess} onSaveDraft={vi.fn()} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(onSuccess).toHaveBeenCalledWith(12, 'Forum 2026');
    const calls = vi.mocked(fetch).mock.calls;
    expect(calls.map(([url]) => url)).toEqual(['/api/event-requests', '/api/event-requests/12/submit']);
    expect(JSON.parse(calls[0][1]!.body as string)).toMatchObject({ name: 'Forum 2026', expected_attendance: 180 });
  });
});

describe('draft and presentation callbacks', () => {
  test('[NORMAL] [SG2-28:AC4] fires the save-draft callback when provided', () => {
    const onSaveDraft = vi.fn();
    render(<RequestForm {...DEFAULT_PROPS} onSaveDraft={onSaveDraft} />);

    fireEvent.click(screen.getByRole('button', { name: /Save draft/i }));
    expect(onSaveDraft).toHaveBeenCalledOnce();
  });

  test('[NORMAL] [SG2-28:AC4] saves a real draft and shows the server confirmation when no callback is given', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse()));
    render(<RequestForm {...DEFAULT_PROPS} onSaveDraft={undefined} />);

    fireEvent.click(screen.getByRole('button', { name: /Save draft/i }));

    expect(await screen.findByText('Draft 12 saved — ready to submit.')).toBeInTheDocument();
  });
});

// ─── SG2-28: real "Save draft" behaviour ────────────────────────────────────

describe('Save draft (SG2-28, no onSaveDraft override)', () => {
  test('[NORMAL] [SG2-28:AC1] sends every filled field, trimmed, and omits the blank ones', async () => {
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
    // 09:00 Singapore time is 01:00 UTC.
    expect(body.proposed_date).toBe('2026-11-04T01:00:00.000Z');
    expect(body.expected_attendance).toBe(120);
    expect(body.venue_requirements).toBe('Stage');
    expect(body.description).toBe('Two keynotes');
    expect(body.equipment_requirements).toBe('Lectern');
    // Left blank, so never sent — the server stores null rather than ''.
    expect('accessibility_needs' in body).toBe(false);
    expect(body.registration_needed).toBe(false);
  });

  test('[NORMAL] [SG2-28:AC1] toggles the registration chip into the payload', async () => {
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

  test('[NORMAL] [SG2-28:AC2] records accessibility needs when provided', async () => {
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

  test('[FAILURE] [SG2-28:AC4] drops a non-numeric attendance rather than sending it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(draftResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/Expected attendance/i), { target: { value: 'many' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft 12 saved/);

    expect('expected_attendance' in sentDraftBody(fetchMock)).toBe(false);
  });

  test('[BOUNDARY] [SG2-28:AC4] an empty draft still saves and lists what submission still needs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse(['name', 'purpose', 'proposed_date'], 5)));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(
      await screen.findByText('Draft 5 saved. Still needed to submit: Event name, Purpose, Date.'),
    ).toBeInTheDocument();
  });

  test('[BOUNDARY] [SG2-28:AC4] shows an unrecognised outstanding field under its raw name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse(['surprise_field'], 6)));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByText('Draft 6 saved. Still needed to submit: surprise_field.'),
    ).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-28:duplicate-save] disables the save button while the request is in flight', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();

    release(draftResponse());
    expect(await screen.findByText(/Draft 12 saved/)).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-28:duplicate-save] a second click while saving does not save twice', async () => {
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

  test('[FAILURE] [SG2-28:AC4] shows the server validation details when the draft is rejected', async () => {
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

  test('[FAILURE] [SG2-28:draft-errors] shows a bare error when the failure carries no details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    render(<RequestForm onSaveDraft={undefined} onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach the server. Please try again.');
    expect(alert.querySelector('ul')).toBeNull();
  });

  test('[FAILURE] [SG2-25:AC3] signed-out submission cannot report success or issue requests', async () => {
    sessionStorage.clear();
    const onSubmit = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm onSubmit={onSubmit} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again to submit');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('[FAILURE] [SG2-25:AC3] signed-out save cannot accidentally create a duplicate of an existing draft', async () => {
    sessionStorage.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm eventId="12" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again to save');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('[NORMAL] [SG2-29:AC1] repeated saves update the created id and preserve clearing fields', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => draftResponse([], 42));
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm />);
    fillAllFields();
    fireEvent.change(screen.getByLabelText('Accessibility needs (optional)'), { target: { value: 'Hearing loop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft 42 saved/);
    fireEvent.change(screen.getByLabelText('Accessibility needs (optional)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/event-requests/42');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('accessibility_needs');
    expect(body).toHaveProperty('purpose', 'Partner briefing');
  });

  test('[FAILURE] [SG2-30:persist-before-submit] a failed save blocks submission and keeps entered values for retry', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid date' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm accessToken="test-token" onSuccess={onSuccess} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid date');
    expect(onSuccess).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Event name/i)).toHaveValue('Forum 2026');
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled();
  });
});

// ─── SG2-29: editing an existing draft ──────────────────────────────────────

describe('Editing an existing draft (SG2-29)', () => {
  const INITIAL_VALUES = {
    name: 'Partner Forum',
    purpose: 'Client briefing',
    description: 'Two keynotes',
    proposed_date: '2026-11-04T01:00:00.000Z',
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

  test('[NORMAL] [SG2-29:AC2] seeds every field from initialValues, including the numeric one', () => {
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

  test('[BOUNDARY] [SG2-29:AC2] a blank/absent initialValues field seeds as empty, not "null" or "undefined"', () => {
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

  test('[NORMAL] [SG2-29:AC1] "Save draft" calls PATCH on the existing id, not POST', async () => {
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

  test('[CONFLICT] [SG2-30:AC3] a failed update shows an error without losing the edited values', async () => {
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

  test('[NORMAL] [SG2-29:AC1] [SG2-30:AC1] submitting an edited draft persists the latest values before submission', async () => {
    const onSubmit = vi.fn();
    const fetchMock = vi.fn().mockImplementation(async () => updateResponse());
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

    fireEvent.change(screen.getByLabelText(/Event name/i), { target: { value: 'Updated forum' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/event-requests/7');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).name).toBe('Updated forum');
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/7/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token' },
    });
  });
});

// ─── SG2-30: draft form shows stored data only ──────────────────────────────

describe('stored draft values (SG2-30 walkthrough fixes)', () => {
  const STORED = {
    name: 'Planning workshop',
    purpose: 'Team planning',
    description: 'A planning workshop.',
    proposed_date: '2030-06-15T02:00:00.000Z',
    expected_attendance: 20,
    venue_requirements: 'A room with seating',
  };

  function renderStored(onSuccess = vi.fn()) {
    render(<RequestForm eventId="1" accessToken="test-token" initialValues={STORED} onSuccess={onSuccess} />);
  }

  function fitResponse() {
    return Response.json({
      event: { event_id: 1, name: 'Planning workshop', expected_attendance: 20, venue_requirements: null, accessibility_needs: null },
      venues: [
        { venue_id: 1, name: 'Regression Hall', capacity: 100, suitability: { suitable: true, issues: [] } },
        { venue_id: 2, name: 'Huddle Room', capacity: 8, suitability: { suitable: false, issues: [
          { kind: 'capacity', message: "Expected attendance of 20 is above this venue's capacity of 8." },
        ] } },
      ],
    });
  }

  test('[NORMAL] [SG2-29:AC2] [SG2-30:AC1] a stored ISO date shows in Singapore time and is submitted back unchanged when untouched', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(draftResponse([], 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderStored(onSuccess);

    const date = screen.getByLabelText(/Date/i);
    expect(date).toHaveAttribute('type', 'datetime-local');
    expect(date).toHaveValue('2030-06-15T10:00');
    expect(screen.getByText('Singapore time (SGT)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(1, 'Planning workshop'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/event-requests/1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).proposed_date).toBe('2030-06-15T02:00:00.000Z');
  });

  test('[BOUNDARY] [SG2-28:AC1] an early-morning Singapore time is saved as the previous UTC day', async () => {
    const fetchMock = vi.fn().mockResolvedValue(draftResponse([], 1));
    vi.stubGlobal('fetch', fetchMock);
    renderStored();

    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '2030-06-15T07:30' } });
    expect(screen.getByLabelText(/Date/i)).toHaveValue('2030-06-15T07:30');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await screen.findByText('Draft 1 saved — ready to submit.');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).proposed_date).toBe('2030-06-14T23:30:00.000Z');
  });

  test('[FAILURE] [SG2-30:AC2] clearing the stored date leaves it blank, flags it and blocks submission', () => {
    renderStored();

    fireEvent.change(screen.getByLabelText(/Date/i), { target: { value: '' } });

    expect(screen.getByLabelText(/Date/i)).toHaveValue('');
    expect(screen.getByText('Date is required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  });

  test('[NORMAL] [SG2-29:AC2] a reopened draft shows no requirement chips or canned suitability banner it never stored', () => {
    renderStored();

    for (const chip of ['Step-free access', 'Hearing loop', 'Stage + lectern', 'Catering', 'Livestream', 'Breakout room', 'Parking', 'Signage']) {
      expect(screen.queryByRole('button', { name: chip })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/expected attendance rules out/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Atrium Hall|Deepwater Auditorium/)).not.toBeInTheDocument();
    // The one remaining toggle reflects what was stored (nothing → off).
    expect(screen.getByRole('button', { name: 'Registration needed' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('[NORMAL] [SG2-47:AC1] venue fit is read from the suitability API for the saved draft on request, and re-read after each save', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/venues/suitability?event_id=1' ? fitResponse() : draftResponse([], 1));
    vi.stubGlobal('fetch', fetchMock);
    renderStored();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Check venue fit' }));

    expect(await screen.findByRole('heading', { name: '1 of 2 venues do not fit this request' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Huddle Room' })).toBeInTheDocument();
    expect(screen.getByText("Expected attendance of 20 is above this venue's capacity of 8.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check venue fit' })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/venues/suitability?event_id=1', {
      headers: { Authorization: 'Bearer test-token' }, cache: 'no-store',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft 1 saved — ready to submit.');
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/venues/suitability?event_id=1')).toHaveLength(2));
  });

  test('[BOUNDARY] [SG2-28:AC3] a new request offers venue fit only once it is saved, using the signed-in session', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === '/api/venues/suitability?event_id=12' ? fitResponse() : draftResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm />);
    expect(screen.queryByRole('button', { name: 'Check venue fit' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check venue fit' }));

    expect(await screen.findByRole('heading', { name: '1 of 2 venues do not fit this request' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/venues/suitability?event_id=12', {
      headers: { Authorization: 'Bearer test-token' }, cache: 'no-store',
    });
  });

  test('[FAILURE] [SG2-25:AC3] a signed-out venue fit check asks to sign in without calling the API', async () => {
    sessionStorage.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm eventId="12" />);

    fireEvent.click(screen.getByRole('button', { name: 'Check venue fit' }));

    expect(await screen.findByText('Your session has expired. Sign in again.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Reconciling SG2-28 + SG2-30: save then submit in one sitting ───────────

describe('save then submit', () => {
  test('[NORMAL] [SG2-28:AC3] [SG2-30:AC1] a real "Submit" after a real "Save draft" targets the id the draft call returned', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => draftResponse([], 42))
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

  test('[FAILURE] [SG2-30:submission-retry] retrying a failed submission updates the already-created draft', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => draftResponse([], 42))
      .mockImplementationOnce(async () => new Response(null, { status: 503 }))
      .mockImplementationOnce(async () => draftResponse([], 42))
      .mockImplementationOnce(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<RequestForm accessToken="test-token" onSuccess={onSuccess} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
    expect(onSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/event-requests', '/api/event-requests/42/submit',
      '/api/event-requests/42', '/api/event-requests/42/submit',
    ]);
  });

  test('[NORMAL] [SG2-29:AC1] [SG2-30:AC1] an existing draft keeps its requested id throughout save and submit', async () => {
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => draftResponse([], 42))
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
  test('[FAILURE] [SG2-30:AC2] shows a 400 banner listing the missing fields returned by the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(async () => draftResponse()).mockResolvedValue(
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

  test('[FAILURE] [SG2-30:AC2] preserves an unknown missing-field name from the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(async () => draftResponse()).mockResolvedValue(
        new Response(JSON.stringify({ missing: ['custom_requirement'] }), { status: 400 }),
      ),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(await screen.findByText(/custom_requirement/)).toBeInTheDocument();
  });

  test('[CONFLICT] [SG2-30:submitted-state] shows a 409 conflict banner when the request is already submitted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(async () => draftResponse()).mockResolvedValue(new Response(null, { status: 409 })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/already been submitted/i),
    ).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-30:submission-errors] shows a 503 unavailable banner when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(async () => draftResponse()).mockResolvedValue(new Response(null, { status: 503 })),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Could not reach the server/i),
    ).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-30:submission-errors] shows an unavailable banner when fetch throws (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(async () => draftResponse()).mockRejectedValue(new Error('network down')),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(
      await screen.findByText(/Could not reach the server/i),
    ).toBeInTheDocument();
  });

  test('[FAILURE] [SG2-30:submission-errors] shows the server-provided message for an unexpected error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementationOnce(async () => draftResponse()).mockResolvedValue(
        new Response(JSON.stringify({ error: 'Submission window is closed' }), { status: 500 }),
      ),
    );
    render(<RequestForm {...DEFAULT_PROPS} />);
    fillAllFields();
    fireEvent.click(screen.getByRole('button', { name: /Submit request/i }));

    expect(await screen.findByText('Submission window is closed')).toBeInTheDocument();
  });
});

// ─── Event detail entry requirements ────────────────────────────────────────

describe('EventDetail requires an authenticated selected request', () => {
  test('[FAILURE] [SG2-26:AC1] a caller-supplied draft status cannot substitute for a selected request', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<EventDetail role="Event Organiser" accessToken="test-token" onNavigate={vi.fn()} eventStatus="draft" />);
    expect(screen.queryByRole('button', { name: 'Edit request' })).not.toBeInTheDocument();
    expect(screen.getByText(/Select an event from your organisation/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test('[FAILURE] [SG2-26:AC2] coordinator cannot view organiser request details', () => {
    render(<EventDetail role="Event Coordinator" onNavigate={vi.fn()} eventStatus="submitted" />);
    expect(screen.getByRole('alert')).toHaveTextContent('available only to Event Organisers');
  });
});
