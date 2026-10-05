import { afterEach, expect, test, vi } from 'vitest';
import { fetchVenueRequests, requestVenue, type VenueRequest } from './requestsApi';

afterEach(() => { vi.unstubAllGlobals(); });

const pending: VenueRequest = { request_id: 41, event_id: 10, venue_id: 3, venue_name: 'Rooftop Terrace', status: 'pending',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', layout: 'banquet',
  venue_requirements: 'A bar', requester_name: 'Casey', requested_at: '2030-01-01T00:00:00.000Z' };
const values = { event_id: 10, venue_id: 3, starts_at: pending.starts_at, ends_at: pending.ends_at, layout: 'banquet' as const };

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('[NORMAL] [SG2-48:AC1] a venue is requested with a JSON POST carrying the event, venue, period and layout', async () => {
  const fetch = respond(() => Response.json({ request: pending, booking: 'allowed' }, { status: 201 }));
  expect(await requestVenue('token', values)).toEqual({ ok: true, request: pending, booking: 'allowed' });
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests', {
    method: 'POST', body: JSON.stringify(values), cache: 'no-store',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }
  });
});

test('[NORMAL] [SG2-48:AC3] an event\'s requests are fetched with the caller\'s token', async () => {
  const fetch = respond(() => Response.json({ requests: [pending] }));
  expect(await fetchVenueRequests('token', 10)).toEqual({ ok: true, requests: [pending] });
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests?event_id=10', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
});

test('[CONFLICT] [FAILURE] [SG2-48:AC4] refusals are explained, and a duplicate or invalid request passes on the server\'s reason', async () => {
  const unavailable = 'Venue requests are unavailable right now. Please try again.';
  const cases: [Response, string][] = [
    [Response.json({ error: 'This event already requested Rooftop Terrace for an overlapping period (request #41, pending).' }, { status: 409 }),
      'This event already requested Rooftop Terrace for an overlapping period (request #41, pending).'],
    [Response.json({ error: 'Choose a future period.' }, { status: 400 }), 'Choose a future period.'],
    [new Response(null, { status: 401 }), 'Your session has expired. Sign in again.'],
    [new Response(null, { status: 403 }), 'Your account cannot request venues.'],
    [new Response(null, { status: 404 }), 'This event or venue is no longer available to you.'],
    [Response.json({}, { status: 409 }), unavailable],
    [new Response(null, { status: 503 }), unavailable],
    [new Response('not json', { status: 201 }), unavailable]
  ];
  for (const [response, error] of cases) {
    respond(() => response);
    expect(await requestVenue('token', values)).toEqual({ ok: false, error });
  }
  expect(await requestVenue(null, values)).toEqual({ ok: false, error: 'Your session has expired. Sign in again.' });
  respond(() => { throw new TypeError('Failed to fetch'); });
  expect(await fetchVenueRequests('token', 10)).toEqual({ ok: false, error: unavailable });
});

test('[BOUNDARY] [SG2-48:request-response-shape] a response of the wrong shape is treated as unavailable', async () => {
  const unavailable = { ok: false, error: 'Venue requests are unavailable right now. Please try again.' };
  for (const body of [{ request: pending }, { request: { request_id: 41 }, booking: 'allowed' }, { booking: 'allowed' }]) {
    respond(() => Response.json(body, { status: 201 }));
    expect(await requestVenue('token', values)).toEqual(unavailable);
  }
  for (const body of [{ requests: [{ request_id: '41', status: 'pending' }] }, { requests: 'none' }, {}]) {
    respond(() => Response.json(body));
    expect(await fetchVenueRequests('token', 10)).toEqual(unavailable);
  }
  respond(() => Response.json({ requests: [] }));
  expect(await fetchVenueRequests('token', 10)).toEqual({ ok: true, requests: [] });
});
