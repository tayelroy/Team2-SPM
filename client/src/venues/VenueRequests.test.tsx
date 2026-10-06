import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { EventVenueRequests, VenueRequestForm, requestedNotice } from './VenueRequests';
import type { VenueRequest } from './requestsApi';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const terrace = { venue_id: 3, name: 'Rooftop Terrace', layouts: [
  { layout: 'banquet' as const, other_description: null }, { layout: 'other' as const, other_description: 'Cocktail standing' }] };
const pending: VenueRequest = { request_id: 41, event_id: 10, venue_id: 3, venue_name: 'Rooftop Terrace', status: 'pending',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', layout: 'banquet',
  venue_requirements: 'A bar', requester_name: 'Casey Coordinator', requested_at: '2030-01-01T00:00:00.000Z' };

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
  const fetch = vi.fn(async () => Response.json({ requests: [pending, approved] }));
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
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ requests: [] })));
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
  await act(async () => reply(Response.json({ requests: [pending] })));
  expect(screen.queryByText('Rooftop Terrace')).not.toBeInTheDocument();
});
