import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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

function draftResponse(missing: string[] = [], eventId = 12) {
  return new Response(
    JSON.stringify({ request: { event_id: eventId, status: 'draft' }, missingForSubmission: missing }),
    { status: 201, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Returns the JSON body of the single POST the component made. */
function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

test('sends every filled field, trimmed, and omits the blank ones', async () => {
  const fetchMock = vi.fn().mockResolvedValue(draftResponse());
  vi.stubGlobal('fetch', fetchMock);
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('Event name'), { target: { value: '  Partner Forum  ' } });
  fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Client briefing' } });
  fireEvent.change(screen.getByLabelText('Date & time'), { target: { value: '2026-11-04T09:00' } });
  fireEvent.change(screen.getByLabelText('Expected attendance'), { target: { value: '120' } });
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Two keynotes' } });
  fireEvent.change(screen.getByLabelText('Equipment requirements'), { target: { value: 'Lectern' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

  expect(await screen.findByText('Draft 12 saved — ready to submit.')).toBeInTheDocument();

  const body = sentBody(fetchMock);
  expect(body.name).toBe('Partner Forum');
  expect(body.purpose).toBe('Client briefing');
  expect(body.proposed_date).toBe('2026-11-04T09:00');
  expect(body.expected_attendance).toBe(120);
  expect(body.description).toBe('Two keynotes');
  expect(body.equipment_requirements).toBe('Lectern');
  // Left blank, so never sent — the server stores null rather than ''.
  expect('accessibility_needs' in body).toBe(false);
  expect(body.registration_needed).toBe(false);
});

test('sends the selected venue requirement chips as one field', async () => {
  const fetchMock = vi.fn().mockResolvedValue(draftResponse());
  vi.stubGlobal('fetch', fetchMock);
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Catering' })); // preselected -> off
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft 12 saved/);

  expect(sentBody(fetchMock).venue_requirements).toBe('Step-free access, Hearing loop, Stage + lectern');
});

test('omits venue requirements entirely when every chip is cleared', async () => {
  const fetchMock = vi.fn().mockResolvedValue(draftResponse());
  vi.stubGlobal('fetch', fetchMock);
  render(<RequestForm onSubmit={vi.fn()} />);

  for (const chip of ['Step-free access', 'Hearing loop', 'Stage + lectern', 'Catering']) {
    fireEvent.click(screen.getByRole('button', { name: chip }));
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft 12 saved/);

  expect('venue_requirements' in sentBody(fetchMock)).toBe(false);
});

test('toggles the registration chip into the payload', async () => {
  const fetchMock = vi.fn().mockResolvedValue(draftResponse());
  vi.stubGlobal('fetch', fetchMock);
  render(<RequestForm onSubmit={vi.fn()} />);

  const chip = screen.getByRole('button', { name: 'Registration needed' });
  expect(chip).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(chip);
  expect(chip).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft 12 saved/);
  expect(sentBody(fetchMock).registration_needed).toBe(true);
});

test('records accessibility needs when provided', async () => {
  const fetchMock = vi.fn().mockResolvedValue(draftResponse());
  vi.stubGlobal('fetch', fetchMock);
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('Accessibility needs (optional)'), {
    target: { value: 'Hearing loop' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft 12 saved/);

  expect(sentBody(fetchMock).accessibility_needs).toBe('Hearing loop');
});

test('drops a non-numeric attendance rather than sending it', async () => {
  const fetchMock = vi.fn().mockResolvedValue(draftResponse());
  vi.stubGlobal('fetch', fetchMock);
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.change(screen.getByLabelText('Expected attendance'), { target: { value: 'many' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft 12 saved/);

  expect('expected_attendance' in sentBody(fetchMock)).toBe(false);
});

test('an empty draft still saves and lists what submission still needs', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse(['name', 'purpose', 'proposed_date'], 5)));
  render(<RequestForm onSubmit={vi.fn()} />);

  expect(screen.getByText('You can save and finish this later.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

  expect(
    await screen.findByText('Draft 5 saved. Still needed to submit: Event name, Purpose, Date & time.'),
  ).toBeInTheDocument();
});

test('shows an unrecognised outstanding field under its raw name', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(draftResponse(['surprise_field'], 6)));
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  expect(
    await screen.findByText('Draft 6 saved. Still needed to submit: surprise_field.'),
  ).toBeInTheDocument();
});

test('disables the save button while the request is in flight', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  const saving = await screen.findByRole('button', { name: 'Saving…' });
  expect(saving).toBeDisabled();

  release(draftResponse());
  expect(await screen.findByText(/Draft 12 saved/)).toBeInTheDocument();
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
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Invalid event request details');
  expect(alert).toHaveTextContent('name must be text.');
});

test('shows a bare error when the failure carries no details', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
  render(<RequestForm onSubmit={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Could not reach the server. Please try again.');
  expect(alert.querySelector('ul')).toBeNull();
});

test('hides the suitability notice when conflicts are not flagged', () => {
  render(<RequestForm onSubmit={vi.fn()} showConflicts={false} />);
  expect(screen.queryByText(/180 expected attendance rules out/)).not.toBeInTheDocument();
});

test('submitting hands off to the caller', () => {
  const onSubmit = vi.fn();
  render(<RequestForm onSubmit={onSubmit} />);
  fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
  expect(onSubmit).toHaveBeenCalledOnce();
});
