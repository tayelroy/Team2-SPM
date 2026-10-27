import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { BookingClashes } from './BookingClashes';
import { describePeriod, eventLabel, fetchVenueClashes, type ClashBooking, type VenueClash } from './clashesApi';
import { formatSgt } from './searchApi';
import Dashboard from '../screens/Dashboard';
import HoldNotifications from '../components/HoldNotifications';
import * as inbox from '../api/notificationInboxApi';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Morning Summit and another coordinator's event sit 30 minutes apart at
 * Clash Hall, which needs 75 minutes of setup plus turnaround. */
const summit: ClashBooking = { booking_id: 11, venue_id: 1, venue_name: 'Clash Hall', event_id: 7, event_name: 'Morning Summit',
  starts_at: '2030-10-01T02:00:00.000Z', ends_at: '2030-10-01T04:00:00.000Z' };
const hidden: ClashBooking = { booking_id: 12, venue_id: 1, venue_name: 'Clash Hall', event_id: null, event_name: null,
  starts_at: '2030-10-01T04:30:00.000Z', ends_at: '2030-10-01T05:30:00.000Z' };
const clash: VenueClash = { booking: summit, clashes_with: hidden, flagged_at: '2030-01-01T00:00:00.000Z' };
const period = (booking: ClashBooking) => `${formatSgt(booking.starts_at)} – ${formatSgt(booking.ends_at)}`;

function serve(reply: () => Response | Promise<Response>) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => reply());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const list = () => screen.getByRole('region', { name: 'Clashing bookings' });

test('[NORMAL] [SG2-79:AC3] each flagged booking shows its venue, its times and the booking it clashes with', async () => {
  const fetch = serve(() => Response.json({ clashes: [clash] }));
  render(<BookingClashes accessToken="token" />);
  expect(within(list()).getByText('Checking for clashing bookings…')).toBeVisible();
  const item = await within(list()).findByRole('listitem', { name: 'Booking #11' });
  expect(within(item).getByText('Morning Summit', { selector: 'strong' })).toBeVisible();
  expect(within(item).getByText(`Clash Hall · ${period(summit)} (SGT)`)).toBeVisible();
  // AC2 is stated where the flag is shown: nothing has been changed.
  expect(within(list()).getByText(/Neither booking has been changed/)).toBeVisible();
  expect(within(item).getByText(`Clashes with another event, ${period(hidden)} (booking #12)`)).toBeVisible();
  expect(within(list()).getByText('1')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/venue-clashes', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
});

test('[BOUNDARY] [SG2-79:AC3] with nothing flagged the list says so', async () => {
  serve(() => Response.json({ clashes: [] }));
  render(<BookingClashes accessToken="token" />);
  expect(await within(list()).findByText('No bookings clash once setup and turnaround time are included.')).toBeVisible();
  expect(within(list()).queryByRole('list')).toBeNull();
});

test('[NORMAL] [SG2-79:AC3] bookings without names are still described by number', async () => {
  serve(() => Response.json({ clashes: [
    { booking: { ...summit, event_name: null, venue_name: null }, clashes_with: { ...hidden, event_id: 9 }, flagged_at: clash.flagged_at },
    { booking: { ...hidden, booking_id: 13 }, clashes_with: summit, flagged_at: clash.flagged_at }
  ] }));
  render(<BookingClashes accessToken="token" />);
  const first = await within(list()).findByRole('listitem', { name: 'Booking #11' });
  expect(within(first).getByText('Event #7', { selector: 'strong' })).toBeVisible();
  expect(within(first).getByText(/^Venue #1 · /)).toBeVisible();
  expect(within(first).getByText(/^Clashes with event #9,/)).toBeVisible();
  expect(within(list()).getByText('Booking with no event', { selector: 'strong' })).toBeVisible();
  expect([eventLabel(summit), describePeriod(summit)]).toEqual(['Morning Summit', period(summit)]);
});

test('[FAILURE] [SG2-79:AC3] expired sessions, other roles, outages and malformed replies are explained', async () => {
  const cases: [() => Response | Promise<Response>, string][] = [
    [() => new Response(null, { status: 401 }), 'Your session has expired. Sign in again.'],
    [() => new Response(null, { status: 403 }), 'Your account cannot see clashing bookings.'],
    [() => new Response(null, { status: 503 }), 'Clashing bookings are unavailable right now. Please try again.'],
    [() => Promise.reject(new TypeError('offline')), 'Clashing bookings are unavailable right now. Please try again.'],
    [() => Response.json({ clashes: [{ booking: summit }] }), 'Clashing bookings are unavailable right now. Please try again.'],
    [() => new Response('not json'), 'Clashing bookings are unavailable right now. Please try again.']
  ];
  for (const [reply, error] of cases) {
    serve(reply);
    expect(await fetchVenueClashes('token')).toEqual({ ok: false, error });
  }
  expect(await fetchVenueClashes(null)).toEqual({ ok: false, error: 'Your session has expired. Sign in again.' });
  serve(() => new Response(null, { status: 503 }));
  render(<BookingClashes accessToken="token" />);
  expect(await within(list()).findByRole('alert')).toHaveTextContent('Clashing bookings are unavailable right now.');
});

test('[NORMAL] [SG2-79:AC3] a result arriving after the list closed is ignored', async () => {
  let answer!: (response: Response) => void;
  serve(() => new Promise<Response>(resolve => { answer = resolve; }));
  const { unmount } = render(<BookingClashes accessToken="token" />);
  unmount();
  answer(Response.json({ clashes: [clash] }));
  await vi.waitFor(() => expect(screen.queryByText('Morning Summit')).toBeNull());
});

test.each([['Venue Staff', true], ['Event Coordinator', true], ['Technical Support Staff', false]] as const)(
  '[NORMAL] [SG2-79:AC3] the %s dashboard shows clashing bookings: %s', async (role, shown) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/venue-clashes' ? { clashes: [clash] } : { items: [] })));
    render(<Dashboard role={role} accessToken="token" onNavigate={vi.fn()} />);
    await screen.findByText('0 items in your work queue');
    if (shown) expect(await screen.findByRole('listitem', { name: 'Booking #11' })).toBeVisible();
    else expect(screen.queryByRole('region', { name: 'Clashing bookings' })).toBeNull();
  });

test('[NORMAL] [SG2-79:AC4] the coordinator\'s notifications show a flagged clash', async () => {
  vi.spyOn(inbox, 'loadNotificationInbox').mockResolvedValue({ ok: true, value: { notifications: [{ source: 'event', notification_id: 5, event_id: 7, read_at: null,
    kind: 'venue_booking_clash', message: 'Clash Hall: Morning Summit now clashes with another event.', created_at: '2030-01-01T00:00:00.000Z' }], unread_count: 1, next_cursor: null } });
  render(<HoldNotifications accessToken="token" />);
  (await screen.findByRole('button', { name: 'Notifications (1)' })).click();
  expect(await screen.findByText('Booking clash flagged')).toBeVisible();
  expect(screen.getByText('Clash Hall: Morning Summit now clashes with another event.')).toBeVisible();
});
