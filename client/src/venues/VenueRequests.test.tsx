import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { EventVenueRequests, VenueRequestForm, arrangementSummary, requestedNotice } from './VenueRequests';
import type { VenueArrangement, VenueRequest } from './requestsApi';

/** As the server reports it, from how many of the needed venues are approved or rejected. */
function arrangement(approved: number, needed: number, rejected = 0): VenueArrangement {
  return { state: needed === 0 ? 'none' : approved === needed ? 'ready' : 'in_progress', needed, approved, pending: needed - approved - rejected, rejected };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const terrace = { venue_id: 3, name: 'Rooftop Terrace', layouts: [
  { layout: 'banquet' as const, other_description: null }, { layout: 'other' as const, other_description: 'Cocktail standing' }] };
const pending: VenueRequest = { request_id: 41, event_id: 10, venue_id: 3, venue_name: 'Rooftop Terrace', status: 'pending',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', layout: 'banquet',
  venue_requirements: 'A bar', requester_name: 'Casey Coordinator', requested_at: '2030-01-01T00:00:00.000Z', decider_name: null, decided_at: null, decision_reason: null, withdrawer_name: null, withdrawn_at: null };

function form(overrides: Partial<Parameters<typeof VenueRequestForm>[0]> = {}) {
  const props = { accessToken: 'token', eventId: 10, venue: terrace, period: { from: '2030-06-15T10:00', until: '2030-06-15T18:00' },
    layout: 'other' as const, venueRequirements: 'A bar', onRequested: vi.fn(), onCancel: vi.fn(), ...overrides };
  render(<VenueRequestForm {...props} />);
  return props;
}

const send = () => fireEvent.submit(screen.getByRole('form', { name: 'Request Rooftop Terrace' }));

test('[NORMAL] [SG2-48:AC1] the request form starts from the searched period and layout, shows the requirements it carries, and sends them', async () => {
  let reply!: (response: Response) => void;
  const fetch = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>(resolve => { reply = resolve; }));
  vi.stubGlobal('fetch', fetch);
  const { onRequested } = form();
  expect(screen.getByLabelText('Request from (Singapore time)')).toHaveValue('2030-06-15T10:00');
  expect(screen.getByLabelText('Required layout')).toHaveValue('other');
  expect(screen.getByRole('option', { name: 'Cocktail standing' })).toBeInTheDocument();
  expect(screen.getByText('A bar')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Request until (Singapore time)'), { target: { value: '2030-06-15T12:00' } });
  fireEvent.change(screen.getByLabelText('Required layout'), { target: { value: 'banquet' } });
  send();
  expect(await screen.findByRole('button', { name: 'Requesting…' })).toBeDisabled();
  await act(async () => reply(Response.json({ request: pending, booking: 'needs_capacity_exception' }, { status: 201 })));
  await vi.waitFor(() => expect(onRequested).toHaveBeenCalledWith(pending, 'needs_capacity_exception', []));
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({
    event_id: 10, venue_id: 3, layout: 'banquet', starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T04:00:00.000Z'
  });
});

test('[BOUNDARY] [SG2-48:AC1] a searched layout the venue does not offer falls back to its first, and the period must start before it ends', () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  form({ layout: 'theatre', venueRequirements: null });
  expect(screen.getByLabelText('Required layout')).toHaveValue('banquet');
  expect(screen.getByText('None recorded for this event')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Request until (Singapore time)'), { target: { value: '2030-06-15T10:00' } });
  send();
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a period that starts before it ends.');
  for (const label of ['Request from (Singapore time)', 'Request until (Singapore time)']) {
    cleanup();
    form({ layout: '' });
    fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
    send();
    expect(screen.getByRole('alert')).toBeVisible();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test('[CONFLICT] [SG2-48:AC4] a refused request explains why and leaves the form open', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(
    { error: 'This event already requested Rooftop Terrace for an overlapping period (request #41, pending).' }, { status: 409 })));
  const { onRequested, onCancel } = form();
  send();
  expect(await screen.findByRole('alert')).toHaveTextContent('already requested Rooftop Terrace');
  expect(screen.getByRole('button', { name: 'Send request' })).toBeEnabled();
  expect(onRequested).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalled();
});

test('[FAILURE] [SG2-48:AC1] a venue with no layouts recorded cannot be requested', () => {
  const { onCancel } = form({ venue: { ...terrace, layouts: [] } });
  expect(screen.getByRole('alert')).toHaveTextContent('Rooftop Terrace has no layouts recorded, so it cannot be requested yet.');
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onCancel).toHaveBeenCalled();
});

