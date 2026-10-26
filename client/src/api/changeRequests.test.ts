import { afterEach, describe, expect, test, vi } from 'vitest';
import { acceptChangeRequest, fetchChangeRequests, settleRecheck } from './changeRequests';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const UNAVAILABLE = { ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' };

const list = {
  event: { event_id: 12, status: 'confirmed' },
  can_accept: true,
  change_requests: [{
    id: 'mock-12-attendance',
    requested_at: '2026-10-19T02:00:00.000Z',
    reason: 'More guests have confirmed than planned.',
    status: 'pending',
    changes: [{ field: 'expected_attendance', label: 'Expected attendance', from: 120, to: 180 }],
    significant: true,
    impact: {
      requires_revalidation: true,
      outstanding_arrangements: ['venue_recheck'],
      arrangements: [{
        kind: 'venue_booking', id: 5, label: 'The Kelp Room', starts_at: null, ends_at: null,
        reasons: [{ code: 'capacity_check', message: 'Attendance 180 exceeds The Kelp Room capacity 150.' }],
      }],
    },
  }],
};

describe('fetchChangeRequests', () => {
  test('[NORMAL] [SG2-66:AC1] reads the change requests with an authorised GET', async () => {
    const fetch = respond(() => Response.json(list));
    expect(await fetchChangeRequests(12, 'coordinator-token')).toEqual({ ok: true, list });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/change-requests', {
      method: 'GET',
      headers: { Authorization: 'Bearer coordinator-token' },
    });
  });

  test('[FAILURE] [SG2-66:AC1] network errors and unreadable or malformed bodies read as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchChangeRequests(12, 't')).toEqual(UNAVAILABLE);
    respond(() => new Response('not json', { status: 200 }));
    expect(await fetchChangeRequests(12, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json('a string body'));
    expect(await fetchChangeRequests(12, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({ change_requests: 'none' }));
    expect(await fetchChangeRequests(12, 't')).toEqual(UNAVAILABLE);
  });

  test('[FAILURE] [SG2-66:AC1] refusals keep the server text and fall back to plain wording per status', async () => {
    respond(() => Response.json({ error: 'Event request not found.' }, { status: 404 }));
    expect(await fetchChangeRequests(12, 't')).toEqual({ ok: false, kind: 'not_found', message: 'Event request not found.' });
    respond(() => new Response('', { status: 404 }));
    expect(await fetchChangeRequests(12, 't')).toEqual({
      ok: false, kind: 'not_found', message: 'This event or change request could not be found. Refresh and try again.',
    });
    respond(() => new Response('', { status: 401 }));
    expect(await fetchChangeRequests(12, 't')).toEqual({
      ok: false, kind: 'unauthorized',
      message: 'Only the assigned Event Coordinator can do this. Sign in again if your session has expired.',
    });
    respond(() => Response.json({}, { status: 403 }));
    expect((await fetchChangeRequests(12, 't')).ok).toBe(false);
    respond(() => Response.json({}, { status: 503 }));
    expect(await fetchChangeRequests(12, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({}, { status: 500 }));
    expect(await fetchChangeRequests(12, 't')).toEqual({
      ok: false, kind: 'error', message: 'Could not load change requests (HTTP 500).',
    });
  });
});

describe('acceptChangeRequest', () => {
  const accepted = {
    event_id: 12, previous_status: 'confirmed', status: 'planning', returned_to_planning: true,
    arrangements_recheck_needed: true, outstanding_arrangements: ['venue_recheck'],
  };

  test('[NORMAL] [SG2-66:AC4] accepting POSTs to the escaped change request and returns the server outcome', async () => {
    const fetch = respond(() => Response.json(accepted));
    expect(await acceptChangeRequest(12, 'mock-12/attendance', 'coordinator-token')).toEqual({ ok: true, change: accepted });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/change-requests/mock-12%2Fattendance/accept', {
      method: 'POST',
      headers: { Authorization: 'Bearer coordinator-token' },
    });
  });

  test('[BOUNDARY] [SG2-66:AC4] an invalid change keeps the validation details as text', async () => {
    respond(() => Response.json({ error: 'Invalid change', details: ['Proposed date must be in the future.', 7] }, { status: 400 }));
    expect(await acceptChangeRequest(12, 'mock-12-date', 't')).toEqual({
      ok: false, kind: 'validation', message: 'Invalid change', details: ['Proposed date must be in the future.'],
    });
    respond(() => Response.json({}, { status: 400 }));
    expect(await acceptChangeRequest(12, 'mock-12-date', 't')).toEqual({
      ok: false, kind: 'validation', message: 'Could not accept the change (HTTP 400).',
    });
  });

  test('[CONFLICT] [SG2-66:AC4] a stale or unchangeable event is refused with the server text', async () => {
    respond(() => Response.json({ error: 'This event changed while you were deciding. Refresh and try again.' }, { status: 409 }));
    expect(await acceptChangeRequest(12, 'mock-12-date', 't')).toEqual({
      ok: false, kind: 'conflict', message: 'This event changed while you were deciding. Refresh and try again.',
    });
  });

  test('[FAILURE] [SG2-66:AC4] network errors and malformed success bodies read as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await acceptChangeRequest(12, 'x', 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({ event_id: 12 }));
    expect(await acceptChangeRequest(12, 'x', 't')).toEqual(UNAVAILABLE);
    respond(() => new Response('', { status: 200 }));
    expect(await acceptChangeRequest(12, 'x', 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({}, { status: 503 }));
    expect(await acceptChangeRequest(12, 'x', 't')).toEqual(UNAVAILABLE);
  });
});

