import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import RegistrationPanel from './RegistrationPanel';
import type { RegistrationView } from '../api/registrations';

const OWNER_VIEW: RegistrationView = {
  event_id: 12, status: 'confirmed', registration_needed: true, registration_capacity: 3,
  registration_opens_at: '2030-06-01T01:00:00.000Z', registration_closes_at: '2030-06-10T01:00:00.000Z',
  waiting_list_response_hours: 24, waiting_list: [], window: 'open',
  registered_count: 2, places_remaining: 1, contact_details_visible: true,
  attendees: [
    { registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', registered_at: '2030-06-02T01:00:00.000Z',
      email: 'ana@attendee.test', phone: '+65 6000 0001', needs: 'Step-free access' },
    { registration_id: 4, name: 'Ben Attendee', organisation: null, registered_at: '2030-06-03T01:00:00.000Z', email: null, phone: null },
  ],
  venues: [{ venue_id: 7, name: 'Main hall', capacity: 2 }, { venue_id: 8, name: 'Lawn', capacity: null }],
  capacity_warnings: ['A capacity of 3 is more than Main hall holds (2).'],
  can_edit: true,
};

type Reply = Response | Promise<Response>;

/** Answers the registration read with `read`, and each change with the next of `changes`. */
function serve(read: () => Reply, ...changes: (() => Reply)[]) {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => (init?.method ? changes.shift()!() : read()));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const panel = () => within(screen.getByRole('region', { name: 'Registration' }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RegistrationPanel picture (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC1] [SG2-63:AC2] [SG2-63:AC4] [SG2-63:AC7] [SG2-60:AC4] the creating organiser sees the numbers, the warning and each attendee with contact details and needs', async () => {
    const fetch = serve(() => Response.json(OWNER_VIEW));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading registrations…');
    expect(await screen.findByText('Registration is open.')).toBeVisible();
    expect(panel().getByTestId('registration-count')).toHaveTextContent('2');
    expect(panel().getByTestId('registration-remaining')).toHaveTextContent('1');
    expect(panel().getByText('1 Jun 2030, 09:00 SGT')).toBeVisible();
    expect(panel().getByText('10 Jun 2030, 09:00 SGT')).toBeVisible();
    expect(within(panel().getAllByRole('list', { name: 'Capacity warnings' })[0]).getByText('A capacity of 3 is more than Main hall holds (2).')).toBeVisible();
    const attendees = within(panel().getByRole('list', { name: 'Registered attendees' })).getAllByRole('listitem');
    expect(attendees[0]).toHaveTextContent('Ana AttendeeGuests Ltdana@attendee.test+65 6000 0001Needs: Step-free accessRegistered 2 Jun 2030, 09:00 SGT');
    expect(within(attendees[0]).getByRole('link', { name: 'ana@attendee.test' })).toHaveAttribute('href', 'mailto:ana@attendee.test');
    expect(attendees[1]).toHaveTextContent('Ben AttendeeNo email on recordNo phone on record');
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/registrations', expect.objectContaining({ headers: { Authorization: 'Bearer token' } }));
  });

  test('[NORMAL] [SG2-63:AC3] [SG2-63:AC4] [SG2-63:AC8] a colleague sees names only, is told why, and cannot change anything', async () => {
    let ownerReply!: (response: Response) => void;
    const fetch = serve(() => Response.json({ ...OWNER_VIEW, contact_details_visible: false, can_edit: false, attendees: [
      { registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', registered_at: '2030-06-02T01:00:00.000Z' },
    ] }));
    fetch.mockImplementationOnce(async () => new Promise<Response>(resolve => { ownerReply = resolve; }));
    const view = render(<RegistrationPanel eventId={12} accessToken="owner-token" />);
    const signal = fetch.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    let colleagueReply!: (response: Response) => void;
    fetch.mockImplementationOnce(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })).mockImplementationOnce(async () => new Promise<Response>(resolve => { colleagueReply = resolve; }));
    view.rerender(<StrictMode><RegistrationPanel eventId={12} accessToken="token" /></StrictMode>);
    expect(signal?.aborted).toBe(true);
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(true);
    // StrictMode's first GET aborts on the same surviving Panel. Flush that
    // failure before the replayed GET succeeds, matching the browser race.
    await act(async () => {});
    await act(async () => colleagueReply(Response.json({ ...OWNER_VIEW, contact_details_visible: false, can_edit: false, attendees: [
      { registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', registered_at: '2030-06-02T01:00:00.000Z' },
    ] })));
    expect(await screen.findByText('Contact details are shown only to the organiser who created this event and its coordinator.')).toBeVisible();
    await act(async () => ownerReply(Response.json(OWNER_VIEW)));
    expect(panel().queryByText('ana@attendee.test')).toBeNull();
    expect(panel().getByText('Only the organiser who created this event can change its registration settings.')).toBeVisible();
    expect(panel().queryByRole('form', { name: 'Registration settings' })).toBeNull();
  });

  test('[FAILURE] [SG2-63:AC4] only an email-shaped address becomes a mailto link; anything else is shown as text', async () => {
    serve(() => Response.json({ ...OWNER_VIEW, attendees: [
      { ...OWNER_VIEW.attendees[0], email: 'javascript:alert(1)' },
      { ...OWNER_VIEW.attendees[1], registration_id: 5, email: 'not an email' },
    ] }));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    expect(await screen.findByText('javascript:alert(1)')).toBeVisible();
    expect(panel().getByText('not an email')).toBeVisible();
    expect(panel().queryAllByRole('link')).toHaveLength(0);
  });

  test('[BOUNDARY] [SG2-63:AC1] no capacity, no times and no registrations read plainly', async () => {
    serve(() => Response.json({ ...OWNER_VIEW, registration_capacity: null, places_remaining: null, registration_opens_at: null,
      registration_closes_at: null, registered_count: 0, attendees: [], capacity_warnings: [], window: 'not_confirmed', can_edit: false }));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    expect(await screen.findByText('Registration opens to attendees once the event is confirmed.')).toBeVisible();
    expect(panel().getByText('No capacity set')).toBeVisible();
    expect(panel().getAllByText('Not set')).toHaveLength(3);
    expect(panel().getByText('No one has registered yet.')).toBeVisible();
    expect(panel().queryByRole('list', { name: 'Capacity warnings' })).toBeNull();
  });

  test('[BOUNDARY] [SG2-63:AC5] an event that takes no registrations says so and shows nothing else', async () => {
    serve(() => Response.json({ ...OWNER_VIEW, registration_needed: false, window: 'not_required' }));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    expect(await screen.findByText('This event does not take registrations.')).toBeVisible();
    expect(panel().queryByText('Registered attendees')).toBeNull();
  });

  test.each([
    ['cancelled', 'This event was cancelled. Registration is closed.'],
    ['rejected', 'This event was rejected. Registration is unavailable.'],
    ['completed', 'This event is completed. Registration is closed.'],
  ])('[BOUNDARY] [SG2-63:AC1] a %s event shows its final registration state rather than promising confirmation', async (status, message) => {
    serve(() => Response.json({ ...OWNER_VIEW, status, window: 'not_confirmed', can_edit: false }));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    expect(await screen.findByText(message)).toBeVisible();
    expect(panel().queryByText('Registration opens to attendees once the event is confirmed.')).not.toBeInTheDocument();
    expect(panel().getByTestId('registration-count')).toHaveTextContent('2');
    expect(panel().queryByRole('form', { name: 'Registration settings' })).not.toBeInTheDocument();
  });

  test('[FAILURE] [SG2-63:AC3] someone with no part in the event sees no panel, and a failed read can be retried', async () => {
    serve(() => Response.json({ error: 'Event not found.' }, { status: 404 }));
    const { container } = render(<RegistrationPanel eventId={12} accessToken="token" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    cleanup();
    const replies = [() => Response.json({ error: 'Registrations are temporarily unavailable. Please try again later.' }, { status: 503 }),
      () => Response.json(OWNER_VIEW)];
    serve(() => replies.shift()!());
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Registrations are temporarily unavailable. Please try again later.');
    fireEvent.click(panel().getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Registration is open.')).toBeVisible();
  });


});

