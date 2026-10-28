import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import FindEvents, { registrationState } from './FindEvents';
import type { RegistrableEvent } from '../api/registrableEvents';

const open = {
  event_id: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture on the harbour.', proposed_date: '2030-07-20T11:00:00.000Z',
  registration_opens_at: '2020-10-01T00:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }, { name: 'Annex', location: null }],
};
const upcoming = {
  ...open, event_id: 592, name: 'Bayfront Workshop', category: null, organisation: null, description: null,
  proposed_date: '2030-06-30T01:00:00.000Z', registration_opens_at: '2030-06-01T00:00:00.000Z', venues: [],
};

/** Each call gets a fresh Response (StrictMode runs effects twice). */
function serve(routes: Record<string, () => Response>) {
  const fetch = vi.fn(async (url: string) => {
    const route = routes[url];
    if (!route) throw new Error(`Unexpected ${url}`);
    return route();
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (name: string) => screen.getByRole('article', { name });

test('[NORMAL] [SG2-59:AC1] an attendee sees each event open or opening for registration with name, date, time, venue and where registration stands', async () => {
  serve({ '/api/registrable-events': () => Response.json({ events: [upcoming, open] }) });
  render(<FindEvents accessToken="attendee-token" />);
  expect(await screen.findByRole('article', { name: 'Bayfront Workshop' })).toBeVisible();
  const items = within(screen.getByRole('region', { name: 'Events open for registration' })).getAllByRole('article');
  expect(items.map((item) => item.getAttribute('aria-labelledby'))).toEqual(['find-events-592', 'find-events-591']);
  expect(card('Harbour Lecture')).toHaveTextContent('Date and time20 Jul 2030, 7:00 pm');
  expect(card('Harbour Lecture')).toHaveTextContent('VenueRegression Hall, Annex');
  expect(card('Harbour Lecture')).toHaveTextContent('Registration open');
  expect(card('Harbour Lecture')).toHaveTextContent('RegistrationCloses 19 Jul 2030, 10:00 am');
  expect(card('Bayfront Workshop')).toHaveTextContent('Opening soon');
  expect(card('Bayfront Workshop')).toHaveTextContent('RegistrationOpens 1 Jun 2030, 8:00 am');
  expect(card('Bayfront Workshop')).toHaveTextContent('VenueTo be announced');
});

test('[NORMAL] [SG2-59:AC3] opening an event shows its attendee-facing details and returns to the list', async () => {
  const fetch = serve({
    '/api/registrable-events': () => Response.json({ events: [open] }),
    '/api/registrable-events/591': () => Response.json({ event: open }),
  });
  render(<FindEvents accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'View details' }));
  const detail = await screen.findByRole('article', { name: 'Harbour Lecture' });
  expect(detail).toHaveTextContent('An evening lecture on the harbour.');
  for (const text of ['CategorySeminar', 'Hosted byHarbour Foundation', 'Registration opens1 Oct 2020, 8:00 am',
    'Registration closes19 Jul 2030, 10:00 am', 'Date and time20 Jul 2030, 7:00 pm']) {
    expect(detail).toHaveTextContent(text);
  }
  expect(within(within(detail).getByRole('region', { name: 'Venue' })).getAllByRole('listitem').map((item) => item.textContent))
    .toEqual(['Regression Hall, Level 1', 'Annex']);
  expect(fetch).toHaveBeenCalledWith('/api/registrable-events/591', expect.anything());
  fireEvent.click(within(detail).getByRole('button', { name: 'Back to events' }));
  expect(await screen.findByRole('region', { name: 'Events open for registration' })).toBeVisible();
});

test('[BOUNDARY] [SG2-59:AC3] an event with no description, category, host or venue says so plainly', async () => {
  serve({
    '/api/registrable-events': () => Response.json({ events: [{ ...upcoming, name: '  ', proposed_date: null }] }),
    '/api/registrable-events/592': () => Response.json({ event: { ...upcoming, name: '  ', proposed_date: null,
      registration_opens_at: null, registration_closes_at: null } }),
  });
  render(<FindEvents accessToken="t" />);
  expect(await screen.findByRole('article', { name: 'Untitled event' })).toHaveTextContent('Date and timeTo be announced');
  fireEvent.click(within(screen.getByRole('article', { name: 'Untitled event' })).getByRole('button', { name: 'View details' }));
  const detail = await screen.findByRole('article', { name: 'Untitled event' });
  for (const text of ['No description yet.', 'CategoryUncategorised', 'Hosted byTo be announced', 'Date and timeTo be announced',
    'Registration opensTo be announced', 'Registration closesTo be announced', 'The venue will be announced.', 'Registration open']) {
    expect(detail).toHaveTextContent(text);
  }
});

test('[BOUNDARY] [SG2-59:AC2] with nothing open or opening, the attendee is told so', async () => {
  serve({ '/api/registrable-events': () => Response.json({ events: [] }) });
  render(<FindEvents accessToken="t" />);
  expect(await screen.findByRole('heading', { name: 'No events open for registration' })).toBeVisible();
});

test('[FAILURE] [SG2-59:AC2] an event that stopped being listed does not open its details', async () => {
  serve({
    '/api/registrable-events': () => Response.json({ events: [open] }),
    '/api/registrable-events/591': () => Response.json({ error: 'gone' }, { status: 404 }),
  });
  render(<FindEvents accessToken="t" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'View details' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This event is no longer open for registration.');
  expect(screen.queryByText('An evening lecture on the harbour.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Back to events' }));
  expect(await screen.findByRole('article', { name: 'Harbour Lecture' })).toBeVisible();
});

test('[FAILURE] [SG2-59:AC3] a refused or failed detail read says why without showing the event', async () => {
  for (const [status, message] of [[403, 'Only attendees can browse events here.'], [500, 'Events are temporarily unavailable.']] as const) {
    serve({
      '/api/registrable-events': () => Response.json({ events: [open] }),
      '/api/registrable-events/591': () => new Response(null, { status }),
    });
    const { unmount } = render(<FindEvents accessToken="t" />);
    fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'View details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    unmount();
  }
});

test('[FAILURE] [SG2-59:AC1] a refused list explains it, and an unavailable list can be retried', async () => {
  serve({ '/api/registrable-events': () => new Response(null, { status: 403 }) });
  const { unmount } = render(<FindEvents accessToken="t" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Only attendees can browse events here.');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  unmount();

  let calls = 0;
  serve({ '/api/registrable-events': () => (++calls === 1 ? new Response(null, { status: 503 }) : Response.json({ events: [open] })) });
  render(<FindEvents accessToken="t" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Events are temporarily unavailable. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('article', { name: 'Harbour Lecture' })).toBeVisible();
});

test('[BOUNDARY] [SG2-59:AC1] registration counts as open from its opening time on', () => {
  const event: RegistrableEvent = {
    eventId: 1, name: 'x', organisation: null, category: null, description: null, proposedDate: null,
    registrationOpensAt: '2030-06-01T00:00:00.000Z', registrationClosesAt: '2030-06-25T00:00:00.000Z', venues: [], registered: false, full: false, waiting: null,
  };
  const opens = Date.parse('2030-06-01T00:00:00.000Z');
  expect(registrationState(event, opens - 1)).toEqual({ label: 'Opening soon', when: 'Opens 1 Jun 2030, 8:00 am', open: false });
  expect(registrationState(event, opens)).toEqual({ label: 'Registration open', when: 'Closes 25 Jun 2030, 8:00 am', open: true });
  expect(registrationState({ ...event, registrationOpensAt: null, registrationClosesAt: null }, opens))
    .toEqual({ label: 'Registration open', when: 'Open now', open: true });
});

test('[BOUNDARY] [SG2-59:AC3] a detail that arrives after the attendee has left is ignored', async () => {
  let release: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/registrable-events'
    ? Response.json({ events: [open] })
    : new Promise<Response>((resolve) => { release = resolve; })));
  const { unmount } = render(<FindEvents accessToken="t" />);
  fireEvent.click(within(await screen.findByRole('article', { name: 'Harbour Lecture' })).getByRole('button', { name: 'View details' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading event…');
  unmount();
  release(Response.json({ event: open }));
  await Promise.resolve();
  expect(screen.queryByText('An evening lecture on the harbour.')).toBeNull();
});

test('[BOUNDARY] [SG2-59:AC1] a list that arrives after the attendee has left is ignored', async () => {
  let release: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  const { unmount } = render(<FindEvents accessToken="t" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading events…');
  unmount();
  release(Response.json({ events: [open] }));
  await Promise.resolve();
  expect(screen.queryByRole('article')).toBeNull();
});