describe('settleRecheck', () => {
  test('[NORMAL] [SG2-66:AC4] settling POSTs the recheck key and returns what is still outstanding', async () => {
    const settled = { event_id: 12, arrangements_recheck_needed: true, outstanding_arrangements: ['equipment_recheck'] };
    const fetch = respond(() => Response.json(settled));
    expect(await settleRecheck(12, 'venue_recheck', 'coordinator-token')).toEqual({ ok: true, settled });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/rechecks/venue_recheck/settle', {
      method: 'POST',
      headers: { Authorization: 'Bearer coordinator-token' },
    });
  });

  test('[CONFLICT] [SG2-66:AC4] a blocked recheck returns its blockers; other refusals keep their kind', async () => {
    respond(() => Response.json({
      error: 'This arrangement still needs attention before it can be marked rechecked.',
      blockers: ['The Kelp Room does not cover the event start.', 3],
    }, { status: 409 }));
    expect(await settleRecheck(12, 'venue_recheck', 't')).toEqual({
      ok: false, kind: 'blocked',
      message: 'This arrangement still needs attention before it can be marked rechecked.',
      blockers: ['The Kelp Room does not cover the event start.'],
    });
    respond(() => Response.json({ error: 'That arrangement is not waiting for a recheck.' }, { status: 409 }));
    expect(await settleRecheck(12, 'venue_recheck', 't')).toEqual({
      ok: false, kind: 'conflict', message: 'That arrangement is not waiting for a recheck.',
    });
    respond(() => Response.json({ blockers: ['ignored'] }, { status: 404 }));
    expect(await settleRecheck(12, 'venue_recheck', 't')).toEqual({
      ok: false, kind: 'not_found', message: 'This event or change request could not be found. Refresh and try again.',
    });
    respond(() => Response.json({}, { status: 500 }));
    expect(await settleRecheck(12, 'venue_recheck', 't')).toEqual({
      ok: false, kind: 'error', message: 'Could not mark the arrangement rechecked (HTTP 500).',
    });
  });

  test('[FAILURE] [SG2-66:AC4] network errors and malformed success bodies read as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await settleRecheck(12, 'registration_recheck', 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({ event_id: 12 }));
    expect(await settleRecheck(12, 'registration_recheck', 't')).toEqual(UNAVAILABLE);
    respond(() => new Response('', { status: 200 }));
    expect(await settleRecheck(12, 'registration_recheck', 't')).toEqual(UNAVAILABLE);
  });
});
