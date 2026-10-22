import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import VenueBookings, { EventVenueBookings } from './VenueBookings';
import Venues from '../screens/Venues';
import { fetchEventBookings, fetchVenueBookings, releaseBooking, type VenueBooking } from './bookingsApi';
import { formatSgt } from './searchApi';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** The summit holds two venues (Week 7 change #3). */
const hall: VenueBooking = { booking_id: 11, venue_id: 1, venue_name: 'Atrium Hall', event_id: 7, event_name: 'Leadership Summit',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', status: 'confirmed',
  cancelled_at: null, cancellation_reason: null, canceller_name: null, affected_by: [], replacement: null };
const annex: VenueBooking = { ...hall, booking_id: 12, venue_id: 2, venue_name: 'Annex' };
const releasedHall: VenueBooking = { ...hall, status: 'cancelled', cancelled_at: '2030-01-02T01:00:00.000Z',
  cancellation_reason: 'The workshop moved online', canceller_name: 'Casey Coordinator' };
const period = `${formatSgt(hall.starts_at)} – ${formatSgt(hall.ends_at)}`;
/** What the server answers for a release (SG2-83: and what went with it). */
const done = (extra: Record<string, unknown> = {}) => ({ booking_id: 11, status: 'cancelled', cancelled_at: '2030-01-02T01:00:00.000Z',
  cancellation_reason: 'The workshop moved online', also_released: [], returned_to_planning: false, ...extra });
const NOTIFIED = 'available again, and the Event Organiser and Venue Staff have been notified.';

type Reply = (url: string, init?: RequestInit) => Response | Promise<Response>;
function serve(reply: Reply) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => reply(url, init));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const list = () => screen.getByRole('region', { name: 'Booked venues for Leadership Summit' });
const item = (id: number) => within(list()).getByRole('listitem', { name: `Booking #${id}` });

