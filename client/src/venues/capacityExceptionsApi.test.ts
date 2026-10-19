import { afterEach, expect, test, vi } from 'vitest';
import { fetchCapacityExceptions } from './capacityExceptionsApi';

const request = { request_id: 18, event_id: 22, event_name: 'QA forum', venue_name: 'Small hall',
  starts_at: '2030-11-23T03:00:00Z', ends_at: '2030-11-23T04:00:00Z', expected_attendance: 14, venue_capacity: 10, booked: false };
afterEach(() => vi.unstubAllGlobals());

test('[NORMAL] [SG2-47:AC3] capacity approvers read the scoped pending list with their bearer session and no cached response', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ requests: [request] })); vi.stubGlobal('fetch', fetch);
  expect(await fetchCapacityExceptions('token')).toEqual({ ok: true, requests: [request] });
  expect(fetch).toHaveBeenCalledWith('/api/venue-booking-requests/capacity-exceptions', {
    headers: { Authorization: 'Bearer token' }, cache: 'no-store'
  });
});

test('[BOUNDARY] [SG2-47:AC3] [SG2-66:AC2] an empty list, a venue with unrecorded capacity and a booked venue remain usable without inventing a capacity', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ requests: [] }))
    .mockResolvedValueOnce(Response.json({ requests: [{ ...request, venue_capacity: null }, { ...request, request_id: 19, booked: true }] })));
  expect(await fetchCapacityExceptions('token')).toEqual({ ok: true, requests: [] });
  expect(await fetchCapacityExceptions('token')).toEqual({ ok: true, requests: [{ ...request, venue_capacity: null }, { ...request, request_id: 19, booked: true }] });
});

test('[FAILURE] [SG2-47:AC3] a missing session refuses the capacity list locally without sending an anonymous request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await fetchCapacityExceptions(null)).toEqual({ ok: false, error: 'Your session has expired. Sign in again.' });
  expect(fetch).not.toHaveBeenCalled();
});

test('[FAILURE] [SG2-47:AC3] expired and forbidden sessions receive distinct actionable messages without trusting server data', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response('', { status: 403 })));
  expect(await fetchCapacityExceptions('token')).toEqual({ ok: false, error: 'Your session has expired. Sign in again.' });
  expect(await fetchCapacityExceptions('token')).toEqual({ ok: false, error: 'Your account cannot approve capacity exceptions.' });
});

test('[FAILURE] [SG2-47:AC3] unavailable network, failed HTTP and invalid JSON never become an empty eligible list', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('not-json')));
  for (let i = 0; i < 3; i++) expect(await fetchCapacityExceptions('token')).toEqual({ ok: false, error: 'Capacity exception requests are unavailable right now. Please try again.' });
});

test('[FAILURE] [SG2-47:AC3] malformed identifiers, names, attendance, capacity and periods cannot produce an approvable request card', async () => {
  const badRows = [null, 'row', { ...request, request_id: 0 }, { ...request, request_id: 1.5 },
    { ...request, event_id: 0 }, { ...request, event_id: 1.5 }, { ...request, event_name: null },
    { ...request, event_name: ' ' }, { ...request, venue_name: null }, { ...request, venue_name: ' ' },
    { ...request, starts_at: null }, { ...request, starts_at: 'invalid' }, { ...request, ends_at: null },
    { ...request, ends_at: 'invalid' }, { ...request, ends_at: request.starts_at },
    { ...request, expected_attendance: 1.5 }, { ...request, expected_attendance: 0 },
    { ...request, venue_capacity: 1.5 }, { ...request, venue_capacity: -1 }, { ...request, booked: 'yes' }, { ...request, booked: undefined }];
  const badBodies = [null, {}, { requests: null }, { requests: {} }, ...badRows.map(row => ({ requests: [row] }))];
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  for (const body of badBodies) {
    fetch.mockResolvedValueOnce(Response.json(body));
    expect(await fetchCapacityExceptions('token')).toEqual({ ok: false, error: 'Capacity exception requests are unavailable right now. Please try again.' });
  }
});
