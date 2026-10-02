import { afterEach, expect, test, vi } from 'vitest';
import { approveCapacityException, fetchEventFit, fetchRequestFit, type VenueFit } from './suitabilityApi';

afterEach(() => { vi.unstubAllGlobals(); });

const theatre: VenueFit = { venue_id: 3, name: 'Lecture Theatre', location: 'Level 2', capacity: 120,
  suitability: { suitable: false, issues: [{ kind: 'capacity', message: 'Too small.' }] } };
const exception = { exception_id: 1, approver_name: 'Vera', approver_role: 'venue_staff', expected_attendance: 150, approved_at: '2030-06-01T00:00:00.000Z' };

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

test('[NORMAL] [SG2-47:AC1] the venues for an event are fetched with the caller\'s token', async () => {
  const fetch = respond(() => Response.json({ event: {}, venues: [theatre] }));
  expect(await fetchEventFit('token', 7)).toEqual({ ok: true, venues: [theatre] });
  expect(fetch).toHaveBeenCalledWith('/api/venues/suitability?event_id=7',
    { headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
});

test('[NORMAL] [SG2-47:AC3] a booking request\'s fit is fetched, and an exception is approved with a POST', async () => {
  const fetch = respond(() => Response.json({ venue: theatre, exceptions: [], booking: 'needs_capacity_exception', request: {} }));
  expect(await fetchRequestFit('token', 31)).toEqual({ ok: true, venue: theatre, exceptions: [], booking: 'needs_capacity_exception' });
  expect(fetch.mock.calls[0][0]).toBe('/api/venue-booking-requests/31/suitability');

  const post = respond(() => Response.json({ exception, booking: 'allowed' }, { status: 201 }));
  expect(await approveCapacityException('token', 31)).toEqual({ ok: true, exception, booking: 'allowed' });
  expect(post).toHaveBeenCalledWith('/api/venue-booking-requests/31/capacity-exception',
    { method: 'POST', headers: { Authorization: 'Bearer token' }, cache: 'no-store' });
});

test('[FAILURE] [SG2-47:AC2] [SG2-47:AC3] refusals are explained, and a conflict passes on the server\'s reason', async () => {
  const cases: [Response, string][] = [
    [new Response(null, { status: 401 }), 'Your session has expired. Sign in again.'],
    [new Response(null, { status: 403 }), 'Your account cannot do this.'],
    [new Response(null, { status: 404 }), 'This event or booking request is no longer available to you.'],
    [Response.json({ error: 'No exception is permitted.' }, { status: 409 }), 'No exception is permitted.'],
    [Response.json({}, { status: 409 }), 'Venue suitability is unavailable right now. Please try again.'],
    [new Response(null, { status: 503 }), 'Venue suitability is unavailable right now. Please try again.'],
    [new Response('not json'), 'Venue suitability is unavailable right now. Please try again.']
  ];
  for (const [response, error] of cases) {
    respond(() => response);
    expect(await approveCapacityException('token', 31)).toEqual({ ok: false, error });
  }
  expect(await fetchEventFit(null, 7)).toEqual({ ok: false, error: 'Your session has expired. Sign in again.' });
  respond(() => { throw new TypeError('Failed to fetch'); });
  expect(await fetchRequestFit('token', 31)).toEqual({ ok: false, error: 'Venue suitability is unavailable right now. Please try again.' });
});

test('[FAILURE] [SG2-47:suitability-response-shape] a response of the wrong shape is treated as unavailable', async () => {
  const unavailable = { ok: false, error: 'Venue suitability is unavailable right now. Please try again.' };
  for (const body of [{ venues: [{ venue_id: 3 }] }, { venues: 'none' }, {}]) {
    respond(() => Response.json(body));
    expect(await fetchEventFit('token', 7)).toEqual(unavailable);
  }
  for (const body of [{ venue: theatre, exceptions: [] }, { venue: theatre, booking: 'allowed' }, { venue: {}, exceptions: [], booking: 'allowed' }]) {
    respond(() => Response.json(body));
    expect(await fetchRequestFit('token', 31)).toEqual(unavailable);
  }
  for (const body of [{ exception: {}, booking: 'allowed' }, { exception }]) {
    respond(() => Response.json(body));
    expect(await approveCapacityException('token', 31)).toEqual(unavailable);
  }
});