test('[NORMAL] [SG2-48:AC3] the coordinator is told the request is pending and the venue is not held', () => {
  expect(requestedNotice('Rooftop Terrace', 'allowed')).toBe(
    'Rooftop Terrace requested. It is pending until Venue Staff decide, and the venue is not held until then.');
  expect(requestedNotice('Rooftop Terrace', 'needs_capacity_exception')).toMatch(/A capacity exception must also be approved before it can be booked\.$/);
});

test('[NORMAL] [SG2-48:AC3] [SG2-48:AC4] the event\'s requests are listed, pending ones marked as awaiting Venue Staff', async () => {
  const approved = { ...pending, request_id: 42, venue_id: 9, venue_name: null, status: 'approved', layout: null, requester_name: null };
  const fetch = vi.fn(async () => Response.json({ requests: [pending, approved], arrangement: arrangement(1, 2) }));
  vi.stubGlobal('fetch', fetch);
  const { rerender } = render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  expect(screen.getByText('Loading venue requests…')).toBeVisible();
  const list = await screen.findByRole('region', { name: 'Venue requests for Meridian Forum' });
  const first = (await within(list).findByRole('heading', { name: 'Rooftop Terrace' })).parentElement!.parentElement!;
  expect(within(first).getByText('Pending')).toBeVisible();
  expect(within(first).getByText(/Banquet/)).toBeVisible();
  expect(within(first).getByText(/Awaiting a Venue Staff decision\. The venue is not held/)).toBeVisible();
  expect(within(first).getByText('Requested by Casey Coordinator')).toBeVisible();
  const second = within(list).getByRole('heading', { name: 'Venue #9' }).parentElement!.parentElement!;
  expect(within(second).getByText('Approved')).toBeVisible();
  expect(within(second).getByText(/Layout not recorded/)).toBeVisible();
  expect(within(second).queryByText(/Awaiting a Venue Staff decision/)).not.toBeInTheDocument();
  expect(within(second).getByText('Requested by an unnamed account')).toBeVisible();
  rerender(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={1} />);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});

test('[BOUNDARY] [FAILURE] [SG2-48:AC3] an event with no requests says so; an unavailable list explains why; a late reply after leaving is ignored', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ requests: [], arrangement: arrangement(0, 0) })));
  render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  expect(await screen.findByText('No venues have been requested for this event yet.')).toBeVisible();
  cleanup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
  render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  expect(await screen.findByText('Venue requests are unavailable right now. Please try again.')).toBeVisible();
  cleanup();
  let reply!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { reply = resolve; })));
  const { unmount } = render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  unmount();
  await act(async () => reply(Response.json({ requests: [pending], arrangement: arrangement(0, 1) })));
  expect(screen.queryByText('Rooftop Terrace')).not.toBeInTheDocument();
});

test('[NORMAL] [SG2-49:AC2] [SG2-49:AC3] the coordinator sees who decided each request, when, and why it was rejected', async () => {
  const rejected = { ...pending, status: 'rejected', decider_name: 'Vera Venue', decided_at: '2030-01-02T02:00:00.000Z', decision_reason: 'The hall is being rewired' };
  const approved = { ...pending, request_id: 42, venue_name: 'Quiet Room', status: 'approved', decider_name: null, decided_at: '2030-01-03T02:00:00.000Z', decision_reason: 'Bring your own projector' };
  const plain = { ...pending, request_id: 43, venue_name: 'Annex', status: 'approved', decider_name: 'Vera Venue', decided_at: '2030-01-03T02:00:00.000Z' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ requests: [rejected, approved, plain], arrangement: arrangement(2, 3, 1) })));
  render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  expect(await screen.findByText('Rejected by Vera Venue on 2 Jan 2030, 10:00 am. Reason: The hall is being rewired')).toBeVisible();
  expect(screen.getByText('Approved by an unnamed account on 3 Jan 2030, 10:00 am. Note: Bring your own projector')).toBeVisible();
  expect(screen.getByText('Approved by Vera Venue on 3 Jan 2030, 10:00 am')).toBeVisible();
  expect(screen.queryByText(/Awaiting a Venue Staff decision/)).not.toBeInTheDocument();
});

