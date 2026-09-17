import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createEventRequestDraft,
  deleteEventRequestDraft,
  listMyEventRequests,
  submitEventRequest,
  updateEventRequestDraft,
} from './eventRequests';

const SESSION_KEY = 'connectsphere.session';

function signIn() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: 'test-token',
      user: { userId: 'u1', email: 'organiser@example.com', role: 'event_organiser' },
    }),
  );
}

function jsonResponse(body: unknown, status = 201) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('createEventRequestDraft', () => {
  test('refuses to call the API when signed out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createEventRequestDraft({ name: 'Forum' });

    expect(outcome).toEqual({ ok: false, message: 'You are signed out. Sign in again to save this draft.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('sends the bearer token and the supplied fields', async () => {
    signIn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ request: { event_id: 3 }, missingForSubmission: ['purpose'] }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createEventRequestDraft({ name: 'Forum', expected_attendance: 20 });

    expect(outcome).toEqual({ ok: true, request: { event_id: 3 }, missingForSubmission: ['purpose'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event-requests');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body)).toEqual({ name: 'Forum', expected_attendance: 20 });
  });

  test('defaults missingForSubmission when the server omits it', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ request: { event_id: 4 } })));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: true, request: { event_id: 4 }, missingForSubmission: [] });
  });

  test('reports a network failure without throwing', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Could not reach the server. Please try again.' });
  });

  test('treats a success status with an unreadable body as a failure', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Could not reach the server. Please try again.' });
  });

  test('maps 401 back to a signed-out message', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'You are signed out. Sign in again to save this draft.' });
  });

  test('explains a 403 in terms of the caller role', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Access denied' }, 403)));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Your role cannot raise event requests.' });
  });

  test('surfaces server validation details on a 400', async () => {
    signIn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'Invalid event request details', details: ['name must be text.'] }, 400),
      ),
    );

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({
      ok: false,
      message: 'Invalid event request details',
      details: ['name must be text.'],
    });
  });

  test('falls back to the status code when an error body has no message', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Could not save the draft (HTTP 503).', details: undefined });
  });
});

describe('submitEventRequest', () => {
  test('returns success and sends the event id and bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/evt-1/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  test('maps a malformed 400 response to an empty missing-field list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{not-json', { status: 400 })),
    );

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({
      ok: false,
      kind: 'missing',
      missing: [],
    });
  });

  test.each([
    [409, { ok: false, kind: 'conflict' }],
    [503, { ok: false, kind: 'unavailable' }],
  ] as const)('maps HTTP %s to the documented result', async (status, expected) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual(expected);
  });

  test('returns the server error message for an unexpected response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Request is locked' }), { status: 500 }),
      ),
    );

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({
      ok: false,
      kind: 'error',
      message: 'Request is locked',
    });
  });

  test('uses the fallback message when an unexpected response has no JSON error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{not-json', { status: 500 })),
    );

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({
      ok: false,
      kind: 'error',
      message: 'Submission failed. Please try again.',
    });
  });

  test('maps a network failure to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });
});

describe('listMyEventRequests', () => {
  test('sends the bearer token and returns the requests', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ requests: [{ event_id: 7, status: 'draft' }] }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await listMyEventRequests('token-1');

    expect(outcome).toEqual({ ok: true, requests: [{ event_id: 7, status: 'draft' }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event-requests');
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  test('maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    await expect(listMyEventRequests('token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to see your requests.',
    });
  });

  test('explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Access denied' }, 403)));

    await expect(listMyEventRequests('token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot view event requests.',
    });
  });

  test('reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(listMyEventRequests('token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('treats a success status with an unreadable body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(listMyEventRequests('token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('falls back to a generic message for an unexpected status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(listMyEventRequests('token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });
});

describe('deleteEventRequestDraft', () => {
  test('sends the bearer token to the event-scoped DELETE route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/7', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  test('maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to delete this draft.',
    });
  });

  test('explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot delete event requests.',
    });
  });

  test('reports a 404 as the draft no longer existing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'This draft no longer exists.',
    });
  });

  test('reports a 409 as no longer being a draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Only a draft request can be deleted.',
    });
  });

  test('maps a network failure to a generic unavailable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('falls back to a generic message for an unexpected status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });
});

describe('updateEventRequestDraft', () => {
  test('sends the bearer token and the complete field set to the event-scoped route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ request: { event_id: 7, name: 'Renamed' }, missingForSubmission: ['purpose'] }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await updateEventRequestDraft('7', { name: 'Renamed' }, 'token-1');

    expect(outcome).toEqual({ ok: true, request: { event_id: 7, name: 'Renamed' }, missingForSubmission: ['purpose'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event-requests/7');
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(JSON.parse(init.body)).toEqual({ name: 'Renamed' });
  });

  test('defaults missingForSubmission when the server omits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ request: { event_id: 7 } })));

    const outcome = await updateEventRequestDraft('7', {}, 'token-1');

    expect(outcome).toEqual({ ok: true, request: { event_id: 7 }, missingForSubmission: [] });
  });

  test('reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('treats a success status with an unreadable body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to save this draft.',
    });
  });

  test('explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Access denied' }, 403)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot edit event requests.',
    });
  });

  test('reports a 404 as the draft no longer existing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'No event request found for this account.' }, 404)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'This draft no longer exists.',
    });
  });

  test('reports a 409 as no longer being a draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Only a draft event request can be edited.' }, 409)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Only a draft request can be edited.',
    });
  });

  test('surfaces server validation details on a 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'Invalid event request details', details: ['name must be text.'] }, 400)),
    );

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Invalid event request details',
      details: ['name must be text.'],
    });
  });

  test('falls back to the status code when an error body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not save the draft (HTTP 503).',
      details: undefined,
    });
  });
});
