import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Venues from '../screens/Venues';
import { deleteVenue, VenueDeleteBlocked, VenueError, type Venue } from './api';

const venue: Venue = { venue_id: 1, name: 'Atrium Hall', location: 'North Wing', capacity: 100,
  facilities: 'Stage', accessibility_features: 'Hearing loop', operating_information: 'Weekdays' };
const other: Venue = { ...venue, venue_id: 2, name: 'Garden Room' };
const staff = { userId: 'staff', role: 'venue_staff', permissions: ['venues.read', 'venues.update', 'venues.delete'] };
const blocker = { kind: 'hold', id: 9, event_id: 4, event_name: 'Tech Symposium', starts_at: '2030-06-01T01:00:00.000Z', ends_at: '2030-06-01T03:00:00.000Z' };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function serve(identity: typeof staff, remove: () => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    if (url === '/api/auth/me') return Response.json(identity);
    if (url === '/api/venues' && init?.method === 'GET') return Response.json({ venues: [venue, other] });
    if (url === '/api/venues/1' && init?.method === 'DELETE') return remove();
    throw new Error(`Unexpected request: ${init?.method} ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function open(identity = staff, remove: () => Response | Promise<Response> = () => Response.json({ venue: { venue_id: 1 } })) {
  const fetch = serve(identity, remove);
  render(<Venues accessToken="test-token" />);
  await screen.findByRole('searchbox');
  return fetch;
}
const deletes = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'DELETE');

test('[NORMAL] [SG2-106:AC1] [SG2-106:AC2] staff confirm a delete and the venue leaves the catalogue', async () => {
  const fetch = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Atrium Hall' }));
  const panel = screen.getByRole('group', { name: 'Delete Atrium Hall' });
  expect(panel).toHaveTextContent('Past bookings and history keep its name.');
  expect(deletes(fetch)).toHaveLength(0);
  fireEvent.click(within(panel).getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByText('Atrium Hall deleted. It no longer appears in search, availability or new bookings.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Atrium Hall' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Garden Room' })).toBeInTheDocument();
  expect(deletes(fetch)).toEqual([['/api/venues/1', expect.objectContaining({ method: 'DELETE', cache: 'no-store' })]]);
});

test('[BOUNDARY] [SG2-106:AC1] cancelling the confirmation sends nothing', async () => {
  const fetch = await open();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('group', { name: 'Delete Atrium Hall' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete Atrium Hall' })).toBeInTheDocument();
  expect(deletes(fetch)).toHaveLength(0);
});

test('[CONFLICT] [SG2-106:AC1] a refused delete lists what is still booked and keeps the venue', async () => {
  await open(staff, () => Response.json({ error: 'busy', blockers: [blocker, { ...blocker, kind: 'booking', id: 3, event_name: null }] }, { status: 409 }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  const alert = await screen.findByText(/cannot be deleted while it has current or future work/);
  expect(alert).toHaveAttribute('role', 'alert');
  const items = screen.getAllByRole('listitem').map(item => item.textContent);
  expect(items[0]).toMatch(/^Tentative hold #9 · Tech Symposium · 1 Jun 2030, 09:00 – 1 Jun 2030, 11:00 \(SGT\)$/);
  expect(items[1]).toMatch(/^Booking #3 · No event · /);
  expect(screen.queryByRole('button', { name: 'Confirm delete' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-106:AC5] roles without delete permission see no delete control', async () => {
  await open({ ...staff, role: 'event_coordinator', permissions: ['venues.read'] });
  expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
});

test.each([401, 403])('[FAILURE] [SG2-106:AC5] a %s response hides the catalogue', async status => {
  await open(staff, () => new Response(null, { status }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByText(new VenueError(status).message)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Atrium Hall' })).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-106:AC1] missing venues and network failures stay in the panel for another try', async () => {
  const replies: (() => Response)[] = [() => new Response(null, { status: 404 }), () => { throw new TypeError('offline'); }];
  await open(staff, () => replies.shift()!());
  fireEvent.click(screen.getByRole('button', { name: 'Delete Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByText('This venue is no longer available. Reload the catalogue.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  expect(await screen.findByText('Unable to delete the venue. Please try again.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Atrium Hall' })).toBeInTheDocument();
});

test('[CONFLICT] [SG2-106:AC1] a second click while deleting sends one request, and unmounting ignores the reply', async () => {
  let finish!: (value: Response) => void;
  const fetch = await open(staff, () => new Promise<Response>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Atrium Hall' }));
  const confirm = screen.getByRole('button', { name: 'Confirm delete' });
  fireEvent.click(confirm);
  expect(await screen.findByRole('button', { name: 'Deleting…' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Deleting…' }));
  expect(deletes(fetch)).toHaveLength(1);
  cleanup();
  await act(async () => finish(Response.json({ venue: { venue_id: 1 } })));
});

test('[FAILURE] [SG2-106:AC1] a refusal without a readable body still refuses with an empty list', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 409 })));
  const failure = await deleteVenue('token', new AbortController().signal, 1).catch(error => error);
  expect(failure).toBeInstanceOf(VenueDeleteBlocked);
  expect(failure.blockers).toEqual([]);
});

test('[FAILURE] [SG2-106:AC1] a failure that arrives after leaving the page is ignored', async () => {
  let fail!: (reason: Error) => void;
  const fetch = await open(staff, () => new Promise<Response>((_resolve, reject) => { fail = reject; }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Atrium Hall' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
  await screen.findByRole('button', { name: 'Deleting…' });
  cleanup();
  await act(async () => fail(new TypeError('offline')));
  expect(deletes(fetch)).toHaveLength(1);
  expect(screen.queryByText('Unable to delete the venue. Please try again.')).not.toBeInTheDocument();
});
