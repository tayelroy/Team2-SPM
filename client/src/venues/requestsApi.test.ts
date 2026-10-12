import { afterEach, expect, test, vi } from 'vitest';
import { decideVenueRequest, fetchVenueRequests, requestVenue, withdrawVenueRequest, type VenueArrangement, type VenueRequest } from './requestsApi';

afterEach(() => { vi.unstubAllGlobals(); });

const pending: VenueRequest = { request_id: 41, event_id: 10, venue_id: 3, venue_name: 'Rooftop Terrace', status: 'pending',
  starts_at: '2030-06-15T02:00:00.000Z', ends_at: '2030-06-15T10:00:00.000Z', layout: 'banquet',
  venue_requirements: 'A bar', requester_name: 'Casey', requested_at: '2030-01-01T00:00:00.000Z', decider_name: null, decided_at: null, decision_reason: null,
  withdrawer_name: null, withdrawn_at: null };
const waiting: VenueArrangement = { state: 'in_progress', needed: 1, approved: 0, pending: 1, rejected: 0 };
const nothing: VenueArrangement = { state: 'none', needed: 0, approved: 0, pending: 0, rejected: 0 };
const values = { event_id: 10, venue_id: 3, starts_at: pending.starts_at, ends_at: pending.ends_at, layout: 'banquet' as const };

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('[NORMAL] [SG2-48:AC1] a venue is requested with a JSON POST carrying the event, venue, period and layout', async () => {
  const fetch = respond(() => Response.json({ request: pending, booking: 'allowed' }, { status: 201 }));
  expect(await requestVenue('token', values)).toEqual({ ok: true, request: pending, booking: 'allowed', conflicts: [] });
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests', {
    method: 'POST', body: JSON.stringify(values), cache: 'no-store',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }
  });
});

test('[NORMAL] [SG2-48:AC3] [SG2-82:AC5] an event\'s requests are fetched with the caller\'s token, with where its venue arrangement stands', async () => {
  const fetch = respond(() => Response.json({ requests: [pending], arrangement: waiting }));
  expect(await fetchVenueRequests('token', 10)).toEqual({ ok: true, requests: [pending], arrangement: waiting });
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests?event_id=10', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
});

test('[CONFLICT] [FAILURE] [SG2-48:AC4] refusals are explained, and a duplicate or invalid request passes on the server\'s reason', async () => {
  const unavailable = 'Venue requests are unavailable right now. Please try again.';
  const cases: [Response, string][] = [
    [Response.json({ error: 'This event already requested Rooftop Terrace for an overlapping period (request #41, pending).' }, { status: 409 }),
      'This event already requested Rooftop Terrace for an overlapping period (request #41, pending).'],
    [Response.json({ error: 'Choose a future period.' }, { status: 400 }), 'Choose a future period.'],
    [new Response(null, { status: 401 }), 'Your session has expired. Sign in again.'],
    [new Response(null, { status: 403 }), 'Your account cannot do this.'],
    [new Response(null, { status: 404 }), 'This event, venue or request is no longer available to you.'],
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

test('[BOUNDARY] [SG2-48:AC1] [SG2-48:AC3] [SG2-48:request-response-shape] a response of the wrong shape is treated as unavailable', async () => {
  const unavailable = { ok: false, error: 'Venue requests are unavailable right now. Please try again.' };
  for (const body of [{ request: pending }, { request: { request_id: 41 }, booking: 'allowed' }, { booking: 'allowed' }]) {
    respond(() => Response.json(body, { status: 201 }));
    expect(await requestVenue('token', values)).toEqual(unavailable);
  }
  for (const body of [{ requests: [{ request_id: '41', status: 'pending' }], arrangement: nothing }, { requests: 'none', arrangement: nothing }, {}]) {
    respond(() => Response.json(body));
    expect(await fetchVenueRequests('token', 10)).toEqual(unavailable);
  }
  respond(() => Response.json({ requests: [], arrangement: nothing }));
  expect(await fetchVenueRequests('token', 10)).toEqual({ ok: true, requests: [], arrangement: nothing });
});

test('[BOUNDARY] [SG2-82:AC5] a list without a well-formed arrangement is treated as unavailable', async () => {
  for (const arrangement of [undefined, null, { ...nothing, state: 'done' }, { ...nothing, approved: '0' }, { state: 'ready' }]) {
    respond(() => Response.json({ requests: [], arrangement }));
    expect(await fetchVenueRequests('token', 10)).toEqual({ ok: false, error: 'Venue requests are unavailable right now. Please try again.' });
  }
});

test('[NORMAL] [SG2-82:AC5] a withdrawal is a bodiless POST for the request, answered with the request as recorded', async () => {
  const withdrawn = { ...pending, status: 'cancelled', withdrawer_name: 'Casey', withdrawn_at: '2030-01-03T00:00:00.000Z' };
  const fetch = respond(() => Response.json({ request: withdrawn }));
  expect(await withdrawVenueRequest('coordinator-token', 41)).toEqual({ ok: true, request: withdrawn });
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests/41/withdraw', {
    method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer coordinator-token' }
  });
});

test('[CONFLICT] [FAILURE] [SG2-82:AC5] a refused withdrawal passes on the server\'s reason; a wrong reply is unavailable', async () => {
  const approved = 'This request has been approved. Release its booking instead if the event no longer needs the venue.';
  respond(() => Response.json({ error: approved }, { status: 409 }));
  expect(await withdrawVenueRequest('token', 41)).toEqual({ ok: false, error: approved });
  respond(() => Response.json({ nothing: true }));
  expect(await withdrawVenueRequest('token', 41)).toEqual({ ok: false, error: 'Venue requests are unavailable right now. Please try again.' });
  expect(await withdrawVenueRequest(null, 41)).toEqual({ ok: false, error: 'Your session has expired. Sign in again.' });
});

test('[NORMAL] [SG2-49:AC3] a decision is posted with its trimmed reason and answered with the request as recorded', async () => {
  const recorded = { ...pending, status: 'rejected', decider_name: 'Vera', decided_at: '2030-01-02T00:00:00.000Z', decision_reason: 'Rewiring' };
  const fetch = respond(() => Response.json({ request: recorded }));
  expect(await decideVenueRequest('staff-token', 41, 'reject', '  Rewiring  ')).toEqual({ ok: true, request: recorded });
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests/41/decision', {
    method: 'POST', body: JSON.stringify({ decision: 'reject', reason: 'Rewiring' }), cache: 'no-store',
    headers: { Authorization: 'Bearer staff-token', 'Content-Type': 'application/json' }
  });
  respond(() => Response.json({ request: recorded }));
  await decideVenueRequest('staff-token', 41, 'approve', '   ');
  respond(() => Response.json({ nothing: true }));
  expect(await decideVenueRequest('staff-token', 41, 'approve', '')).toEqual({ ok: false, error: 'Venue requests are unavailable right now. Please try again.' });
});
