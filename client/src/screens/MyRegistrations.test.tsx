import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import MyRegistrations from './MyRegistrations';

const event = {
  name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar', description: 'An evening lecture on the harbour.',
  proposed_date: '2030-07-20T11:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }],
};
const active = {
  registration_id: 7, event_id: 591, standing: 'registered', can_withdraw: true, registered_at: '2026-10-23T01:00:00.000Z',
  withdrawn_at: null, contact_phone: '91234567', needs: 'Step-free access', event,
};
const withdrawn = { ...active, standing: 'withdrawn', can_withdraw: false, withdrawn_at: '2026-10-25T02:00:00.000Z' };
const others = [
  { ...active, registration_id: 8, event_id: 592, standing: 'event_started', can_withdraw: false, needs: null, event: { ...event, name: 'Started Talk' } },
  { ...active, registration_id: 9, event_id: 593, standing: 'event_completed', can_withdraw: false, event: { ...event, name: 'Done Talk' } },
  { ...active, registration_id: 10, event_id: 594, standing: 'event_cancelled', can_withdraw: false, event: { ...event, name: 'Off Talk' } },
  { ...withdrawn, registration_id: 11, event_id: 595, contact_phone: null, needs: null,
    event: { ...event, name: '  ', organisation: null, category: null, description: null, proposed_date: null, venues: [] } },
];

