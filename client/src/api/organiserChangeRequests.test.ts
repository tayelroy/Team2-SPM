import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchOwnChangeRequests, raiseChangeRequest } from './changeRequests';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const UNAVAILABLE = { ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' };
const REQUEST = {
  id: '41', requested_at: '2026-10-24T02:00:00.000Z', reason: 'More guests confirmed.', status: 'pending',
  changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }],
};
const CHANGE = { field: 'expected_attendance', to: 180, reason: 'More guests confirmed.' };

describe('raiseChangeRequest (SG2-64 AC1/AC2)', () => {
  test('[NORMAL] [SG2-64:AC1] [SG2-64:AC2] posts what, to what and why as JSON and reads back the stored request', async () => {
    const fetch = respond(() => Response.json({ change_request: REQUEST, coordinator_notified: true }, { status: 201 }));
    expect(await raiseChangeRequest(12, CHANGE, 'organiser-token'))
      .toEqual({ ok: true, request: REQUEST, coordinatorNotified: true });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/change-requests', {
      method: 'POST',
      headers: { Authorization: 'Bearer organiser-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(CHANGE),
    });
  });

  test('[CONFLICT] [SG2-64:AC4] a closed event keeps the server\'s words; validation keeps its details', async () => {
    respond(() => Response.json({ error: 'A change cannot be requested on a draft, cancelled, rejected or completed event.' }, { status: 409 }));
    expect(await raiseChangeRequest(12, CHANGE, 't')).toEqual({ ok: false, kind: 'conflict',
      message: 'A change cannot be requested on a draft, cancelled, rejected or completed event.' });
    respond(() => Response.json({ error: 'Invalid change request', details: ['Give the new value.', 7] }, { status: 400 }));
    expect(await raiseChangeRequest(12, CHANGE, 't')).toEqual({ ok: false, kind: 'validation',
      message: 'Invalid change request', details: ['Give the new value.'] });
  });

  test('[FAILURE] [SG2-64:AC1] a wordless refusal names the organiser; offline or malformed replies are unavailable', async () => {
    respond(() => new Response(null, { status: 403 }));
    expect(await raiseChangeRequest(12, CHANGE, 't')).toEqual({ ok: false, kind: 'unauthorized',
      message: 'Only the organiser who created this event can do this. Sign in again if your session has expired.' });
    respond(() => Response.json({ error: 'Access denied' }, { status: 403 }));
    expect(await raiseChangeRequest(12, CHANGE, 't')).toEqual({ ok: false, kind: 'unauthorized', message: 'Access denied' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await raiseChangeRequest(12, CHANGE, 't')).toEqual(UNAVAILABLE);
    for (const body of [null, {}, { change_request: { ...REQUEST, id: 41 }, coordinator_notified: true },
      { change_request: { ...REQUEST, changes: null }, coordinator_notified: true },
      { change_request: REQUEST, coordinator_notified: 'yes' }]) {
      respond(() => Response.json(body, { status: 201 }));
      expect(await raiseChangeRequest(12, CHANGE, 't')).toEqual(UNAVAILABLE);
    }
  });
});

describe('fetchOwnChangeRequests (SG2-64 AC3)', () => {
  test('[NORMAL] [SG2-64:AC3] reads the organiser\'s outstanding requests with an authorised GET', async () => {
    const fetch = respond(() => Response.json({ event: { event_id: 12, status: 'planning' }, change_requests: [REQUEST] }));
    expect(await fetchOwnChangeRequests(12, 'organiser-token')).toEqual({ ok: true, requests: [REQUEST] });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/change-requests', {
      method: 'GET', headers: { Authorization: 'Bearer organiser-token' },
    });
  });

  test('[FAILURE] [SG2-64:AC3] another organiser\'s event, offline and malformed replies fail', async () => {
    respond(() => Response.json({ error: 'Event not found.' }, { status: 404 }));
    expect(await fetchOwnChangeRequests(12, 't')).toEqual({ ok: false, kind: 'not_found', message: 'Event not found.' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchOwnChangeRequests(12, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({ change_requests: 'none' }));
    expect(await fetchOwnChangeRequests(12, 't')).toEqual(UNAVAILABLE);
  });
});
