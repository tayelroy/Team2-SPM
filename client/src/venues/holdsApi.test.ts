import { afterEach, expect, test, vi } from 'vitest';
import { createHold, fetchHolds, fetchHoldOptions, changeHold } from './holdsApi';

afterEach(() => vi.unstubAllGlobals());
const hold = { hold_id: 7, event_id: 41, event_name: 'Partner forum', venue_id: 1, venue_name: 'Atrium Hall',
  starts_at: '2030-06-15T01:00:00.000Z', ends_at: '2030-06-15T09:00:00.000Z', expires_at: '2030-06-14T01:00:00.000Z',
  status: 'tentative', booking_id: null, request_id: 11, created_at: '2030-06-12T01:00:00.000Z' };
const values = { event_id: 41, venue_id: 1, starts_at: hold.starts_at, ends_at: hold.ends_at, expires_at: hold.expires_at };

test('[NORMAL] [SG2-84:AC1,AC4,AC5] public hold adapters preserve persisted records and send authenticated uncached requests', async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/options')
    ? { events: [{ event_id: 41, name: 'Partner forum' }], venues: [{ venue_id: 1, name: 'Atrium Hall' }] }
    : url === '/api/venue-holds' ? { holds: [hold] } : { hold }));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchHolds('token')).toEqual({ ok: true, data: [hold] });
  expect(await fetchHoldOptions('token')).toEqual({ ok: true, data: { events: [{ event_id: 41, name: 'Partner forum' }], venues: [{ venue_id: 1, name: 'Atrium Hall' }] } });
  fetch.mockResolvedValueOnce(Response.json({ hold }, { status: 201 }));
  expect(await createHold('token', values)).toEqual({ ok: true, data: hold });
  expect(await changeHold('token', 7, 'convert')).toEqual({ ok: true, data: hold });
  expect(await changeHold('token', 7, 'release')).toEqual({ ok: true, data: hold });
  expect(fetch.mock.calls).toEqual([
    ['/api/venue-holds', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' }],
    ['/api/venue-holds/options', { headers: { Authorization: 'Bearer token' }, cache: 'no-store' }],
    ['/api/venue-holds', { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify(values) }],
    ['/api/venue-holds/7/convert', { method: 'POST', headers: { Authorization: 'Bearer token' }, cache: 'no-store' }],
    ['/api/venue-holds/7/release', { method: 'POST', headers: { Authorization: 'Bearer token' }, cache: 'no-store' }],
  ]);
});

test('[FAILURE] [SG2-84:AC1] missing credentials never dispatch a hold request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  expect(await fetchHolds('')).toEqual({ ok: false, error: 'Sign in again to manage venue holds.' });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([400, 401, 403, 404, 409, 503])('[FAILURE] [SG2-84:AC1,AC3] [SG2-85:AC3] HTTP %s gives an actionable error', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Hold expired. Create a new request.' }, { status })));
  expect(await changeHold('token', 7, 'convert')).toEqual({ ok: false, error: status === 401 || status === 403
    ? 'Your account cannot manage these holds. Sign in again.' : status === 503
      ? 'Venue holds are temporarily unavailable. Please try again.' : 'Hold expired. Create a new request.' });
});

test.each([400, 404, 409])('[FAILURE] [SG2-84:AC1] invalid error body for HTTP %s uses the fallback', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not JSON', { status })));
  expect(await createHold('token', values)).toEqual({ ok: false, error: 'This hold could not be saved. Refresh and try again.' });
});

test('[CONFLICT] [SG2-84:AC3] a conflict without a text error cannot report a successful save', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 123 }, { status: 409 })));
  expect(await createHold('token', values)).toEqual({ ok: false, error: 'This hold could not be saved. Refresh and try again.' });
});

test('[FAILURE] [SG2-84:AC1] a creation response missing the persisted hold cannot report success', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  expect(await createHold('token', values)).toEqual({ ok: false, error: 'Venue holds are temporarily unavailable. Please try again.' });
});

test.each(['network', 'json', 'null', 'missing', 'wrong-list', 'bad-hold'])('[FAILURE] [SG2-84:AC4] %s list response never renders a successful empty list', async scenario => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (scenario === 'network') throw new Error('offline');
    if (scenario === 'json') return new Response('<html>');
    return Response.json(scenario === 'null' ? null : scenario === 'missing' ? {} : { holds: scenario === 'wrong-list' ? {} : [null] });
  }));
  expect(await fetchHolds('token')).toEqual({ ok: false, error: 'Venue holds are temporarily unavailable. Please try again.' });
});

test.each([{ ...hold, status: 'approved' }, { ...hold, hold_id: 0 }, { ...hold, event_name: null }, { ...hold, expires_at: 'tomorrow' }])
  ('[FAILURE] [SG2-84:AC4] malformed hold data is refused: %j', async malformed => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ hold: malformed })));
    expect((await changeHold('token', 7, 'release')).ok).toBe(false);
  });

test('[BOUNDARY] [SG2-84:AC1] empty placement options and an empty hold list are valid', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ events: [], venues: [] })).mockResolvedValueOnce(Response.json({ holds: [] }));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchHoldOptions('token')).toEqual({ ok: true, data: { events: [], venues: [] } });
  expect(await fetchHolds('token')).toEqual({ ok: true, data: [] });
});

test.each([null, {}, { events: [], venues: null }, { events: [null], venues: [] }, { events: [{ event_id: -1, name: 'Bad' }], venues: [] }, { events: [], venues: [{ venue_id: 1, name: null }] }])
  ('[FAILURE] [SG2-84:AC1] malformed placement options cannot enable the form: %j', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(data)));
    expect((await fetchHoldOptions('token')).ok).toBe(false);
  });