test('[NORMAL] [SG2-51:AC1] [SG2-51:AC3] [SG2-51:AC5] the coordinator releases one of two venues with a reason; the other stays booked', async () => {
  let released = false;
  const fetch = serve((_url, init) => {
    if (init?.method === 'POST') {
      released = true;
      return Response.json(done());
    }
    return Response.json({ bookings: released ? [releasedHall, annex] : [hall, annex] });
  });
  const onReleased = vi.fn();
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} onReleased={onReleased} />);
  expect(await within(list()).findAllByRole('listitem')).toHaveLength(2);
  expect(within(item(12)).getByText('Confirmed')).toBeVisible();
  fireEvent.click(within(item(11)).getByRole('button', { name: 'Release booking' }));
  fireEvent.change(within(item(11)).getByLabelText('Reason for releasing'), { target: { value: '  The workshop moved online ' } });
  // SG2-83 AC2: the event's other venue is offered, unticked.
  expect(within(item(11)).getByRole('checkbox', { name: `Annex · ${period} · Booking #12` })).not.toBeChecked();
  fireEvent.click(within(item(11)).getByRole('button', { name: 'Confirm release' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    `Atrium Hall released for ${period}. It is ${NOTIFIED} The event's other venues are unchanged.`);
  expect(await within(item(11)).findByText('Released')).toBeVisible();
  expect(within(item(11)).getByText(`Released by Casey Coordinator on ${formatSgt('2030-01-02T01:00:00.000Z')}: The workshop moved online`)).toBeVisible();
  expect(within(item(11)).queryByRole('button', { name: 'Release booking' })).toBeNull();
  expect(within(item(12)).getByText('Confirmed')).toBeVisible();
  // The page refreshes the event's requests, where the request now shows as cancelled.
  expect(onReleased).toHaveBeenCalledTimes(1);
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(post[0]).toBe('/api/venue-bookings/11/release');
  expect(JSON.parse(post[1]!.body as string)).toEqual({ reason: 'The workshop moved online', also_cancel: [] });
  expect(fetch).toHaveBeenCalledWith('/api/venue-bookings?event_id=7', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
});

test('[BOUNDARY] [SG2-51:AC1] a release without a reason is stopped before sending; the reason is capped at 500 characters', async () => {
  const fetch = serve(() => Response.json({ bookings: [hall] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Release booking' }));
  expect(screen.getByLabelText('Reason for releasing')).toHaveAttribute('maxLength', '500');
  fireEvent.change(screen.getByLabelText('Reason for releasing'), { target: { value: '   ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Give a reason for releasing this booking. The Event Organiser and Venue Staff will see it.');
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  // Keeping the booking closes the form without releasing.
  fireEvent.click(screen.getByRole('button', { name: 'Keep booking' }));
  expect(screen.queryByLabelText('Reason for releasing')).toBeNull();
});

test('[CONFLICT] [SG2-51:AC1] a release refused by the server is explained and the booking stays listed as confirmed', async () => {
  serve((_url, init) => init?.method === 'POST'
    ? Response.json({ error: 'This booking has already been released.' }, { status: 409 })
    : Response.json({ bookings: [hall] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Release booking' }));
  fireEvent.change(screen.getByLabelText('Reason for releasing'), { target: { value: 'Duplicate' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This booking has already been released.');
  expect(within(item(11)).getByText('Confirmed')).toBeVisible();
});

test('[BOUNDARY] [SG2-51:AC1] a booking that has already ended, or one with an unknown status, cannot be released', async () => {
  serve(() => Response.json({ bookings: [
    { ...hall, starts_at: '2020-06-15T02:00:00.000Z', ends_at: '2020-06-15T10:00:00.000Z' },
    { ...annex, status: 'held' }
  ] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(await within(list()).findAllByRole('listitem')).toHaveLength(2);
  expect(within(list()).queryByRole('button', { name: 'Release booking' })).toBeNull();
  expect(within(item(12)).getByText('held')).toBeVisible();
});

test('[NORMAL] [SG2-51:AC2] Venue Staff see a venue\'s upcoming bookings by event and go back to the catalogue', async () => {
  const fetch = serve(() => Response.json({ bookings: [hall, { ...annex, event_id: null, event_name: null }, { ...annex, booking_id: 13, event_id: 9, event_name: null }] }));
  const onClose = vi.fn();
  render(<VenueBookings token="token" venue={{ venue_id: 1, name: 'Atrium Hall' } as never} onClose={onClose} />);
  const upcoming = screen.getByRole('region', { name: 'Upcoming bookings for Atrium Hall' });
  expect((await within(upcoming).findAllByRole('listitem')).map(entry => entry.firstElementChild!.firstElementChild!.textContent))
    .toEqual(['Leadership Summit', 'No event recorded', 'Event #9']);
  expect(fetch).toHaveBeenCalledWith('/api/venue-bookings?venue_id=1', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
  fireEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
  expect(onClose).toHaveBeenCalled();
});

test('[BOUNDARY] [SG2-51:AC1] with no bookings each list says so', async () => {
  serve(() => Response.json({ bookings: [] }));
  render(<VenueBookings token="token" venue={{ venue_id: 1, name: 'Atrium Hall' } as never} onClose={vi.fn()} />);
  expect(await screen.findByText('No upcoming bookings for Atrium Hall.')).toBeVisible();
  cleanup();
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(await screen.findByText('No venues are booked for this event yet.')).toBeVisible();
});

test('[FAILURE] [SG2-51:AC1] bookings that cannot be loaded are explained, and a late answer after closing is ignored', async () => {
  serve(() => new Response(null, { status: 503 }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(await screen.findByText('Venue bookings are unavailable right now. Please try again.')).toBeVisible();
  cleanup();
  let answer!: (response: Response) => void;
  serve(() => new Promise<Response>(resolve => { answer = resolve; }));
  const { unmount } = render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading bookings…');
  unmount();
  answer(Response.json({ bookings: [hall] }));
  await vi.waitFor(() => expect(screen.queryByText('Atrium Hall')).toBeNull());
});

test('[FAILURE] [SG2-51:AC1] expired sessions, other roles, missing records, network errors and malformed replies are explained', async () => {
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => new Response(null, { status: 401 }), 'Your session has expired. Sign in again.'],
    [() => new Response(null, { status: 403 }), 'Your account cannot manage these venue bookings.'],
    [() => Response.json({ error: 'Event not found.' }, { status: 404 }), 'Event not found.'],
    [() => new Response('not json', { status: 404 }), 'Venue bookings are unavailable right now. Please try again.'],
    [() => Promise.reject(new TypeError('offline')), 'Venue bookings are unavailable right now. Please try again.'],
    [() => Response.json({ bookings: [{ booking_id: 'x' }] }), 'Venue bookings are unavailable right now. Please try again.'],
    [() => Response.json({}), 'Venue bookings are unavailable right now. Please try again.']
  ];
  for (const [reply, error] of cases) {
    serve(reply);
    expect(await fetchEventBookings('token', 7)).toEqual({ ok: false, error });
  }
  expect(await fetchVenueBookings(null, 1)).toEqual({ ok: false, error: 'Your session has expired. Sign in again.' });
  serve(() => Response.json({ booking_id: 11, status: 'confirmed' }));
  expect(await releaseBooking('token', 11, 'x')).toEqual({ ok: false, error: 'Venue bookings are unavailable right now. Please try again.' });
  // SG2-83: a reply that does not say what went with the release, or whether the event moved, is not trusted.
  for (const reply of [{ ...done(), also_released: undefined }, { ...done(), returned_to_planning: 'yes' }]) {
    serve(() => Response.json(reply));
    expect(await releaseBooking('token', 11, 'x')).toEqual({ ok: false, error: 'Venue bookings are unavailable right now. Please try again.' });
  }
});

test('[CONFLICT] [SG2-51:AC1] pressing Confirm release twice sends one release', async () => {
  let answer!: (response: Response) => void;
  const fetch = serve((_url, init) => init?.method === 'POST' ? new Promise<Response>(resolve => { answer = resolve; }) : Response.json({ bookings: [hall] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Release booking' }));
  fireEvent.change(screen.getByLabelText('Reason for releasing'), { target: { value: 'Moved online' } });
  const form = screen.getByRole('form', { name: 'Release booking #11' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(await screen.findByRole('button', { name: 'Releasing…' })).toBeDisabled();
  answer(Response.json(done({ cancellation_reason: 'Moved online' })));
  await screen.findByText(/released for/);
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

test('[NORMAL] [SG2-51:AC5] a booking with no venue or releaser name is still described, and its release is announced', async () => {
  const unnamed = { ...hall, venue_name: null };
  let released = false;
  serve((_url, init) => {
    if (init?.method === 'POST') { released = true; return Response.json(done({ cancelled_at: 'x', cancellation_reason: 'Gone' })); }
    return Response.json({ bookings: released
      ? [{ ...unnamed, status: 'cancelled', cancelled_at: null, cancellation_reason: 'Gone', canceller_name: null }] : [unnamed] });
  });
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(await within(list()).findByText('Venue #1')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Release booking' }));
  fireEvent.change(screen.getByLabelText('Reason for releasing'), { target: { value: 'Gone' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
  expect(await screen.findByRole('status')).toHaveTextContent(`Venue #1 released for ${period}. It is ${NOTIFIED}`);
  // With no other venue there is nothing to say about the others.
  expect(screen.getByRole('status')).not.toHaveTextContent('other venues');
  expect(await within(list()).findByText('Released by an unnamed account: Gone')).toBeVisible();
});

test('[NORMAL] [SG2-51:AC1] Venue Staff open a venue\'s bookings from the catalogue and come back', async () => {
  serve(url => url === '/api/auth/me'
    ? Response.json({ userId: 'staff', role: 'venue_staff', permissions: ['venues.read', 'venue_bookings.by_venue'] })
    : url.startsWith('/api/venue-bookings') ? Response.json({ bookings: [hall] })
      : Response.json({ venues: [{ venue_id: 1, name: 'Atrium Hall', location: null, capacity: 100, facilities: null, accessibility_features: null, operating_information: null }] }));
  render(<Venues accessToken="token" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Bookings for Atrium Hall' }));
  expect(await screen.findByRole('heading', { name: 'Bookings for Atrium Hall' })).toBeVisible();
  expect(await screen.findByText('Leadership Summit')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Back to catalogue' }));
  expect(await screen.findByRole('button', { name: 'Bookings for Atrium Hall' })).toBeVisible();
});

test('[FAILURE] [SG2-83:AC5] [SG2-83:AC6] Venue Staff listing a venue\'s bookings are not offered a release, and are pointed to marking the venue unavailable', async () => {
  const fetch = serve(() => Response.json({ bookings: [hall, { ...annex, event_id: null, event_name: null }] }));
  render(<VenueBookings token="token" venue={{ venue_id: 2, name: 'Annex' } as never} onClose={vi.fn()} />);
  expect(await screen.findAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Release booking' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Change venue' })).toBeNull();
  expect(screen.getByText(/Only the event.s coordinator cancels or changes a booking/)).toHaveTextContent('mark it unavailable for that period instead');
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});

// --- SG2-83: change or cancel one venue of a multi-venue event -------------------

const theatre: VenueBooking = { ...hall, booking_id: 13, venue_id: 3, venue_name: 'Lecture Theatre' };

test('[NORMAL] [SG2-83:AC2] the coordinator ticks other venues to cancel with this one; only those go', async () => {
  const fetch = serve((_url, init) => init?.method === 'POST'
    ? Response.json(done({ also_released: [13] }))
    : Response.json({ bookings: [hall, annex, theatre, { ...releasedHall, booking_id: 14 }] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  fireEvent.click(within(await screen.findByRole('listitem', { name: 'Booking #11' })).getByRole('button', { name: 'Release booking' }));
  // Only the event's other current venues are offered.
  expect(within(item(11)).getAllByRole('checkbox')).toHaveLength(2);
  const annexBox = within(item(11)).getByRole('checkbox', { name: /^Annex/ });
  fireEvent.click(annexBox);
  fireEvent.click(annexBox);
  fireEvent.click(within(item(11)).getByRole('checkbox', { name: /^Lecture Theatre/ }));
  fireEvent.change(within(item(11)).getByLabelText('Reason for releasing'), { target: { value: 'Moved online' } });
  fireEvent.click(within(item(11)).getByRole('button', { name: 'Confirm release' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    `Atrium Hall released for ${period}, with 1 other venue. They are ${NOTIFIED} The event's other venues are unchanged.`);
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!;
  expect(JSON.parse(post[1]!.body as string)).toEqual({ reason: 'Moved online', also_cancel: [13] });
});

test('[NORMAL] [SG2-83:AC7] cancelling every venue of a Confirmed event says it is back in Planning', async () => {
  serve((_url, init) => init?.method === 'POST'
    ? Response.json(done({ also_released: [12, 13], returned_to_planning: true }))
    : Response.json({ bookings: [hall, annex, theatre] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  fireEvent.click(within(await screen.findByRole('listitem', { name: 'Booking #11' })).getByRole('button', { name: 'Release booking' }));
  for (const box of within(item(11)).getAllByRole('checkbox')) fireEvent.click(box);
  fireEvent.change(within(item(11)).getByLabelText('Reason for releasing'), { target: { value: 'Cancelled' } });
  fireEvent.click(within(item(11)).getByRole('button', { name: 'Confirm release' }));
  expect(await screen.findByRole('status')).toHaveTextContent(
    `Atrium Hall released for ${period}, with 2 other venues. They are ${NOTIFIED} The event is back in Planning: recheck its venues before it is confirmed again.`);
});

test('[NORMAL] [SG2-83:AC1] the coordinator can change one venue that is not affected; a change already asked for is shown instead', async () => {
  serve(() => Response.json({ bookings: [hall, { ...annex, replacement: { request_id: 90, venue_name: 'Lecture Theatre' } },
    { ...theatre, replacement: { request_id: 91, venue_name: null } }] }));
  const onFindReplacement = vi.fn();
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} onFindReplacement={onFindReplacement} />);
  fireEvent.click(within(await screen.findByRole('listitem', { name: 'Booking #11' })).getByRole('button', { name: 'Change venue' }));
  expect(onFindReplacement).toHaveBeenCalledWith(expect.objectContaining({ booking_id: 11 }));
  expect(within(item(12)).getByText('Change requested: Lecture Theatre, awaiting Venue Staff. This booking stays until then.')).toBeVisible();
  expect(within(item(13)).getByText('Change requested: request #91, awaiting Venue Staff. This booking stays until then.')).toBeVisible();
  expect(within(item(12)).queryByRole('button', { name: 'Change venue' })).toBeNull();
  // Each can still be released on its own.
  expect(within(item(12)).getByRole('button', { name: 'Release booking' })).toBeVisible();
});

test('[BOUNDARY] [SG2-83:AC1] without a way to search, or for an affected booking, no Change venue is offered', async () => {
  serve(() => Response.json({ bookings: [hall, affectedHallFor(12)] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(await within(list()).findAllByRole('listitem')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Change venue' })).toBeNull();
  cleanup();
  serve(() => Response.json({ bookings: [affectedHallFor(12)] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} onFindReplacement={vi.fn()} />);
  expect(await screen.findByRole('button', { name: 'Find a replacement venue' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Change venue' })).toBeNull();
});

// --- SG2-81: a venue that has become unavailable ---------------------------------

const disruption = { starts_at: '2030-06-15T00:00:00.000Z', ends_at: '2030-06-16T00:00:00.000Z', category: 'equipment_failure', reason: 'Air conditioning failed' };
const affectedHall: VenueBooking = { ...hall, affected_by: [disruption] };
function affectedHallFor(bookingId: number): VenueBooking { return { ...affectedHall, booking_id: bookingId }; }

test('[NORMAL] [SG2-81:AC1] [SG2-81:AC2] an affected booking says the venue is unavailable, for when and why, and that alternatives are required', async () => {
  serve(() => Response.json({ bookings: [affectedHall, annex] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} onFindReplacement={vi.fn()} />);
  await within(list()).findAllByRole('listitem');
  const alert = within(item(11)).getByRole('alert', { name: 'Booking #11 is affected by venue unavailability' });
  expect(alert).toHaveTextContent('Venue unavailable');
  expect(alert).toHaveTextContent(`${formatSgt(disruption.starts_at)} – ${formatSgt(disruption.ends_at)} · Equipment failure: Air conditioning failed`);
  expect(alert).toHaveTextContent('Alternative venue arrangements are required for this booking.');
  // The event\'s other venue is unaffected and says nothing of the kind.
  expect(within(item(12)).queryByRole('alert')).toBeNull();
  // Nothing about the booking itself has changed: it is still confirmed and releasable.
  expect(within(item(11)).getByText('Confirmed')).toBeVisible();
  expect(within(item(11)).getByRole('button', { name: 'Release booking' })).toBeVisible();
});

test('[NORMAL] [SG2-81:AC4] the coordinator can start looking for a replacement from the affected booking', async () => {
  serve(() => Response.json({ bookings: [affectedHall, annex] }));
  const onFindReplacement = vi.fn();
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} onFindReplacement={onFindReplacement} />);
  await within(list()).findAllByRole('listitem');
  expect(within(item(12)).queryByRole('button', { name: 'Find a replacement venue' })).toBeNull();
  fireEvent.click(within(item(11)).getByRole('button', { name: 'Find a replacement venue' }));
  expect(onFindReplacement).toHaveBeenCalledWith(expect.objectContaining({ booking_id: 11, venue_id: 1 }));
});

test('[CONFLICT] [SG2-81:AC4] a replacement already requested is shown instead of offering another, and without a way to search the booking is only reported', async () => {
  serve(() => Response.json({ bookings: [{ ...affectedHall, replacement: { request_id: 90, venue_name: 'Lecture Theatre' } }] }));
  const { unmount } = render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} onFindReplacement={vi.fn()} />);
  expect(await within(list()).findByText('Replacement requested: Lecture Theatre, awaiting Venue Staff.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Find a replacement venue' })).toBeNull();
  unmount();
  serve(() => Response.json({ bookings: [{ ...affectedHall, replacement: { request_id: 91, venue_name: null } }] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(await within(list()).findByText('Replacement requested: request #91, awaiting Venue Staff.')).toBeVisible();
  cleanup();
  serve(() => Response.json({ bookings: [affectedHall] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} />);
  expect(await within(list()).findByRole('alert')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Find a replacement venue' })).toBeNull();
});

test('[BOUNDARY] [SG2-81:AC5] once the affected booking is released, or an unrecognised category comes back, nothing is flagged as needing a replacement', async () => {
  serve(() => Response.json({ bookings: [{ ...releasedHall, affected_by: [disruption] }, { ...annex, affected_by: [{ ...disruption, category: 'flood' }] }] }));
  render(<EventVenueBookings accessToken="token" eventId={7} eventName="Leadership Summit" refresh={0} onFindReplacement={vi.fn()} />);
  await within(list()).findAllByRole('listitem');
  expect(within(item(11)).queryByRole('alert')).toBeNull();
  expect(within(item(12)).getByRole('alert')).toHaveTextContent('flood: Air conditioning failed');
});

test('[NORMAL] [SG2-81:AC1] Venue Staff listing a venue\'s bookings see which are affected but are not offered a replacement search', async () => {
  serve(() => Response.json({ bookings: [affectedHall] }));
  const venue = { venue_id: 1, name: 'Atrium Hall' } as never;
  render(<VenueBookings token="token" venue={venue} onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Air conditioning failed');
  expect(screen.queryByRole('button', { name: 'Find a replacement venue' })).toBeNull();
});

test('[BOUNDARY] [SG2-81:AC1] a booking answered without unavailability or replacement details reads as unaffected, and ones given are kept as sent', async () => {
  const { affected_by: _a, replacement: _r, ...older } = hall;
  serve(() => Response.json({ bookings: [older, affectedHall] }));
  const result = await fetchEventBookings('token', 7);
  expect(result).toEqual({ ok: true, bookings: [{ ...older, affected_by: [], replacement: null }, affectedHall] });
});