type Route = (init?: RequestInit) => Response;
function serve(routes: Record<string, Route>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes[url];
    if (!route) throw new Error(`Unexpected ${url}`);
    return route(init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const withdrawals = (fetch: ReturnType<typeof serve>) => fetch.mock.calls.filter(([, init]) => init?.method === 'POST').length;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('[NORMAL] [SG2-62:AC1] an attendee sees each registration with the event details and where it stands', async () => {
  serve({ '/api/my-registrations': () => Response.json({ registrations: [active, ...others] }) });
  render(<MyRegistrations accessToken="attendee-token" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading your registrations…');

  const card = await screen.findByRole('article', { name: 'Harbour Lecture' });
  expect(card).toHaveTextContent('Registered');
  expect(card).toHaveTextContent('An evening lecture on the harbour.');
  expect(card).toHaveTextContent('Date and time20 Jul 2030, 7:00 pm');
  expect(card).toHaveTextContent('VenueRegression Hall');
  expect(card).toHaveTextContent('Hosted byHarbour Foundation');
  expect(card).toHaveTextContent('CategorySeminar');
  expect(card).toHaveTextContent('Contact phone91234567');
  expect(card).toHaveTextContent('Accessibility or dietary needsStep-free access');
  expect(within(card).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();

  for (const [name, label] of [['Started Talk', 'Event started'], ['Done Talk', 'Event completed'], ['Off Talk', 'Event cancelled']]) {
    const other = screen.getByRole('article', { name });
    expect(other).toHaveTextContent(label);
    expect(within(other).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  }
});

test('[BOUNDARY] [SG2-62:AC1] a withdrawn registration with sparse event details shows when it was withdrawn and what is not yet known', async () => {
  serve({ '/api/my-registrations': () => Response.json({ registrations: [others[3]] }) });
  render(<MyRegistrations accessToken="attendee-token" />);
  const card = await screen.findByRole('article', { name: 'Untitled event' });
  expect(card).toHaveTextContent('Withdrawn');
  expect(card).toHaveTextContent('Withdrawn25 Oct 2026, 10:00 am');
  expect(card).toHaveTextContent('Date and timeTo be announced');
  expect(card).toHaveTextContent('VenueTo be announced');
  expect(card).toHaveTextContent('Hosted byTo be announced');
  expect(card).toHaveTextContent('Contact phoneFrom your profile');
  expect(card).not.toHaveTextContent('Accessibility or dietary needs');
  expect(within(card).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-62:AC1] an attendee with no registrations is pointed to Find events', async () => {
  serve({ '/api/my-registrations': () => Response.json({ registrations: [] }) });
  render(<MyRegistrations accessToken="attendee-token" />);
  expect(await screen.findByRole('heading', { name: 'No registrations yet' })).toBeInTheDocument();
  expect(screen.getByText('Events you register for from Find events appear here.')).toBeInTheDocument();
});

test('[NORMAL] [SG2-62:AC2] [SG2-62:AC3] withdrawing asks for confirmation, then gives the place back and shows the registration as withdrawn', async () => {
  let gone = false;
  const fetch = serve({
    '/api/my-registrations': () => Response.json({ registrations: [gone ? withdrawn : active] }),
    '/api/my-registrations/7/withdrawal': (init) => {
      expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer attendee-token' } });
      gone = true;
      return Response.json({ withdrawal: { registration_id: 7, event_id: 591, withdrawn_at: withdrawn.withdrawn_at } });
    },
  });
  render(<MyRegistrations accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'Withdraw' }));

  const confirm = screen.getByRole('group', { name: 'Withdraw from Harbour Lecture' });
  expect(confirm).toHaveTextContent('Your place goes back to the event and someone else can take it.');
  expect(withdrawals(fetch)).toBe(0);
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm withdrawal' }));

  expect(await screen.findByRole('status')).toHaveTextContent('You have withdrawn from Harbour Lecture. Your place has been given back.');
  const card = await screen.findByRole('article', { name: 'Harbour Lecture' });
  await vi.waitFor(() => expect(card.isConnected ? card : screen.getByRole('article', { name: 'Harbour Lecture' })).toHaveTextContent('Withdrawn'));
  expect(screen.getByRole('article', { name: 'Harbour Lecture' })).toHaveTextContent('Withdrawn25 Oct 2026, 10:00 am');
  expect(within(screen.getByRole('article', { name: 'Harbour Lecture' })).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  expect(withdrawals(fetch)).toBe(1);
});

test('[NORMAL] [SG2-62:AC2] keeping the place sends nothing', async () => {
  const fetch = serve({ '/api/my-registrations': () => Response.json({ registrations: [active] }) });
  render(<MyRegistrations accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'Withdraw' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep my place' }));
  expect(screen.queryByRole('group', { name: 'Withdraw from Harbour Lecture' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  expect(withdrawals(fetch)).toBe(0);
});

test('[FAILURE] [SG2-62:AC4] once the event has started the attendee is told so and the registration stays', async () => {
  serve({
    '/api/my-registrations': () => Response.json({ registrations: [active] }),
    '/api/my-registrations/7/withdrawal': () => Response.json({
      error: 'This event started 20 Jul 2030 19:00 SGT, so you can no longer withdraw.', reason: 'started', proposed_date: event.proposed_date,
    }, { status: 409 }),
  });
  render(<MyRegistrations accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'Withdraw' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This event started 20 Jul 2030 19:00 SGT, so you can no longer withdraw.');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-62:AC2] a lost registration, a refused account and an outage each say what to do', async () => {
  for (const [response, message] of [
    [() => Response.json({ error: 'This registration was not found.' }, { status: 404 }), 'This registration was not found. Refresh the list.'],
    [() => Response.json({ error: 'Access denied' }, { status: 403 }), 'Only attendees can see registrations here. Sign in again if your role has changed.'],
    [() => Response.json({ error: 'down' }, { status: 503 }), 'The withdrawal could not be completed. Please try again.'],
  ] as [Route, string][]) {
    serve({ '/api/my-registrations': () => Response.json({ registrations: [active] }), '/api/my-registrations/7/withdrawal': response });
    render(<MyRegistrations accessToken="attendee-token" />);
    fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    cleanup();
    vi.unstubAllGlobals();
  }
});

test('[CONFLICT] [SG2-62:AC2] a double click on confirm sends one withdrawal', async () => {
  let finish: (response: Response) => void = () => undefined;
  const fetch = serve({
    '/api/my-registrations': () => Response.json({ registrations: [active] }),
    '/api/my-registrations/7/withdrawal': () => new Promise<Response>((resolve) => { finish = resolve; }) as unknown as Response,
  });
  render(<MyRegistrations accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'Withdraw' }));
  const button = screen.getByRole('button', { name: 'Confirm withdrawal' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(await screen.findByRole('button', { name: 'Withdrawing…' })).toBeDisabled();
  finish(Response.json({ error: 'You have already withdrawn from this event.', reason: 'withdrawn' }, { status: 409 }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You have already withdrawn from this event.');
  expect(withdrawals(fetch)).toBe(1);
});

test('[BOUNDARY] [SG2-62:AC2] an unnamed event with no registration time can still be withdrawn from', async () => {
  const unnamed = { ...active, registered_at: null, event: { ...event, name: ' ' } };
  serve({
    '/api/my-registrations': () => Response.json({ registrations: [unnamed] }),
    '/api/my-registrations/7/withdrawal': () => Response.json({ withdrawal: { registration_id: 7, event_id: 591, withdrawn_at: withdrawn.withdrawn_at } }),
  });
  render(<MyRegistrations accessToken="attendee-token" />);
  const card = await screen.findByRole('article', { name: 'Untitled event' });
  expect(card).toHaveTextContent('RegisteredTo be announced');
  fireEvent.click(within(card).getByRole('button', { name: 'Withdraw' }));
  fireEvent.click(within(screen.getByRole('group', { name: 'Withdraw from Untitled event' })).getByRole('button', { name: 'Confirm withdrawal' }));
  expect(await screen.findByRole('status')).toHaveTextContent('You have withdrawn from Untitled event.');
});

test('[CONFLICT] [SG2-62:AC2] two presses before the screen updates send one withdrawal', async () => {
  const fetch = serve({
    '/api/my-registrations': () => Response.json({ registrations: [active] }),
    '/api/my-registrations/7/withdrawal': () => Response.json({ error: 'You have already withdrawn from this event.', reason: 'withdrawn' }, { status: 409 }),
  });
  render(<MyRegistrations accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'Withdraw' }));
  const button = screen.getByRole('button', { name: 'Confirm withdrawal' });
  // Both presses land in one render, before the button is disabled; the ref guard stops the second.
  await act(async () => { button.click(); button.click(); });
  expect(await screen.findByRole('alert')).toHaveTextContent('You have already withdrawn from this event.');
  expect(withdrawals(fetch)).toBe(1);
});



test('[FAILURE] [SG2-62:AC1] an outage offers a retry, and a non-attendee is told why', async () => {
  let up = false;
  serve({ '/api/my-registrations': () => (up ? Response.json({ registrations: [active] }) : Response.json({ error: 'down' }, { status: 503 })) });
  render(<MyRegistrations accessToken="attendee-token" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Your registrations are temporarily unavailable. Please try again.');
  up = true;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('article', { name: 'Harbour Lecture' })).toBeInTheDocument();
  cleanup();

  serve({ '/api/my-registrations': () => Response.json({ error: 'Access denied' }, { status: 403 }) });
  render(<MyRegistrations accessToken="organiser-token" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Only attendees can see registrations here.');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
});
