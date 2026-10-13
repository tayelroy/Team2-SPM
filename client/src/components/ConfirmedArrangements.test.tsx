import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import ConfirmedArrangements from './ConfirmedArrangements';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const view = {
  event_id: 7, status: 'confirmed', confirmed_at: '2026-10-11T02:00:00.000Z',
  venues: [{ venue_name: 'Regression Hall', starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' }],
  equipment: [{ equipment_type: 'Wireless microphones', quantity_reserved: 12 }],
  registration: { needed: true, capacity: 120, opens_at: '2030-06-01T01:00:00.000Z', closes_at: '2030-06-19T15:59:00.000Z', window: 'open' },
};

function stub(...responses: (() => Response | Promise<Response>)[]) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => (responses.length > 1 ? responses.shift()! : responses[0])());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('[NORMAL] [SG2-58:AC1] [SG2-58:AC3] the organiser sees venues in Singapore time, equipment quantities and an open registration window', async () => {
  const fetch = stub(() => Response.json(view));
  render(<ConfirmedArrangements eventId={7} accessToken="organiser-token" />);
  const section = within(screen.getByRole('region', { name: 'Confirmed arrangements' }));
  expect(section.getByRole('status')).toHaveTextContent('Loading confirmed arrangements…');
  expect(await section.findByText('Regression Hall: 20 Jun 2030, 10:00 SGT – 20 Jun 2030, 14:00 SGT')).toBeVisible();
  expect(section.getByRole('heading', { name: 'Confirmed arrangements' })).toBeVisible();
  expect(section.getByText('Confirmed at')).toBeVisible();
  expect(section.getByText('11 Oct 2026, 10:00 SGT')).toBeVisible();
  expect(section.getByRole('heading', { name: 'Venues' })).toBeVisible();
  expect(section.getByRole('heading', { name: 'Equipment' })).toBeVisible();
  expect(section.getByText('12 × Wireless microphones')).toBeVisible();
  expect(section.getByRole('heading', { name: 'Registration' })).toBeVisible();
  expect(section.getByText('Capacity')).toBeVisible();
  expect(section.getByText('120')).toBeVisible();
  expect(section.getByText('1 Jun 2030, 09:00 SGT')).toBeVisible();
  expect(section.getByText('19 Jun 2030, 23:59 SGT')).toBeVisible();
  expect(section.getByText('Registration is open. Attendees can register now.')).toBeVisible();
  expect(section.queryByRole('status')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/7/confirmation', expect.objectContaining({ headers: { Authorization: 'Bearer organiser-token' } }));
});

test.each([
  ['not_confirmed', 'Registration opens once the event is confirmed.'],
  ['not_yet_open', 'Registration has not opened yet.'],
  ['closed', 'Registration has closed.'],
])('[BOUNDARY] [SG2-58:AC3] the %s registration window is explained in plain language', async (window, sentence) => {
  stub(() => Response.json({ ...view, registration: { ...view.registration, window } }));
  render(<ConfirmedArrangements eventId={7} accessToken="token" />);
  expect(await screen.findByText(sentence)).toBeVisible();
  expect(screen.queryByText('Registration is open. Attendees can register now.')).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-58:AC1] [SG2-58:AC3] empty lists, unrequired registration and no confirmation time read plainly', async () => {
  stub(() => Response.json({ ...view, status: 'completed', confirmed_at: null, venues: [], equipment: [],
    registration: { needed: false, capacity: null, opens_at: null, closes_at: null, window: 'not_required' } }));
  render(<ConfirmedArrangements eventId={7} accessToken="token" />);
  expect(await screen.findByText('No venue bookings recorded.')).toBeVisible();
  expect(screen.getByText('No equipment reserved.')).toBeVisible();
  expect(screen.getByText('Registration is not required for this event.')).toBeVisible();
  expect(screen.queryByText('Confirmed at')).not.toBeInTheDocument();
  expect(screen.queryByText('Capacity')).not.toBeInTheDocument();
});

test('[BOUNDARY] [SG2-58:AC3] needed registration with unset capacity and times shows Not set', async () => {
  stub(() => Response.json({ ...view, registration: { needed: true, capacity: null, opens_at: null, closes_at: null, window: 'not_confirmed' } }));
  render(<ConfirmedArrangements eventId={7} accessToken="token" />);
  expect(await screen.findByText('Registration opens once the event is confirmed.')).toBeVisible();
  expect(screen.getAllByText('Not set')).toHaveLength(3);
});

test('[FAILURE] [SG2-58:AC1] a 404 for this caller renders nothing at all', async () => {
  const fetch = stub(() => Response.json({ error: 'Not found' }, { status: 404 }));
  const { container } = render(<ConfirmedArrangements eventId={7} accessToken="token" />);
  await act(async () => { await fetch.mock.results[0].value; });
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByRole('region', { name: 'Confirmed arrangements' })).not.toBeInTheDocument();
});

test('[FAILURE] [SG2-58:AC1] an unavailable or unreachable server is explained and Retry loads again', async () => {
  const fetch = stub(
    () => Response.json({ error: 'Unavailable' }, { status: 503 }),
    () => { throw new TypeError('Failed to fetch'); },
    () => Response.json(view),
  );
  render(<ConfirmedArrangements eventId={7} accessToken="token" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirmed arrangements could not be loaded. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Confirmed arrangements could not be loaded. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('12 × Wireless microphones')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('[CONFLICT] [SG2-58:AC1] a response that arrives after the view has gone or switched events is discarded', async () => {
  let resolveFirst!: (response: Response) => void;
  let rejectSecond!: (error: Error) => void;
  const fetch = stub(
    () => new Promise<Response>(yes => { resolveFirst = yes; }),
    () => new Promise<Response>((_yes, no) => { rejectSecond = no; }),
    () => Response.json({ ...view, event_id: 8, equipment: [{ equipment_type: 'Projectors', quantity_reserved: 2 }] }),
  );
  const { rerender, unmount } = render(<ConfirmedArrangements eventId={7} accessToken="token" />);
  rerender(<ConfirmedArrangements eventId={7} accessToken="other-token" />);
  rerender(<ConfirmedArrangements eventId={8} accessToken="other-token" />);
  expect(await screen.findByText('2 × Projectors')).toBeVisible();
  await act(async () => { resolveFirst(Response.json(view)); rejectSecond(new TypeError('aborted')); });
  expect(screen.getByText('2 × Projectors')).toBeVisible();
  expect(screen.queryByText('12 × Wireless microphones')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/event-requests/7/confirmation', '/api/event-requests/7/confirmation', '/api/event-requests/8/confirmation']);
  unmount();
});
