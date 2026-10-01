import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { BookingRequestFit, EventVenueFit, consequence } from './VenueFit';
import type { CapacityException, VenueFit } from './suitabilityApi';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const atrium: VenueFit = { venue_id: 1, name: 'Atrium Hall', location: 'Level 1', capacity: 400, suitability: { suitable: true, issues: [] } };
const theatre: VenueFit = { venue_id: 3, name: 'Lecture Theatre', location: 'Level 2', capacity: 120,
  suitability: { suitable: false, issues: [{ kind: 'capacity', message: "Expected attendance of 150 is above this venue's capacity of 120." }] } };
const seminar: VenueFit = { venue_id: 2, name: 'Seminar Room', location: null, capacity: null,
  suitability: { suitable: false, issues: [
    { kind: 'capacity', message: "Expected attendance is 150, but this venue's capacity is not recorded." },
    { kind: 'facility', message: 'Missing required facilities: projector, stage.' }
  ] } };
const approval: CapacityException = { exception_id: 1, approver_name: 'Vera', approver_role: 'venue_staff',
  expected_attendance: 150, approved_at: '2030-06-01T02:00:00.000Z' };

function api(routes: Record<string, () => Response | Promise<Response>>) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const route = Object.keys(routes).find(path => url.includes(path));
    return route ? routes[route]() : new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('SG2-47: each kind of problem says what it means for booking', () => {
  expect(consequence({ suitable: true, issues: [] })).toBeNull();
  expect(consequence(seminar.suitability)).toMatch(/^Cannot be booked: no exception is permitted/);
  expect(consequence(theatre.suitability)).toMatch(/^Can be booked only once .* approve a capacity exception/);
  expect(consequence({ suitable: false, issues: [{ kind: 'accessibility', message: 'Missing accessibility feature: ramp.' }] }))
    .toBe('Raise the missing accessibility features with the organiser before booking.');
});

test('SG2-47 AC1/AC2: venues that do not fit the event are listed with every reason', async () => {
  api({ '/api/venues/suitability?event_id=7': () => Response.json({ venues: [atrium, seminar, theatre] }) });
  render(<EventVenueFit accessToken="token" eventId={7} eventName="Leadership Forum" />);
  expect(screen.getByText('Checking how venues fit this event…')).toBeInTheDocument();
  const section = await screen.findByRole('region', { name: 'Venues that do not fit Leadership Forum' });
  expect(within(section).getByRole('heading', { name: '2 of 3 venues do not fit Leadership Forum' })).toBeInTheDocument();
  expect(within(section).queryByRole('heading', { name: 'Atrium Hall' })).not.toBeInTheDocument();
  expect(within(section).getByText('Capacity not recorded')).toBeInTheDocument();
  expect(within(section).getByText('Capacity 120')).toBeInTheDocument();
  expect(within(section).getByText('Missing required facilities: projector, stage.')).toBeInTheDocument();
  expect(within(section).getByText("Expected attendance of 150 is above this venue's capacity of 120.")).toBeInTheDocument();
});

test('SG2-47: when every venue fits it says so, and a failure is reported', async () => {
  api({ suitability: () => Response.json({ venues: [atrium] }) });
  render(<EventVenueFit accessToken="token" eventId={7} eventName="Leadership Forum" />);
  expect(await screen.findByRole('heading', { name: 'Every venue fits Leadership Forum' })).toBeInTheDocument();
  cleanup();
  api({ suitability: () => new Response(null, { status: 503 }) });
  render(<EventVenueFit accessToken="token" eventId={7} eventName="Leadership Forum" />);
  expect(await screen.findByText('Venue suitability is unavailable right now. Please try again.')).toBeInTheDocument();
});

test('SG2-47 AC3/AC5: a capacity exception is approved on the request, and the booking still needs a decision', async () => {
  const fetch = api({
    '/31/suitability': () => Response.json({ venue: theatre, exceptions: [], booking: 'needs_capacity_exception' }),
    '/31/capacity-exception': () => Response.json({ exception: approval, booking: 'allowed' }, { status: 201 })
  });
  render(<BookingRequestFit accessToken="token" requestId={31} />);
  expect(screen.getByText('Checking how this venue fits the event…')).toBeInTheDocument();
  expect(await screen.findByText("Expected attendance of 150 is above this venue's capacity of 120.")).toBeInTheDocument();
  expect(screen.getByText(/does not approve the booking/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Approve capacity exception' }));
  expect(screen.getByRole('button', { name: 'Approving…' })).toBeDisabled();
  expect(await screen.findByText(/^Capacity exception for 150 people approved by Vera \(Venue Staff\) on/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve capacity exception' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests/31/capacity-exception', expect.objectContaining({ method: 'POST' }));
});

test('SG2-47 AC2: a blocked request offers no exception, and earlier approvals are listed', async () => {
  api({ '/32/suitability': () => Response.json({ venue: seminar, exceptions: [{ ...approval, approver_name: null, approver_role: 'someone_else' }], booking: 'blocked' }) });
  render(<BookingRequestFit accessToken="token" requestId={32} />);
  expect(await screen.findByText(/^Cannot be booked: no exception is permitted/)).toBeInTheDocument();
  expect(screen.getByText(/approved by an unnamed account \(someone_else\)/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Approve capacity exception' })).not.toBeInTheDocument();
});

test('SG2-47: a fitting venue says so, and failures to load or approve are reported', async () => {
  api({ '/33/suitability': () => Response.json({ venue: atrium, exceptions: [], booking: 'allowed' }) });
  render(<BookingRequestFit accessToken="token" requestId={33} />);
  expect(await screen.findByText('This venue fits the event.')).toBeInTheDocument();
  cleanup();

  api({ '/34/suitability': () => new Response(null, { status: 404 }) });
  render(<BookingRequestFit accessToken="token" requestId={34} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('no longer available to you');
  cleanup();

  api({
    '/31/suitability': () => Response.json({ venue: theatre, exceptions: [], booking: 'needs_capacity_exception' }),
    '/31/capacity-exception': () => Response.json({ error: 'A capacity exception covering this attendance has already been approved.' }, { status: 409 })
  });
  render(<BookingRequestFit accessToken="token" requestId={31} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Approve capacity exception' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('already been approved');
  expect(screen.getByRole('button', { name: 'Approve capacity exception' })).toBeEnabled();
});

test('SG2-47: leaving before the fit loads ignores the late answer', async () => {
  const pending: ((response: Response) => void)[] = [];
  api({ suitability: () => new Promise<Response>(done => { pending.push(done); }) });
  render(<EventVenueFit accessToken="token" eventId={7} eventName="Forum" />).unmount();
  render(<BookingRequestFit accessToken="token" requestId={31} />).unmount();
  expect(pending).toHaveLength(2);
  await act(async () => { pending.forEach(resolve => resolve(new Response(null, { status: 503 }))); });
});