// --- SG2-82: several venues for one event ----------------------------------

test('[BOUNDARY] [SG2-82:AC5] the arrangement reads as ready only when every needed venue is approved, and says what is outstanding otherwise', () => {
  expect(arrangementSummary(arrangement(1, 1))).toBe('Venue arrangement ready: the venue is approved.');
  expect(arrangementSummary(arrangement(4, 4))).toBe('Venue arrangement ready: all 4 venues are approved.');
  expect(arrangementSummary(arrangement(0, 0))).toBe('Venue arrangement not started: no venue requests are live for this event.');
  expect(arrangementSummary(arrangement(3, 4))).toBe('Venue arrangement not ready: 3 of 4 venues approved; 1 venue awaiting Venue Staff.');
  expect(arrangementSummary(arrangement(0, 1, 1))).toBe(
    'Venue arrangement not ready: 0 of 1 venue approved; 1 venue rejected — request another venue, then withdraw the rejected request.');
  expect(arrangementSummary(arrangement(1, 5, 2))).toBe('Venue arrangement not ready: 1 of 5 venues approved; 2 venues awaiting Venue Staff; '
    + '2 venues rejected — request another venue, then withdraw the rejected request.');
});

const auditorium = { ...pending, request_id: 51, venue_id: 1, venue_name: 'Auditorium', status: 'approved', decider_name: 'Vera Venue', decided_at: '2030-01-02T02:00:00.000Z' };
const breakout = { ...pending, request_id: 52, venue_id: 2, venue_name: 'Breakout One', status: 'rejected', decider_name: 'Vera Venue',
  decided_at: '2030-01-02T02:00:00.000Z', decision_reason: 'Needs its reset time' };
const card = (list: HTMLElement, name: string) => within(list).getByRole('heading', { name }).parentElement!.parentElement!;

test('[NORMAL] [SG2-82:AC1] [SG2-82:AC4] every venue requested for the event is shown with its own status, and only live ones can be withdrawn', async () => {
  const withdrawn = { ...breakout, request_id: 53, venue_id: 3, venue_name: 'Breakout Two', status: 'cancelled',
    withdrawer_name: 'Casey Coordinator', withdrawn_at: '2030-01-03T02:00:00.000Z' };
  const released = { ...auditorium, request_id: 54, venue_id: 4, venue_name: 'Foyer', status: 'cancelled', decision_reason: null };
  const unnamed = { ...withdrawn, request_id: 55, venue_id: 6, venue_name: 'Breakout Four', decided_at: null, decision_reason: null, withdrawer_name: null };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ requests: [auditorium, breakout, pending, withdrawn, released, unnamed], arrangement: arrangement(1, 3, 1) })));
  render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  const list = await screen.findByRole('region', { name: 'Venue requests for Meridian Forum' });
  expect(await within(list).findByLabelText('Venue arrangement')).toHaveTextContent('Venue arrangement not ready: 1 of 3 venues approved;');
  expect(within(list).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
    .toEqual(['Auditorium', 'Breakout One', 'Rooftop Terrace', 'Breakout Two', 'Foyer', 'Breakout Four']);
  for (const [name, status, withdrawable] of [['Auditorium', 'Approved', false], ['Breakout One', 'Rejected', true], ['Rooftop Terrace', 'Pending', true],
    ['Breakout Two', 'Withdrawn', false], ['Foyer', 'Cancelled', false]] as const) {
    const item = card(list, name);
    expect(within(item).getByText(status, { exact: true })).toBeVisible();
    expect(within(item).queryByRole('button', { name: 'Withdraw request' }) !== null).toBe(withdrawable);
  }
  // A withdrawn request keeps its earlier rejection; a released one its approval.
  const second = card(list, 'Breakout Two');
  expect(within(second).getByText('Rejected by Vera Venue on 2 Jan 2030, 10:00 am. Reason: Needs its reset time')).toBeVisible();
  expect(within(second).getByText('Withdrawn by Casey Coordinator on 3 Jan 2030, 10:00 am')).toBeVisible();
  expect(within(card(list, 'Foyer')).getByText('Approved by Vera Venue on 2 Jan 2030, 10:00 am')).toBeVisible();
  expect(within(card(list, 'Breakout Four')).getByText('Withdrawn by an unnamed account on 3 Jan 2030, 10:00 am')).toBeVisible();
});

