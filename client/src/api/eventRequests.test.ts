import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createEventRequestDraft,
  deleteEventRequestDraft,
  fetchEventRequestDraft,
  fetchOwnEventDetail,
  fetchOwnEventRequests,
  isWaitingOnOrganiser,
  listMyEventRequests,
  submitEventRequest,
  updateEventRequestDraft,
  type EventRequestDetail,
  type EventRequestSummary,
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

  test('explains a 403 without server details in terms of the caller role', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));

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

describe('isWaitingOnOrganiser', () => {
  test.each(['draft', 'Draft', 'DRAFT', 'rejected', 'Rejected', '  rejected  '])(
    'returns true for organiser actionable status %s',
    (status) => {
      expect(isWaitingOnOrganiser(status)).toBe(true);
    },
  );

  test.each([
    'submitted',
    'under_review',
    'planning',
    'confirmed',
    'completed',
    'cancelled',
    'unknown',
  ])('returns false for coordinator/system status %s', (status) => {
    expect(isWaitingOnOrganiser(status)).toBe(false);
  });
});

describe('fetchOwnEventRequests', () => {
  test('fetches events without filter and maps summary response', async () => {
    const mockEvents = [
      {
        event_id: 101,
        can_manage: true,
        name: 'Annual Tech Summit',
        proposed_date: '2026-11-20',
        status: 'draft',
        coordinator_id: null,
        coordinator_name: null,
      },
      {
        event_id: 102,
        can_manage: true,
        name: 'Leadership Workshop',
        proposed_date: '2026-12-05',
        status: 'submitted',
        coordinator_id: 'coord-uuid-1',
        coordinator_name: 'Jane Doe',
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requests: mockEvents }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOwnEventRequests('token-abc');
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests', {
      method: 'GET',
      headers: { Authorization: 'Bearer token-abc' },
    });

    const expected: EventRequestSummary[] = [
      {
        eventId: 101,
        name: 'Annual Tech Summit',
        proposedDate: '2026-11-20',
        status: 'draft',
        coordinatorId: null,
        coordinatorName: null,
        canManage: true,
        waitingOnMe: true,
      },
      {
        eventId: 102,
        name: 'Leadership Workshop',
        proposedDate: '2026-12-05',
        status: 'submitted',
        coordinatorId: 'coord-uuid-1',
        coordinatorName: 'Jane Doe',
        canManage: true,
        waitingOnMe: false,
      },
    ];

    expect(result).toEqual({ ok: true, requests: expected });
  });

  test('applies status query parameter when provided and not "all"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requests: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOwnEventRequests('token-abc', 'Draft');
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests?status=draft', {
      method: 'GET',
      headers: { Authorization: 'Bearer token-abc' },
    });
    expect(result).toEqual({ ok: true, requests: [] });
  });

  test.each(['All', 'all', '  ', ''])(
    'omits status query parameter for filter value %s',
    async (filter) => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ requests: [] }), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await fetchOwnEventRequests('token-abc', filter);
      expect(fetchMock).toHaveBeenCalledWith('/api/event-requests', {
        method: 'GET',
        headers: { Authorization: 'Bearer token-abc' },
      });
    },
  );

  test('handles missing or malformed requests payload in 200 response gracefully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: true, requests: [] });
  });

  test('handles malformed json in 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{not-json', { status: 200 })),
    );

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: true, requests: [] });
  });

  test('maps rows with missing fields to safe defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requests: [{}] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({
      ok: true,
      requests: [
        {
          eventId: 0,
          name: '',
          proposedDate: null,
          status: 'draft',
          coordinatorId: null,
          coordinatorName: null,
          canManage: false,
          waitingOnMe: false,
        },
      ],
    });
  });

  test.each([401, 403])('maps HTTP %s to unauthorized', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test('maps HTTP 503 to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: false, kind: 'unavailable' });
  });

  test('maps network failure to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection timeout')));

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: false, kind: 'unavailable' });
  });

  test('returns error message on unexpected server response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid status filter.' }), { status: 400 }),
      ),
    );

    const result = await fetchOwnEventRequests('token-abc', 'bogus');
    expect(result).toEqual({
      ok: false,
      kind: 'error',
      message: 'Invalid status filter.',
    });
  });

  test('uses fallback message on unexpected server response without json error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{not-json', { status: 500 })),
    );

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({
      ok: false,
      kind: 'error',
      message: 'Failed to fetch event requests.',
    });
  });
});

