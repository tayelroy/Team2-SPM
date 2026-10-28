import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import FindEvents, { registrationProblems } from './FindEvents';
import { fetchProfile, type ProfileOutcome } from '../api/profile';

vi.mock('../api/profile', () => ({ fetchProfile: vi.fn() }));
const profile = vi.mocked(fetchProfile);

const open = {
  event_id: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture on the harbour.', proposed_date: '2030-07-20T11:00:00.000Z',
  registration_opens_at: '2020-10-01T00:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: false,
};
const upcoming = { ...open, event_id: 592, name: 'Bayfront Workshop', registration_opens_at: '2030-06-01T00:00:00.000Z' };
const held = { registration_id: 7, event_id: 591, registered_at: '2026-10-23T01:00:00.000Z', contact_phone: '91234567', needs: null };
const withPhone = (phone: string | null): ProfileOutcome =>
  ({ ok: true, profile: { user_id: 'u', name: 'Ana', organisation: null, phone, communication_preferences: [] } });

type Route = (init?: RequestInit) => Response;
/** Each call gets a fresh Response; POST bodies are kept for inspection. */
function serve(routes: Record<string, Route>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes[url];
    if (!route) throw new Error(`Unexpected ${url}`);
    return route(init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const posts = (fetch: ReturnType<typeof serve>) => fetch.mock.calls
  .filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(String(init!.body)));

beforeEach(() => profile.mockResolvedValue(withPhone('+65 9123 4567')));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  profile.mockReset();
});

async function openDetail(event: typeof open, extra: Record<string, Route> = {}) {
  const fetch = serve({
    '/api/registrable-events': () => Response.json({ events: [event] }),
    [`/api/registrable-events/${event.event_id}`]: () => Response.json({ event }),
    ...extra,
  });
  render(<FindEvents accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: event.name })).getByRole('button', { name: 'View details' }));
  await screen.findByRole('region', { name: 'Registration' });
  return fetch;
}
const registration = () => screen.getByRole('region', { name: 'Registration' });
const phoneField = () => within(registration()).getByLabelText('Contact phone');
const needsField = () => within(registration()).getByLabelText('Accessibility or dietary needs (optional)');

test('[NORMAL] [SG2-60:AC1] [SG2-60:AC4] an attendee registers with their profile phone and needs, and is shown the place held with the event information', async () => {
  let registered = false;
  const fetch = await openDetail(open, {
    '/api/registrable-events/591/registrations': () => { registered = true; return Response.json({ registration: held }, { status: 201 }); },
    '/api/registrable-events': () => Response.json({ events: [{ ...open, registered }] }),
  });
  expect(await within(registration()).findByDisplayValue('+65 9123 4567')).toBe(phoneField());
  fireEvent.change(needsField(), { target: { value: 'Step-free access' } });
  expect(registration()).toHaveTextContent('16/500 characters');
  fireEvent.click(within(registration()).getByRole('button', { name: 'Register' }));

  const status = await within(registration()).findByRole('status');
  expect(status).toHaveTextContent('You are registered. Your place is held.');
  expect(status).toHaveTextContent('When20 Jul 2030, 7:00 pm');
  expect(status).toHaveTextContent('WhereRegression Hall');
  expect(status).toHaveTextContent('A confirmation is in your notifications.');
  expect(within(registration()).queryByRole('button', { name: 'Register' })).toBeNull();
  expect(posts(fetch)).toEqual([{ contact_phone: '+65 9123 4567', needs: 'Step-free access' }]);

  // Back on a fresh list, the event shows the place is held.
  fireEvent.click(screen.getByRole('button', { name: 'Back to events' }));
  expect(await within(await screen.findByRole('article', { name: 'Harbour Lecture' })).findByText('Registered')).toBeVisible();
});

test('[CONFLICT] [SG2-60:AC2] an event the attendee already registered for shows the place instead of the form', async () => {
  const fetch = await openDetail({ ...open, registered: true, proposed_date: null as unknown as string, venues: [] });
  const status = within(registration()).getByRole('status');
  expect(status).toHaveTextContent('You are already registered for this event.');
  expect(status).toHaveTextContent('WhenTo be announcedWhereTo be announced');
  expect(within(registration()).queryByRole('button', { name: 'Register' })).toBeNull();
  expect(profile).not.toHaveBeenCalled();
  expect(posts(fetch)).toEqual([]);
});

test('[CONFLICT] [SG2-60:AC2] a registration the server finds is a duplicate shows the place already held', async () => {
  await openDetail(open, { '/api/registrable-events/591/registrations': () =>
    Response.json({ error: 'You are already registered for this event.', reason: 'duplicate' }, { status: 409 }) });
  fireEvent.click(within(registration()).getByRole('button', { name: 'Register' }));
  expect(await within(registration()).findByRole('status')).toHaveTextContent('You are already registered for this event.');
});

test('[FAILURE] [SG2-60:AC3] before registration opens the attendee is told when, and there is no form', async () => {
  await openDetail(upcoming);
  expect(registration()).toHaveTextContent('Registration opens 1 Jun 2030, 8:00 am. Come back then to register.');
  expect(within(registration()).queryByRole('button', { name: 'Register' })).toBeNull();
  expect(profile).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-60:AC3] [SG2-60:AC1] a closed, full, not yet open or vanished event is refused with the reason, and the form goes', async () => {
  for (const [status, body, shown] of [
    [409, { error: 'Registration for this event has closed.', reason: 'closed' }, 'Registration for this event has closed.'],
    [409, { error: 'This event is full.', reason: 'full' }, 'This event is full.'],
    [409, { error: 'Registration opens 01 Jun 2030 08:00 SGT.', reason: 'not_open' }, 'Registration opens 01 Jun 2030 08:00 SGT.'],
    [404, { error: 'This event is not open for registration.' }, 'This event is no longer open for registration.'],
  ] as const) {
    await openDetail(open, { '/api/registrable-events/591/registrations': () => Response.json(body, { status }) });
    fireEvent.click(within(registration()).getByRole('button', { name: 'Register' }));
    expect(await within(registration()).findByRole('alert')).toHaveTextContent(shown);
    expect(within(registration()).queryByRole('button', { name: 'Register' })).toBeNull();
    cleanup();
  }
});

