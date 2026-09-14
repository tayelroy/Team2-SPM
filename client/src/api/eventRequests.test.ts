import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEventRequestDraft } from './eventRequests';

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
