import '@testing-library/jest-dom/vitest';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { BookingRequestConflicts } from './BookingConflicts';
import { requestedNotice } from './VenueRequests';
import { describeConflict, fetchRequestConflicts, requestVenue, type VenueConflict, type VenueRequest } from './requestsApi';
import { formatSgt } from './searchApi';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const gala: VenueConflict = { kind: 'booking', reference_id: 12, event_id: 9, event_name: 'Gala Night',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', status: 'confirmed' };
const hidden: VenueConflict = { kind: 'hold', reference_id: 3, event_id: null, event_name: null,
  starts_at: '2030-06-15T09:00:00.000Z', ends_at: '2030-06-15T12:00:00.000Z', status: 'tentative' };
const galaText = `Confirmed booking #12 for Gala Night, ${formatSgt(gala.starts_at)} – ${formatSgt(gala.ends_at)}`;
const hiddenText = `Tentative hold #3 for another event, ${formatSgt(hidden.starts_at)} – ${formatSgt(hidden.ends_at)}`;

const pending: VenueRequest = { request_id: 41, event_id: 7, venue_id: 1, venue_name: 'Atrium Hall', status: 'pending',
  starts_at: '2030-06-15T08:00:00.000Z', ends_at: '2030-06-15T11:00:00.000Z', layout: 'theatre',
  venue_requirements: null, requester_name: 'Casey', requested_at: '2030-01-01T00:00:00.000Z' };

function respond(response: () => Response | Promise<Response>) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const panel = () => screen.getByRole('region', { name: 'Booking conflicts' });

test('[NORMAL] [SG2-50:AC1] [SG2-50:AC2] Venue Staff see each booking and hold the request overlaps, and that it cannot be approved while they stand', async () => {
  const fetch = respond(() => Response.json({ request_id: 41, status: 'pending', conflicts: [gala, hidden] }));
  render(<BookingRequestConflicts accessToken="token" requestId={41} />);
  expect(within(panel()).getByText('Checking for overlapping bookings…')).toBeVisible();
  const items = await within(panel()).findAllByRole('listitem');
  expect(items.map(item => item.textContent)).toEqual([galaText, hiddenText]);
  expect(within(panel()).getByText('This request cannot be approved while these conflicts stand.')).toBeVisible();
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests/41/conflicts', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
});

test('[BOUNDARY] [SG2-50:AC1] one conflict is described in the singular, and none says the venue is free over the period', async () => {
  respond(() => Response.json({ conflicts: [gala] }));
  const { unmount } = render(<BookingRequestConflicts accessToken="token" requestId={41} />);
  expect(await within(panel()).findByText('This request cannot be approved while this conflict stands.')).toBeVisible();
  unmount();
  respond(() => Response.json({ conflicts: [] }));
  render(<BookingRequestConflicts accessToken="token" requestId={42} />);
  expect(await within(panel()).findByText('Nothing else is booked at this venue over the requested period.')).toBeVisible();
  expect(within(panel()).queryByRole('list')).toBeNull();
});

test('[FAILURE] [SG2-50:AC1] a failed or malformed check says so instead of claiming the venue is free', async () => {
  for (const response of [() => new Response(null, { status: 503 }), () => Response.json({ conflicts: [{ reference_id: 'x' }] }), () => Response.json({})]) {
    respond(response);
    const { unmount } = render(<BookingRequestConflicts accessToken="token" requestId={41} />);
    expect(await within(panel()).findByText('Venue requests are unavailable right now. Please try again.')).toBeVisible();
    expect(within(panel()).queryByText(/Nothing else is booked/)).toBeNull();
    unmount();
  }
  render(<BookingRequestConflicts accessToken={null} requestId={41} />);
  expect(await within(panel()).findByText('Your session has expired. Sign in again.')).toBeVisible();
});

test('[NORMAL] [SG2-50:AC1] a result arriving after the panel closed is ignored', async () => {
  let reply!: (response: Response) => void;
  respond(() => new Promise<Response>(resolve => { reply = resolve; }));
  const { unmount } = render(<BookingRequestConflicts accessToken="token" requestId={41} />);
  unmount();
  reply(Response.json({ conflicts: [gala] }));
  await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Booking conflicts' })).toBeNull());
});

test('[NORMAL] [SG2-50:AC1] the coordinator is told when a new request overlaps a booking, by number and period', async () => {
  respond(() => Response.json({ request: pending, booking: 'allowed', conflicts: [gala] }, { status: 201 }));
  const result = await requestVenue('token', { event_id: 7, venue_id: 1, layout: 'theatre', starts_at: pending.starts_at, ends_at: pending.ends_at });
  expect(result).toEqual({ ok: true, request: pending, booking: 'allowed', conflicts: [gala] });
  expect(requestedNotice('Atrium Hall', 'allowed', [gala, hidden])).toBe('Atrium Hall requested. It is pending until Venue Staff decide, and the venue is not held until then.'
    + ` It overlaps ${galaText}; ${hiddenText}, so it cannot be approved while that conflict stands.`);
  expect(requestedNotice('Atrium Hall', 'needs_capacity_exception', [gala])).toMatch(/approved before it can be booked\. It overlaps Confirmed booking #12/);
  expect(requestedNotice('Atrium Hall', 'allowed', [])).not.toMatch(/overlaps/);
});

test('[FAILURE] [SG2-50:AC1] a request reply with malformed conflicts is treated as unavailable', async () => {
  respond(() => Response.json({ request: pending, booking: 'allowed', conflicts: 'none' }, { status: 201 }));
  expect(await requestVenue('token', { event_id: 7, venue_id: 1, layout: 'theatre', starts_at: pending.starts_at, ends_at: pending.ends_at }))
    .toEqual({ ok: false, error: 'Venue requests are unavailable right now. Please try again.' });
  respond(() => Response.json({ conflicts: [gala] }));
  expect(await fetchRequestConflicts('token', 41)).toEqual({ ok: true, conflicts: [gala] });
});

test('[NORMAL] [SG2-50:AC1] a held booking and one whose event has no name are still described by number', () => {
  expect(describeConflict({ ...gala, status: 'held', event_name: null })).toBe(`Held booking #12 for event #9, ${formatSgt(gala.starts_at)} – ${formatSgt(gala.ends_at)}`);
});