describe('fetchOwnEventDetail', () => {
  test('fetches event detail and maps all fields', async () => {
    const rawDetail = {
      event_id: 42,
      can_manage: true,
      organiser_id: 'org-uuid-99',
      organisation: 'Acme Corp',
      status: 'rejected',
      name: 'Global Summit',
      purpose: 'Innovation display',
      description: 'Bringing teams together.',
      proposed_date: '2026-10-15',
      expected_attendance: 150,
      venue_requirements: 'Large auditorium with stage',
      accessibility_needs: 'Wheelchair access',
      equipment_requirements: 'Dual projector and 4 microphones',
      registration_needed: true,
      coordinator_id: 'coord-uuid-5',
      coordinator_name: 'Coordinator Jane',
    };

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request: rawDetail }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/42', {
      method: 'GET',
      headers: { Authorization: 'Bearer token-xyz' },
    });

    const expected: EventRequestDetail = {
      eventId: 42,
      organiserId: 'org-uuid-99',
      organisation: 'Acme Corp',
      status: 'rejected',
      name: 'Global Summit',
      purpose: 'Innovation display',
      description: 'Bringing teams together.',
      proposedDate: '2026-10-15',
      expectedAttendance: 150,
      venueRequirements: 'Large auditorium with stage',
      accessibilityNeeds: 'Wheelchair access',
      equipmentRequirements: 'Dual projector and 4 microphones',
      registrationNeeded: true,
      coordinatorId: 'coord-uuid-5',
      coordinatorName: 'Coordinator Jane',
      canManage: true,
      waitingOnMe: true,
    };

    expect(result).toEqual({ ok: true, request: expected });
  });

  test('maps event detail with null and missing fields safely', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          request: {
            event_id: 1,
            organiser_id: 'org-1',
            status: 'submitted',
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOwnEventDetail(1, 'token-xyz');
    expect(result).toEqual({
      ok: true,
      request: {
        eventId: 1,
        organiserId: 'org-1',
        organisation: null,
        status: 'submitted',
        name: '',
        purpose: '',
        description: '',
        proposedDate: null,
        expectedAttendance: null,
        venueRequirements: null,
        accessibilityNeeds: null,
        equipmentRequirements: null,
        registrationNeeded: false,
        coordinatorId: null,
        coordinatorName: null,
        canManage: false,
        waitingOnMe: false,
      },
    });
  });

  test('maps completely empty request detail row to safe fallback defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          request: {},
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchOwnEventDetail(0, 'token-xyz');
    expect(result).toEqual({
      ok: true,
      request: {
        eventId: 0,
        organiserId: '',
        organisation: null,
        status: 'draft',
        name: '',
        purpose: '',
        description: '',
        proposedDate: null,
        expectedAttendance: null,
        venueRequirements: null,
        accessibilityNeeds: null,
        equipmentRequirements: null,
        registrationNeeded: false,
        coordinatorId: null,
        coordinatorName: null,
        canManage: false,
        waitingOnMe: false,
      },
    });
  });

  test('returns error when 200 response contains no request object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({
      ok: false,
      kind: 'error',
      message: 'Invalid response format.',
    });
  });

  test('returns error when 200 response contains malformed json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{invalid-json', { status: 200 })),
    );

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({
      ok: false,
      kind: 'error',
      message: 'Invalid response format.',
    });
  });

  test('maps HTTP 404 to not_found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'No event request found for this account.' }), {
          status: 404,
        }),
      ),
    );

    const result = await fetchOwnEventDetail(999, 'token-xyz');
    expect(result).toEqual({ ok: false, kind: 'not_found' });
  });

  test.each([401, 403])('maps HTTP %s to unauthorized', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test('maps HTTP 503 to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({ ok: false, kind: 'unavailable' });
  });

  test('maps network failure to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({ ok: false, kind: 'unavailable' });
  });

  test('returns error message on unexpected server error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'eventId must be a positive integer.' }), {
          status: 400,
        }),
      ),
    );

    const result = await fetchOwnEventDetail(0, 'token-xyz');
    expect(result).toEqual({
      ok: false,
      kind: 'error',
      message: 'eventId must be a positive integer.',
    });
  });

  test('uses fallback message on unexpected server error without json error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{not-json', { status: 500 })),
    );

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({
      ok: false,
      kind: 'error',
      message: 'Failed to fetch event request detail.',
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
    expect(url).toBe('/api/event-requests?scope=mine');
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

describe('fetchEventRequestDraft', () => {
  const FULL_RECORD = {
    event_id: 7,
    organiser_id: 'user-1',
    organisation: 'ConnectSphere Test',
    status: 'draft',
    name: 'Partner Forum',
    purpose: 'Client relationship building',
    description: 'Half-day forum with keynotes and a reception.',
    proposed_date: '2026-11-04T09:00:00.000Z',
    expected_attendance: 120,
    venue_requirements: 'Stage, PA, step-free access',
    accessibility_needs: 'Hearing loop',
    equipment_requirements: 'Lectern, 2 radio mics',
    registration_needed: true,
  };

  test('sends the bearer token and returns the full record', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ request: FULL_RECORD }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await fetchEventRequestDraft(7, 'token-1');

    expect(outcome).toEqual({ ok: true, request: FULL_RECORD });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event-requests/7');
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  test('maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to edit this draft.',
    });
  });

  test('explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Access denied' }, 403)));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot view event requests.',
    });
  });

  test('maps 404 to a "no longer exists" message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'No event request found' }, 404)));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'This draft no longer exists.',
    });
  });

  test('reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('treats a success status with an unreadable body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('falls back to a generic message for an unexpected status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
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


test('create draft preserves the missing organisation guidance from the server', async () => {
  signIn();
  const message = 'Your account needs a client organisation before you can create event requests. Please contact support.';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: message }, 403)));
  expect(await createEventRequestDraft({})).toEqual({ ok: false, message });
});

test('shared drafts map to view-only without an action for the current organiser', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ requests: [
    { event_id: 80, name: 'Colleague draft', status: 'draft', can_manage: false },
  ] }, 200)));
  const outcome = await fetchOwnEventRequests('colleague-token');
  expect(outcome).toMatchObject({ ok: true, requests: [{ eventId: 80, canManage: false, waitingOnMe: false }] });
});