test('[NORMAL] [SG2-82:AC5] the coordinator withdraws a rejected venue after confirming; the list reloads and the arrangement becomes ready', async () => {
  let reply!: (response: Response) => void;
  let listed = 0;
  const fetch = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return new Promise<Response>(resolve => { reply = resolve; });
    listed += 1;
    return Promise.resolve(listed === 1
      ? Response.json({ requests: [auditorium, breakout], arrangement: arrangement(1, 2, 1) })
      : Response.json({ requests: [auditorium, { ...breakout, status: 'cancelled', withdrawer_name: 'Casey Coordinator', withdrawn_at: '2030-01-03T02:00:00.000Z' }],
        arrangement: arrangement(1, 1) }));
  });
  vi.stubGlobal('fetch', fetch);
  render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  const list = await screen.findByRole('region', { name: 'Venue requests for Meridian Forum' });
  const item = await within(list).findByRole('heading', { name: 'Breakout One' }).then(heading => heading.parentElement!.parentElement!);
  // Keeping the request backs out without sending anything.
  fireEvent.click(within(item).getByRole('button', { name: 'Withdraw request' }));
  fireEvent.click(within(item).getByRole('button', { name: 'Keep request' }));
  expect(within(item).queryByRole('group')).not.toBeInTheDocument();
  fireEvent.click(within(item).getByRole('button', { name: 'Withdraw request' }));
  const confirm = within(item).getByRole('group', { name: 'Withdraw Breakout One' });
  expect(confirm).toHaveTextContent('The event will no longer need Breakout One, so it stops holding the venue arrangement back.');
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm withdrawal' }));
  expect(within(confirm).getByRole('button', { name: 'Withdrawing…' })).toBeDisabled();
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests/52/withdraw', expect.objectContaining({ method: 'POST' }));
  await act(async () => reply(Response.json({ request: { ...breakout, status: 'cancelled' } })));
  expect(await within(list).findByRole('status')).toHaveTextContent(
    "Breakout One withdrawn. It no longer counts towards this event's venues, and it can be requested again.");
  expect(await within(list).findByText('Venue arrangement ready: the venue is approved.')).toBeVisible();
  expect(within(card(list, 'Breakout One')).getByText('Withdrawn', { exact: true })).toBeVisible();
  expect(listed).toBe(2);
});

test('[CONFLICT] [FAILURE] [SG2-82:AC5] a withdrawal refused by the server explains why and leaves the request in place', async () => {
  const unnamed = { ...pending, venue_name: null };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
    ? Response.json({ error: 'This request has been approved. Release its booking instead if the event no longer needs the venue.' }, { status: 409 })
    : Response.json({ requests: [unnamed], arrangement: arrangement(0, 1) })));
  render(<EventVenueRequests accessToken="token" eventId={10} eventName="Meridian Forum" refresh={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));
  const confirm = screen.getByRole('group', { name: 'Withdraw Venue #3' });
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm withdrawal' }));
  expect(await within(confirm).findByRole('alert')).toHaveTextContent('This request has been approved. Release its booking instead');
  expect(within(confirm).getByRole('button', { name: 'Confirm withdrawal' })).toBeEnabled();
  expect(screen.getByText('Pending', { exact: true })).toBeVisible();
  // Backing out clears the refusal.
  fireEvent.click(within(confirm).getByRole('button', { name: 'Keep request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
  expect(within(screen.getByRole('group', { name: 'Withdraw Venue #3' })).queryByRole('alert')).not.toBeInTheDocument();
});
