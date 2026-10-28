import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import FindEvents, { waitingLabel } from './FindEvents';
import { fetchProfile } from '../api/profile';

vi.mock('../api/profile', () => ({ fetchProfile: vi.fn() }));
const profile = vi.mocked(fetchProfile);

const open = {
  event_id: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture on the harbour.', proposed_date: '2030-07-20T11:00:00.000Z',
  registration_opens_at: '2020-10-01T00:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: false, full: false, waiting: null as unknown,
};
const full = { ...open, full: true };
const second = { status: 'waiting', position: 2, joined_at: '2030-06-02T01:00:00.000Z' };
const offered = { status: 'offered', offer_expires_at: '2030-06-03T01:00:00.000Z', joined_at: '2030-06-02T01:00:00.000Z' };
const LIST = '/api/registrable-events/591/waiting-list';

type Route = (init?: RequestInit) => Response;
function serve(routes: Record<string, Route>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const route = routes[`${init?.method ?? 'GET'} ${url}`] ?? routes[url];
    if (!route) throw new Error(`Unexpected ${init?.method ?? 'GET'} ${url}`);
    return route(init);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

beforeEach(() => profile.mockResolvedValue({ ok: true, profile: { user_id: 'u', name: 'Ana', organisation: null, phone: '91234567', communication_preferences: [] } }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  profile.mockReset();
});

async function openDetail(event: typeof open, extra: Record<string, Route> = {}) {
  const fetch = serve({
    '/api/registrable-events': () => Response.json({ events: [event] }),
    '/api/registrable-events/591': () => Response.json({ event }),
    ...extra,
  });
  render(<FindEvents accessToken="attendee-token" />);
  fireEvent.click(within(await screen.findByRole('article', { name: event.name })).getByRole('button', { name: 'View details' }));
  await screen.findByRole('region', { name: 'Registration' });
  return fetch;
}
const registration = () => within(screen.getByRole('region', { name: 'Registration' }));

test('[NORMAL] [SG2-61:AC1] [SG2-61:AC5] a full event is shown full; the attendee joins its waiting list and sees their position', async () => {
  serve({ '/api/registrable-events': () => Response.json({ events: [full] }) });
  render(<FindEvents accessToken="attendee-token" />);
  expect(await within(await screen.findByRole('article', { name: 'Harbour Lecture' })).findByText('Full')).toBeVisible();
  cleanup();

  const fetch = await openDetail(full, { [`POST ${LIST}`]: () => Response.json({ waiting: second }, { status: 201 }) });
  expect(registration().getByRole('alert')).toHaveTextContent('This event is full. Join the waiting list');
  expect(registration().queryByRole('button', { name: 'Register' })).toBeNull();
  fireEvent.click(registration().getByRole('button', { name: 'Join the waiting list' }));
  expect(await registration().findByText('You are number 2 on the waiting list.')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(LIST, { method: 'POST', headers: { Authorization: 'Bearer attendee-token' } });
  expect(profile).not.toHaveBeenCalled();
});

test('[NORMAL] [SG2-61:AC5] [SG2-61:AC6] an attendee on the list sees their position and leaves it at any time', async () => {
  serve({ '/api/registrable-events': () => Response.json({ events: [{ ...full, waiting: second }] }) });
  render(<FindEvents accessToken="attendee-token" />);
  expect(await within(await screen.findByRole('article', { name: 'Harbour Lecture' })).findByText('Waiting list #2')).toBeVisible();
  cleanup();

  const fetch = await openDetail({ ...full, waiting: second }, { [`DELETE ${LIST}`]: () => Response.json({ left: true }) });
  expect(registration().getByText('You are number 2 on the waiting list.')).toBeVisible();
  fireEvent.click(registration().getByRole('button', { name: 'Leave the waiting list' }));
  expect(await registration().findByRole('alert')).toHaveTextContent('You have left the waiting list.');
  expect(registration().getByRole('button', { name: 'Join the waiting list' })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(LIST, { method: 'DELETE', headers: { Authorization: 'Bearer attendee-token' } });
});

test('[FAILURE] [SG2-61:AC6] a leave that fails keeps the attendee on the list and says so; one already off the list is shown as left', async () => {
  await openDetail({ ...full, waiting: second }, { [`DELETE ${LIST}`]: () => new Response(null, { status: 503 }) });
  fireEvent.click(registration().getByRole('button', { name: 'Leave the waiting list' }));
  expect(await registration().findByRole('alert')).toHaveTextContent('You could not be taken off the waiting list. Please try again.');
  expect(registration().getByText('You are number 2 on the waiting list.')).toBeVisible();
  cleanup();

  await openDetail({ ...full, waiting: second }, { [`DELETE ${LIST}`]: () => new Response(null, { status: 403 }) });
  fireEvent.click(registration().getByRole('button', { name: 'Leave the waiting list' }));
  expect(await registration().findByRole('alert')).toHaveTextContent('Only attendees can browse events here.');
  cleanup();

  await openDetail({ ...full, waiting: second }, { [`DELETE ${LIST}`]: () => Response.json({ error: 'x' }, { status: 404 }) });
  fireEvent.click(registration().getByRole('button', { name: 'Leave the waiting list' }));
  expect(await registration().findByRole('alert')).toHaveTextContent('You have left the waiting list.');
});

test('[NORMAL] [SG2-62:AC6] an attendee offered a place sees how long it is held and registers to take it', async () => {
  serve({ '/api/registrable-events': () => Response.json({ events: [{ ...open, waiting: offered }] }) });
  render(<FindEvents accessToken="attendee-token" />);
  expect(await within(await screen.findByRole('article', { name: 'Harbour Lecture' })).findByText('Place held for you')).toBeVisible();
  cleanup();

  await openDetail({ ...open, waiting: offered }, {
    'POST /api/registrable-events/591/registrations': () => Response.json({ registration: {
      registration_id: 7, event_id: 591, registered_at: '2030-06-02T02:00:00.000Z', contact_phone: '91234567', needs: null } }, { status: 201 }),
  });
  expect(registration().getByRole('status')).toHaveTextContent('A place has opened for you from the waiting list. It is held until 3 Jun 2030, 9:00 am.');
  expect(await registration().findByDisplayValue('91234567')).toBeVisible();
  fireEvent.click(registration().getByRole('button', { name: 'Register' }));
  expect(await registration().findByText('You are registered. Your place is held.')).toBeVisible();
});

test('[BOUNDARY] [SG2-62:AC6] an attendee offered a place can pass it on by leaving; a failed leave keeps the form', async () => {
  await openDetail({ ...open, waiting: offered }, { [`DELETE ${LIST}`]: () => new Response(null, { status: 500 }) });
  fireEvent.click(registration().getByRole('button', { name: 'Leave the waiting list' }));
  expect(await registration().findByRole('alert')).toHaveTextContent('You could not be taken off the waiting list. Please try again.');
  expect(registration().getByRole('button', { name: 'Register' })).toBeVisible();
  cleanup();

  await openDetail({ ...open, waiting: offered }, { [`DELETE ${LIST}`]: () => Response.json({ left: true }) });
  fireEvent.click(registration().getByRole('button', { name: 'Leave the waiting list' }));
  expect(await registration().findByRole('alert')).toHaveTextContent('You have left the waiting list.');
  expect(registration().queryByRole('button', { name: 'Register' })).toBeNull();
});

test('[CONFLICT] [SG2-61:AC1] a place taken while the attendee was filling in the form turns into the waiting-list offer', async () => {
  await openDetail(open, {
    'POST /api/registrable-events/591/registrations': () => Response.json({ error: 'This event is full.', reason: 'full' }, { status: 409 }),
  });
  await registration().findByDisplayValue('91234567');
  fireEvent.click(registration().getByRole('button', { name: 'Register' }));
  expect(await registration().findByRole('button', { name: 'Join the waiting list' })).toBeVisible();
});

test('[CONFLICT] [SG2-61:AC6] joining again or while registered shows where the attendee already stands', async () => {
  const cases: [Response, string][] = [
    [Response.json({ error: 'You are already on the waiting list for this event.', reason: 'already', waiting: second }, { status: 409 }),
      'You are number 2 on the waiting list.'],
    [Response.json({ error: 'You are already registered for this event.', reason: 'registered' }, { status: 409 }),
      'You are already registered for this event.'],
    [Response.json({ error: 'You are already on the waiting list for this event.', reason: 'already', waiting: offered }, { status: 409 }),
      'A place has opened for you from the waiting list.'],
  ];
  for (const [reply, shown] of cases) {
    await openDetail(full, { [`POST ${LIST}`]: () => reply });
    fireEvent.click(registration().getByRole('button', { name: 'Join the waiting list' }));
    expect(await registration().findByText(shown, { exact: false })).toBeVisible();
    cleanup();
  }
});

test('[BOUNDARY] [SG2-61:AC5] a join refused because a place came free, the window shut, or the event went, says so', async () => {
  const cases: [Response, string, boolean][] = [
    [Response.json({ error: 'Places are still available. Register instead.', reason: 'not_full' }, { status: 409 }),
      'A place is free again. Register now to take it.', true],
    [Response.json({ error: 'Registration for this event has closed.', reason: 'closed' }, { status: 409 }),
      'Registration for this event has closed.', false],
    [Response.json({ error: 'x' }, { status: 404 }), 'This event is no longer open for registration.', false],
    [new Response(null, { status: 503 }), 'The waiting list could not be joined. Please try again.', false],
    [new Response(null, { status: 401 }), 'Only attendees can browse events here.', false],
  ];
  for (const [reply, shown, form] of cases) {
    await openDetail(full, { [`POST ${LIST}`]: () => reply });
    fireEvent.click(registration().getByRole('button', { name: 'Join the waiting list' }));
    expect(await registration().findByText(shown, { exact: false })).toBeVisible();
    expect(registration().getByRole('alert')).toHaveTextContent(shown);
    expect(registration().queryByRole('button', { name: 'Register' }) !== null).toBe(form);
    cleanup();
  }
});

test('[NORMAL] [SG2-61:AC5] the badge names the position, or that a place is held', () => {
  expect(waitingLabel({ status: 'waiting', position: 3, joinedAt: 'j' })).toBe('Waiting list #3');
  expect(waitingLabel({ status: 'offered', offerExpiresAt: 'x', joinedAt: 'j' })).toBe('Place held for you');
});