test('[FAILURE] [SG2-60:AC4] a missing or invalid phone and over-long needs are refused before anything is sent', async () => {
  profile.mockResolvedValue(withPhone(null));
  const fetch = await openDetail(open);
  fireEvent.click(within(registration()).getByRole('button', { name: 'Register' }));
  expect(within(registration()).getByRole('alert')).toHaveTextContent('Enter a contact phone number.');
  fireEvent.change(phoneField(), { target: { value: '9123 456' } });
  fireEvent.change(needsField(), { target: { value: 'n'.repeat(501) } });
  expect(registration()).toHaveTextContent('501/500 characters');
  fireEvent.click(within(registration()).getByRole('button', { name: 'Register' }));
  const alert = within(registration()).getByRole('alert');
  expect(alert).toHaveTextContent('Enter a Singapore phone number with 8 digits, optionally starting with +65.');
  expect(alert).toHaveTextContent('Keep accessibility or dietary needs to 500 characters.');
  expect(posts(fetch)).toEqual([]);
});

test('[FAILURE] [SG2-60:AC4] details the server refuses are listed for the attendee to fix', async () => {
  await openDetail(open, { '/api/registrable-events/591/registrations': () =>
    Response.json({ error: 'Check your registration details.', errors: ['contact_phone must be text.'] }, { status: 400 }) });
  fireEvent.click(within(registration()).getByRole('button', { name: 'Register' }));
  const alert = await within(registration()).findByRole('alert');
  expect(alert).toHaveTextContent('Check your registration details.');
  expect(alert).toHaveTextContent('contact_phone must be text.');
  expect(within(registration()).getByRole('button', { name: 'Register' })).toBeEnabled();
});

test('[FAILURE] [SG2-60:AC1] a failed or refused request keeps the form so the attendee can try again', async () => {
  for (const [response, shown] of [
    [() => new Response(null, { status: 503 }), 'Registration could not be completed. Please try again.'],
    [() => new Response(null, { status: 403 }), 'Only attendees can browse events here.'],
  ] as const) {
    await openDetail(open, { '/api/registrable-events/591/registrations': response });
    fireEvent.click(within(registration()).getByRole('button', { name: 'Register' }));
    expect(await within(registration()).findByRole('alert')).toHaveTextContent(shown);
    expect(within(registration()).getByRole('button', { name: 'Register' })).toBeEnabled();
    cleanup();
  }
});

test('[BOUNDARY] [SG2-60:AC1] pressing Register twice while it is sending registers once', async () => {
  let release: (response: Response) => void = () => {};
  const fetch = await openDetail(open, { '/api/registrable-events/591/registrations': () => undefined as unknown as Response });
  fetch.mockImplementation(async (_url: string, init?: RequestInit) => (init?.method === 'POST'
    ? new Promise<Response>((resolve) => { release = resolve; })
    : Response.json({ events: [open] })));
  const button = within(registration()).getByRole('button', { name: 'Register' });
  // Two presses before React re-renders, then one on the disabled button.
  act(() => { button.click(); button.click(); });
  fireEvent.click(button);
  expect(within(registration()).getByRole('button', { name: 'Registering…' })).toBeDisabled();
  await act(async () => release(Response.json({ registration: held }, { status: 201 })));
  expect(await within(registration()).findByRole('status')).toHaveTextContent('You are registered.');
  expect(posts(fetch)).toHaveLength(1);
});

test('[BOUNDARY] [SG2-60:AC4] a phone already typed is kept when the profile arrives', async () => {
  let answer: (outcome: ProfileOutcome) => void = () => {};
  profile.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  await openDetail(open);
  fireEvent.change(phoneField(), { target: { value: '8888 0000' } });
  await act(async () => answer(withPhone('+65 9123 4567')));
  expect(phoneField()).toHaveValue('8888 0000');

});

test('[BOUNDARY] [SG2-60:AC4] the phone and needs limits match the server, separators and +65 allowed', () => {
  expect(registrationProblems('(9123)-4567', 'n'.repeat(500))).toEqual([]);
  expect(registrationProblems(' +65 9123 4567 ', '')).toEqual([]);
  expect(registrationProblems(`9${' '.repeat(32)}1234567`, '')).toEqual([]);
  expect(registrationProblems(`9${' '.repeat(33)}1234567`, '')).toEqual(['Enter a Singapore phone number with 8 digits, optionally starting with +65.']);
  for (const phone of ['912345678', '+66 91234567', '6591234567', '9123 456a']) {
    expect(registrationProblems(phone, ''), phone).toEqual(['Enter a Singapore phone number with 8 digits, optionally starting with +65.']);
  }
  expect(registrationProblems('91234567', ` ${'n'.repeat(501)} `)).toEqual(['Keep accessibility or dietary needs to 500 characters.']);
  expect(registrationProblems('   ', '')).toEqual(['Enter a contact phone number.']);
});