describe('RegistrationPanel settings (SG2-63)', () => {
  async function open(view: RegistrationView = OWNER_VIEW, ...changes: (() => Reply)[]) {
    const fetch = serve(() => Response.json(view), ...changes);
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    const form = within(await screen.findByRole('form', { name: 'Registration settings' }));
    return { fetch, form };
  }
  const sent = (fetch: ReturnType<typeof serve>) => JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body));

  test('[NORMAL] [SG2-63:AC5] [SG2-63:AC7] the organiser sees the warning as they type, saves only the capacity, and the picture updates', async () => {
    const { fetch, form } = await open(OWNER_VIEW, () => Response.json({ ...OWNER_VIEW, registration_capacity: 5, places_remaining: 3,
      capacity_warnings: ['A capacity of 5 is more than Main hall holds (2).'] }));
    expect(form.getByLabelText('Capacity')).toHaveValue(3);
    expect(form.getByLabelText('Opens (Singapore time)')).toHaveValue('2030-06-01T09:00');
    expect(form.getByLabelText('Closes (Singapore time)')).toHaveValue('2030-06-10T09:00');
    expect(form.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    expect(form.queryByRole('list', { name: 'Capacity warnings' })).toBeNull();
    fireEvent.change(form.getByLabelText('Capacity'), { target: { value: '5' } });
    expect(form.getByRole('list', { name: 'Capacity warnings' })).toHaveTextContent('A capacity of 5 is more than Main hall holds (2).');
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    expect(await form.findByText('Registration settings saved.')).toHaveAttribute('role', 'status');
    expect(sent(fetch)).toEqual({ registration_capacity: 5 });
    expect(fetch.mock.calls.at(-1)![0]).toBe('/api/event-requests/12/registration-settings');
    expect(panel().getByTestId('registration-remaining')).toHaveTextContent('3');
    expect(form.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  test('[BOUNDARY] [SG2-63:AC7] a capacity at or below every venue gives no warning while typing', async () => {
    const { form } = await open({ ...OWNER_VIEW, registration_capacity: 1, capacity_warnings: [] });
    fireEvent.change(form.getByLabelText('Capacity'), { target: { value: '2' } });
    expect(form.queryByRole('list', { name: 'Capacity warnings' })).toBeNull();
  });

  test('[NORMAL] [SG2-63:AC5] [SG2-63:AC6] new opening and closing times are sent in Singapore time, and before confirmation cleared settings as null', async () => {
    const planning = { ...OWNER_VIEW, status: 'planning', window: 'not_confirmed' as const };
    const cleared = { ...planning, registration_capacity: null, places_remaining: null, registration_opens_at: null,
      registration_closes_at: null, capacity_warnings: [] };
    const { fetch, form } = await open(planning, () => Response.json(planning), () => Response.json(cleared));
    fireEvent.change(form.getByLabelText('Opens (Singapore time)'), { target: { value: '2030-06-02T10:00' } });
    fireEvent.change(form.getByLabelText('Closes (Singapore time)'), { target: { value: '2030-06-15T18:30' } });
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    await form.findByText('Registration settings saved.');
    expect(sent(fetch)).toEqual({ registration_opens_at: '2030-06-02T02:00:00.000Z', registration_closes_at: '2030-06-15T10:30:00.000Z' });
    fireEvent.change(form.getByLabelText('Capacity'), { target: { value: '' } });
    fireEvent.change(form.getByLabelText('Opens (Singapore time)'), { target: { value: '' } });
    fireEvent.change(form.getByLabelText('Closes (Singapore time)'), { target: { value: '' } });
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(sent(fetch)).toEqual({ registration_capacity: null, registration_opens_at: null, registration_closes_at: null }));
    // The form then holds what was saved: nothing set.
    await waitFor(() => expect(form.getByRole('button', { name: 'Save settings' })).toBeDisabled());
    expect(form.getByLabelText('Capacity')).toHaveValue(null);
    expect(form.getByLabelText('Opens (Singapore time)')).toHaveValue('');
  });

  test('[FAILURE] [SG2-63:AC5] a capacity that is not a whole number of at least 1 or is below those registered, or a closing time before opening, is refused before sending', async () => {
    const { fetch, form } = await open({ ...OWNER_VIEW, registration_opens_at: null, registration_closes_at: null });
    for (const capacity of ['0', '2.5', '2147483648']) {
      fireEvent.change(form.getByLabelText('Capacity'), { target: { value: capacity } });
      fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
      expect(form.getByRole('alert')).toHaveTextContent('Capacity must be a whole number of at least 1.');
    }
    // Two are registered: one place is not enough, two is.
    fireEvent.change(form.getByLabelText('Capacity'), { target: { value: '1' } });
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    expect(form.getByRole('alert')).toHaveTextContent('2 people are already registered, so the capacity cannot be lower than 2.');
    fireEvent.change(form.getByLabelText('Capacity'), { target: { value: '4' } });
    fireEvent.change(form.getByLabelText('Opens (Singapore time)'), { target: { value: '2030-06-10T09:00' } });
    fireEvent.change(form.getByLabelText('Closes (Singapore time)'), { target: { value: '2030-06-10T09:00' } });
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    expect(form.getByRole('alert')).toHaveTextContent('Registration must close after it opens.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('[FAILURE] [SG2-63:AC10] once confirmed, clearing capacity or a time is refused before sending, pointing to closing early', async () => {
    const { fetch, form } = await open();
    for (const label of ['Capacity', 'Opens (Singapore time)', 'Closes (Singapore time)']) {
      const input = form.getByLabelText(label);
      const before = (input as HTMLInputElement).value;
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
      expect(form.getByRole('alert')).toHaveTextContent(
        'Capacity and opening and closing times cannot be cleared once the event is confirmed. Close registration early instead.');
      fireEvent.change(input, { target: { value: before } });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('[CONFLICT] [SG2-63:AC5] [SG2-63:AC6] rapid clicks send one request: a double Save, Save then Close now, or Close now then Save', async () => {
    let answer!: (response: Response) => void;
    let closed!: (response: Response) => void;
    const { fetch, form } = await open(OWNER_VIEW, () => new Promise<Response>((resolve) => { answer = resolve; }),
      () => new Promise<Response>((resolve) => { closed = resolve; }));
    fireEvent.change(form.getByLabelText('Capacity'), { target: { value: '5' } });
    const save = form.getByRole('button', { name: 'Save settings' });
    const close = form.getByRole('button', { name: 'Close registration now' });
    fireEvent.submit(save.closest('form')!);
    fireEvent.submit(save.closest('form')!);
    fireEvent.click(close);
    answer(Response.json({ ...OWNER_VIEW, registration_capacity: 5 }));
    await form.findByText('Registration settings saved.');
    expect(fetch.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
    // Close now first: a submit straight after it sends nothing more.
    fireEvent.change(form.getByLabelText('Capacity'), { target: { value: '6' } });
    fireEvent.click(form.getByRole('button', { name: 'Close registration now' }));
    fireEvent.submit(save.closest('form')!);
    closed(Response.json({ ...OWNER_VIEW, window: 'closed' }));
    await form.findByText('Registration is closed.');
    expect(fetch.mock.calls.filter(([, init]) => init?.method).map(([url]) => url)).toEqual([
      '/api/event-requests/12/registration-settings', '/api/event-requests/12/registration-settings/close',
    ]);
  });

  test('[CONFLICT] [SG2-63:AC5] the server\'s refusal is shown with each reason, and the typed values stay', async () => {
    const { form } = await open(OWNER_VIEW,
      () => Response.json({ error: 'Invalid registration settings', details: ['Registration must close before the event starts.'] }, { status: 400 }),
      () => Response.json({ error: 'The event has started, so its registration settings can no longer change.' }, { status: 409 }));
    fireEvent.change(form.getByLabelText('Closes (Singapore time)'), { target: { value: '2030-06-30T09:00' } });
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    const alert = await form.findByRole('alert');
    expect(within(alert).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Invalid registration settings', 'Registration must close before the event starts.',
    ]);
    expect(form.getByLabelText('Closes (Singapore time)')).toHaveValue('2030-06-30T09:00');
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(form.getByRole('alert')).toHaveTextContent('The event has started, so its registration settings can no longer change.'));
  });

  test('[NORMAL] [SG2-63:AC6] open registration is closed now, after which the organiser is told how to reopen it', async () => {
    let answer!: (response: Response) => void;
    const { fetch, form } = await open(OWNER_VIEW, () => new Promise<Response>((resolve) => { answer = resolve; }));
    expect(form.getByText('Set a later closing time to extend registration, or close it now.')).toBeVisible();
    fireEvent.click(form.getByRole('button', { name: 'Close registration now' }));
    expect(form.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(form.getByRole('button', { name: 'Close registration now' })).toBeDisabled();
    expect(form.getByLabelText('Capacity')).toBeDisabled();
    answer(Response.json({ ...OWNER_VIEW, window: 'closed', registration_closes_at: '2030-06-05T00:00:00.000Z' }));
    expect(await form.findByText('Registration is closed.')).toHaveAttribute('role', 'status');
    expect(fetch.mock.calls.at(-1)).toEqual(['/api/event-requests/12/registration-settings/close',
      { method: 'POST', headers: { Authorization: 'Bearer token' } }]);
    expect(panel().getByText('Registration has closed.')).toBeVisible();
    expect(form.getByText('Registration has closed. Set a later closing time and save to reopen it.')).toBeVisible();
    expect(form.queryByRole('button', { name: 'Close registration now' })).toBeNull();
  });

  test('[BOUNDARY] [SG2-63:AC6] registration not yet open can be neither closed early nor reopened', async () => {
    const { form } = await open({ ...OWNER_VIEW, window: 'not_yet_open' });
    expect(form.queryByRole('button', { name: 'Close registration now' })).toBeNull();
    expect(form.queryByText(/reopen it/)).toBeNull();
    expect(form.queryByText(/extend registration/)).toBeNull();
  });
});

describe('RegistrationPanel waiting list (SG2-61, SG2-62 AC6)', () => {
  const WAITING: RegistrationView = { ...OWNER_VIEW, places_remaining: 0, registered_count: 3, waiting_list_response_hours: 1, waiting_list: [
    { entry_id: 5, name: 'Cara Waiting', organisation: null, status: 'offered', joined_at: '2030-06-03T02:00:00.000Z',
      offer_expires_at: '2030-06-05T06:00:00.000Z', position: null },
    { entry_id: 6, name: 'Dev Waiting', organisation: 'Guests Ltd', status: 'waiting', joined_at: '2030-06-03T03:00:00.000Z',
      offer_expires_at: null, position: 1 },
  ] };

  test('[NORMAL] [SG2-61:AC7] [SG2-62:AC6] the organiser and coordinator see who is waiting in order, the place held for one, and the response window', async () => {
    serve(() => Response.json(WAITING));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    const list = within(await panel().findByRole('list', { name: 'Waiting list' }));
    const entries = list.getAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual([
      expect.stringContaining('Cara WaitingPlace offered, held until'),
      expect.stringContaining('Dev WaitingGuests LtdWaiting, number 1'),
    ]);
    expect(panel().getByTestId('waiting-count')).toHaveTextContent('2');
    expect(panel().getByText('1 hour')).toBeVisible();
  });

  test('[BOUNDARY] [SG2-61:AC7] nobody waiting is said plainly', async () => {
    serve(() => Response.json(OWNER_VIEW));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    expect(await panel().findByText('No one is on the waiting list.')).toBeVisible();
    expect(panel().getByText('24 hours')).toBeVisible();
  });

  test('[NORMAL] [SG2-62:AC6] the creating organiser sets how long an offered place is held, sending only that', async () => {
    const fetch = serve(() => Response.json(OWNER_VIEW), () => Response.json({ ...OWNER_VIEW, waiting_list_response_hours: 6 }));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    const form = within(await screen.findByRole('form', { name: 'Registration settings' }));
    expect(form.getByLabelText('Hold an offered place for (hours)')).toHaveValue(24);
    fireEvent.change(form.getByLabelText('Hold an offered place for (hours)'), { target: { value: '6' } });
    fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
    await form.findByText('Registration settings saved.');
    expect(JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))).toEqual({ waiting_list_response_hours: 6 });
  });

  test('[FAILURE] [SG2-62:AC6] a response window that is not whole hours from 1 to 168 is refused before sending', async () => {
    const fetch = serve(() => Response.json(OWNER_VIEW));
    render(<RegistrationPanel eventId={12} accessToken="token" />);
    const form = within(await screen.findByRole('form', { name: 'Registration settings' }));
    for (const hours of ['0', '169', '1.5', '']) {
      fireEvent.change(form.getByLabelText('Hold an offered place for (hours)'), { target: { value: hours } });
      fireEvent.click(form.getByRole('button', { name: 'Save settings' }));
      expect(form.getByRole('alert')).toHaveTextContent('The waiting-list response window must be a whole number of hours from 1 to 168.');
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

