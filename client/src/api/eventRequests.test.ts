import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createEventRequestDraft,
  deleteEventRequestDraft,
  assignCoordinator,
  fetchAssignable,
  fetchEventRequestDraft,
  fetchOwnEventDetail,
  fetchOwnEventRequests,
  isWaitingOnOrganiser,
  listMyDraftRequests,
  submitEventRequest,
  updateEventRequestDraft,
  getEventStage,
  updateEventPlanning,
  type EventStageResult,
  type EventRequestDetail,
  type EventRequestSummary,
  type PlanningUpdatePayload,
  type PlanningEventRecord,
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
  test('[FAILURE] [SG2-28:AC3] refuses to call the API when signed out', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createEventRequestDraft({ name: 'Forum' });

    expect(outcome).toEqual({ ok: false, message: 'You are signed out. Sign in again to save this draft.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('[NORMAL] [SG2-28:AC1] sends the bearer token and the supplied fields', async () => {
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

  test('[BOUNDARY] [SG2-28:AC4] defaults missingForSubmission when the server omits it', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ request: { event_id: 4 } })));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: true, request: { event_id: 4 }, missingForSubmission: [] });
  });

  test('[FAILURE] [SG2-28:AC4] reports a network failure without throwing', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Could not reach the server. Please try again.' });
  });

  test('[FAILURE] [SG2-28:AC4] treats a success status with an unreadable body as a failure', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Could not reach the server. Please try again.' });
  });

  test('[FAILURE] [SG2-28:AC3] maps 401 back to a signed-out message', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'You are signed out. Sign in again to save this draft.' });
  });

  test('[FAILURE] [SG2-28:AC3] explains a 403 without server details in terms of the caller role', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Your role cannot raise event requests.' });
  });

  test('[FAILURE] [SG2-28:AC4] surfaces server validation details on a 400', async () => {
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

  test('[FAILURE] [SG2-28:AC4] falls back to the status code when an error body has no message', async () => {
    signIn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const outcome = await createEventRequestDraft({});

    expect(outcome).toEqual({ ok: false, message: 'Could not save the draft (HTTP 503).', details: undefined });
  });
});

describe('submitEventRequest', () => {
  test('[NORMAL] [SG2-30:AC1] returns success and sends the event id and bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/evt-1/submit', {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  test('[FAILURE] [SG2-30:AC2] maps a malformed 400 response to an empty missing-field list', async () => {
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

  test('[CONFLICT] [SG2-30:submitted-state] reports that an already-submitted request cannot be submitted again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({ ok: false, kind: 'conflict' });
  });

  test('[FAILURE] [SG2-30:submission-errors] a service outage offers a retry instead of reporting a submission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({ ok: false, kind: 'unavailable' });
  });

  test('[FAILURE] [SG2-30:submission-errors] returns the server error message for an unexpected response', async () => {
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

  test('[FAILURE] [SG2-30:submission-errors] uses the fallback message when an unexpected response has no JSON error', async () => {
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

  test('[FAILURE] [SG2-30:submission-errors] maps a network failure to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(submitEventRequest('evt-1', 'token-1')).resolves.toEqual({
      ok: false,
      kind: 'unavailable',
    });
  });
});

describe('isWaitingOnOrganiser', () => {
  test.each(['draft', 'Draft', 'DRAFT', 'rejected', 'Rejected', '  rejected  '])(
    '[NORMAL] [SG2-31:AC4] returns true for organiser actionable status %s',
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
  ])('[NORMAL] [SG2-31:AC4] returns false for coordinator/system status %s', (status) => {
    expect(isWaitingOnOrganiser(status)).toBe(false);
  });
});

describe('shared GET response contracts', () => {
  // The transport is shared; scope, output shape and unreadable-body policy
  // remain separate public contracts. Do not replace one reader with another.
  const readers = [
    {
      label: 'organisation summary list',
      read: () => fetchOwnEventRequests('token-1'),
      unavailable: { ok: false, kind: 'unavailable' },
      unreadable: { ok: true, requests: [] },
    },
    {
      label: 'normalised organisation detail',
      read: () => fetchOwnEventDetail(7, 'token-1'),
      unavailable: { ok: false, kind: 'unavailable' },
      unreadable: { ok: false, kind: 'error', message: 'Invalid response format.' },
    },
    {
      label: 'own-request list',
      read: () => listMyDraftRequests('token-1'),
      unavailable: { ok: false, message: 'Could not reach the server. Please try again.' },
      unreadable: { ok: false, message: 'Could not reach the server. Please try again.' },
    },
    {
      label: 'raw editable draft',
      read: () => fetchEventRequestDraft(7, 'token-1'),
      unavailable: { ok: false, message: 'Could not reach the server. Please try again.' },
      unreadable: { ok: false, message: 'Could not reach the server. Please try again.' },
    },
  ];

  test.each(readers)('[FAILURE] [SG2-26:read-response] $label maps a failed GET to its public unavailable result', async ({ read, unavailable }) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(read()).resolves.toEqual(unavailable);
  });

  test.each(readers)('[FAILURE] [SG2-26:read-response] $label applies its unreadable-success response policy', async ({ read, unreadable }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{not-json', { status: 200 })));
    await expect(read()).resolves.toEqual(unreadable);
  });
});

describe('fetchOwnEventRequests', () => {
  test('[NORMAL] [SG2-26:AC1] fetches events without filter and maps summary response', async () => {
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

  test('[NORMAL] [SG2-31:AC2] applies status query parameter when provided and not "all"', async () => {
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
    '[BOUNDARY] [SG2-31:AC2] omits status query parameter for filter value %s',
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

  test.each([{}, { requests: null }, { requests: 'not an array' }])('[FAILURE] [SG2-26:AC1] maps a missing or non-array requests payload to an empty list: %j', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })),
    );

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: true, requests: [] });
  });


  test('[BOUNDARY] [SG2-26:AC1] maps rows with missing fields to safe defaults', async () => {
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

  test.each([401, 403])('[FAILURE] [SG2-26:AC1] maps HTTP %s to unauthorized', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test('[FAILURE] [SG2-26:AC1] maps HTTP 503 to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const result = await fetchOwnEventRequests('token-abc');
    expect(result).toEqual({ ok: false, kind: 'unavailable' });
  });


  test('[FAILURE] [SG2-26:AC1] returns error message on unexpected server response', async () => {
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

  test('[FAILURE] [SG2-26:AC1] uses fallback message on unexpected server response without json error', async () => {
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
  test('[NORMAL] [SG2-26:AC1] fetches event detail and maps all fields', async () => {
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
      coordinator_phone: '+65 9123 4567',
      decided_at: '2026-09-25T02:00:00.000Z',
      decision_reason: 'Clashes with the AGM.',
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
      decisionReason: 'Clashes with the AGM.',
      coordinatorPhone: '+65 9123 4567',
      decidedAt: '2026-09-25T02:00:00.000Z',
    };

    expect(result).toEqual({ ok: true, request: expected });
  });

  test('[BOUNDARY] [SG2-26:AC1] maps event detail with missing optional fields to display defaults', async () => {
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
        decisionReason: null,
        coordinatorPhone: null,
        decidedAt: null,
      },
    });
  });

  test('[BOUNDARY] [SG2-26:AC1] maps completely empty request detail row to safe fallback defaults', async () => {
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
        decisionReason: null,
        coordinatorPhone: null,
        decidedAt: null,
      },
    });
  });

  test('[FAILURE] [SG2-26:AC1] returns error when 200 response contains no request object', async () => {
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


  test('[FAILURE] [SG2-26:AC1] maps HTTP 404 to not_found', async () => {
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

  test.each([401, 403])('[FAILURE] [SG2-26:AC1] maps HTTP %s to unauthorized', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test('[FAILURE] [SG2-26:AC1] maps HTTP 503 to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const result = await fetchOwnEventDetail(42, 'token-xyz');
    expect(result).toEqual({ ok: false, kind: 'unavailable' });
  });


  test('[FAILURE] [SG2-26:AC1] returns error message on unexpected server error response', async () => {
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

  test('[FAILURE] [SG2-26:AC1] uses fallback message on unexpected server error without json error', async () => {
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

describe('listMyDraftRequests', () => {
  test('[NORMAL] [SG2-29:AC3] requests only the caller’s drafts with the bearer token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ requests: [{ event_id: 7, status: 'draft' }] }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await listMyDraftRequests('token-1');

    expect(outcome).toEqual({ ok: true, requests: [{ event_id: 7, status: 'draft' }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event-requests?scope=mine&status=draft');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  test('[FAILURE] [SG2-29:AC3] maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    await expect(listMyDraftRequests('token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to see your requests.',
    });
  });

  test('[FAILURE] [SG2-29:AC3] explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Access denied' }, 403)));

    await expect(listMyDraftRequests('token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot view event requests.',
    });
  });



  test('[FAILURE] [SG2-29:AC3] falls back to a generic message for an unexpected status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(listMyDraftRequests('token-1')).resolves.toEqual({
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

  test('[NORMAL] [SG2-29:AC2] sends the bearer token and returns the full record', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ request: FULL_RECORD }, 200));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await fetchEventRequestDraft(7, 'token-1');

    expect(outcome).toEqual({ ok: true, request: FULL_RECORD });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/event-requests/7');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer token-1');
  });

  test('[FAILURE] [SG2-29:AC2] maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to edit this draft.',
    });
  });

  test('[FAILURE] [SG2-29:AC2] explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Access denied' }, 403)));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot view event requests.',
    });
  });

  test('[FAILURE] [SG2-29:AC2] maps 404 to a "no longer exists" message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'No event request found' }, 404)));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'This draft no longer exists.',
    });
  });



  test('[FAILURE] [SG2-29:AC2] falls back to a generic message for an unexpected status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(fetchEventRequestDraft(7, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });
});

describe('deleteEventRequestDraft', () => {
  test('[NORMAL] [SG2-32:AC1] sends the bearer token to the event-scoped DELETE route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/7', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-1' },
    });
  });

  test('[FAILURE] [SG2-32:AC1] maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to delete this draft.',
    });
  });

  test('[FAILURE] [SG2-32:AC1] explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot delete event requests.',
    });
  });

  test('[FAILURE] [SG2-32:AC1] reports a 404 as the draft no longer existing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'This draft no longer exists.',
    });
  });

  test('[CONFLICT] [SG2-32:AC2] reports a 409 as no longer being a draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 409 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Only a draft request can be deleted.',
    });
  });

  test('[FAILURE] [SG2-32:AC1] maps a network failure to a generic unavailable message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('[FAILURE] [SG2-32:AC1] falls back to a generic message for an unexpected status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    await expect(deleteEventRequestDraft('7', 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });
});

describe('updateEventRequestDraft', () => {
  test('[NORMAL] [SG2-29:AC1] sends the bearer token and supplied fields to the event-scoped route', async () => {
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

  test('[BOUNDARY] [SG2-29:AC1] defaults missingForSubmission when the server omits it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ request: { event_id: 7 } })));

    const outcome = await updateEventRequestDraft('7', {}, 'token-1');

    expect(outcome).toEqual({ ok: true, request: { event_id: 7 }, missingForSubmission: [] });
  });

  test('[FAILURE] [SG2-29:AC1] reports a network failure without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('[FAILURE] [SG2-29:AC1] treats a success status with an unreadable body as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('[FAILURE] [SG2-29:AC1] maps 401 to a signed-out message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'You are signed out. Sign in again to save this draft.',
    });
  });

  test('[FAILURE] [SG2-29:AC1] explains a 403 in terms of the caller role', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Access denied' }, 403)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Your role cannot edit event requests.',
    });
  });

  test('[FAILURE] [SG2-29:AC1] reports a 404 as the draft no longer existing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'No event request found for this account.' }, 404)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'This draft no longer exists.',
    });
  });

  test('[CONFLICT] [SG2-30:AC3] reports a 409 as no longer being a draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Only a draft event request can be edited.' }, 409)));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Only a draft request can be edited.',
    });
  });

  test('[FAILURE] [SG2-29:AC1] surfaces server validation details on a 400', async () => {
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

  test('[FAILURE] [SG2-29:AC1] falls back to the status code when an error body has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(updateEventRequestDraft('7', {}, 'token-1')).resolves.toEqual({
      ok: false,
      message: 'Could not save the draft (HTTP 503).',
      details: undefined,
    });
  });
});


test('[FAILURE] [SG2-28:AC3] create draft preserves the missing organisation guidance from the server', async () => {
  signIn();
  const message = 'Your account needs a client organisation before you can create event requests. Please contact support.';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: message }, 403)));
  expect(await createEventRequestDraft({})).toEqual({ ok: false, message });
});

test('[NORMAL] [SG2-26:AC3] shared drafts map to view-only without an action for the current organiser', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ requests: [
    { event_id: 80, name: 'Colleague draft', status: 'draft', can_manage: false },
  ] }, 200)));
  const outcome = await fetchOwnEventRequests('colleague-token');
  expect(outcome).toMatchObject({ ok: true, requests: [{ eventId: 80, canManage: false, waitingOnMe: false }] });
});

describe('getEventStage (SG2-38)', () => {
  test('[NORMAL] [SG2-38:AC1] successfully retrieves stage result with stepper steps and waiting-on party', async () => {
    const mockStage: EventStageResult = {
      event_id: 101,
      raw_status: 'planning',
      stage: 'Approved — In Planning',
      stage_key: 'in_planning',
      description: 'Event approved; coordinator is actively arranging venue and equipment.',
      waiting_on: {
        persona: 'Event Coordinator (Elroy Tay)',
        action: 'Complete venue suitability check and equipment reservation',
        user_id: 'coord-1',
      },
      stepper_steps: [
        { key: 'draft', label: 'Draft', status: 'completed' },
        { key: 'submitted', label: 'Submitted', status: 'completed' },
        { key: 'under_review', label: 'Under Review', status: 'completed' },
        { key: 'in_planning', label: 'Approved — In Planning', status: 'current' },
        { key: 'confirmed', label: 'Confirmed', status: 'upcoming' },
      ],
      arrangements_recheck_needed: false,
      outstanding_arrangements: [],
    };

    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mockStage, 200));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await getEventStage(101, 'test-token');

    expect(outcome).toEqual({ ok: true, stage: mockStage });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/101/stage', {
      headers: { Authorization: 'Bearer test-token' },
    });
  });

  test('[FAILURE] [SG2-38:AC3] handles 401 unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Authentication required' }, 401)));

    const outcome = await getEventStage(101, 'invalid-token');

    expect(outcome).toEqual({
      ok: false,
      kind: 'unauthorized',
      message: 'Authentication required',
    });
  });

  test('[FAILURE] [SG2-38:AC3] handles 403 forbidden', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Attendees are not authorized to view event stages.' }, 403)));

    const outcome = await getEventStage(101, 'attendee-token');

    expect(outcome).toEqual({
      ok: false,
      kind: 'forbidden',
      message: 'Attendees are not authorized to view event stages.',
    });
  });

  test('[FAILURE] [SG2-38:AC1] handles 404 not found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Event not found.' }, 404)));

    const outcome = await getEventStage(999, 'token-1');

    expect(outcome).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'Event not found.',
    });
  });

  test('[FAILURE] [SG2-38:AC1] handles 503 unavailable and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Service down' }, 503)));

    const unavailableOutcome = await getEventStage(101, 'token-1');
    expect(unavailableOutcome).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Service down',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const networkFailOutcome = await getEventStage(101, 'token-1');
    expect(networkFailOutcome).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('[FAILURE] [SG2-38:AC1] falls back to default messages when error payload is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'unauthorized',
      message: 'Authentication required',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'forbidden',
      message: 'Access forbidden',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'Event not found.',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('[FAILURE] [SG2-38:AC1] handles generic HTTP error responses (500) with and without custom error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'Database crashed' }, 500)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Database crashed',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Failed to fetch event stage (HTTP 500).',
    });
  });

  test('[FAILURE] [SG2-38:AC1] handles invalid JSON responses or non-object bodies', async () => {
    // Non-JSON response causing json() parse to reject and execute catch(() => null)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>Bad Gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Failed to fetch event stage (HTTP 502).',
    });

    // 200 OK with null body
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, 200)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });

    // 200 OK with primitive string body
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('plain string', 200)));
    expect(await getEventStage(101, 'token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });
  });
});

describe('updateEventPlanning (SG2-39)', () => {
  const mockPayload: PlanningUpdatePayload = {
    expected_attendance: 200,
    proposed_date: '2026-11-15T09:00:00.000Z',
    venue_requirements: 'Large Hall',
    equipment_requirements: 'Projector',
    accessibility_needs: 'Wheelchair ramp',
    registration_needed: true,
    registration_capacity: 200,
    registration_opens_at: '2026-10-01T00:00:00.000Z',
    registration_closes_at: '2026-11-10T23:59:59.000Z',
    planning_notes: 'All catering set',
    confirm_impact: false,
  };

  const mockRecord: PlanningEventRecord = {
    event_id: 42,
    name: 'Tech Conference',
    status: 'planning',
    expected_attendance: 200,
    proposed_date: '2026-11-15T09:00:00.000Z',
    venue_requirements: 'Large Hall',
    equipment_requirements: 'Projector',
    accessibility_needs: 'Wheelchair ramp',
    registration_needed: true,
    registration_capacity: 200,
    registration_opens_at: '2026-10-01T00:00:00.000Z',
    registration_closes_at: '2026-11-10T23:59:59.000Z',
    planning_notes: 'All catering set',
    arrangements_recheck_needed: true,
    outstanding_arrangements: ['venue_recheck'],
  };

  test('[NORMAL] [SG2-39:AC1] successfully sends PATCH request and returns updated planning record', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          event: mockRecord,
          arrangements_recheck_needed: true,
          outstanding_arrangements: ['venue_recheck'],
        },
        200,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await updateEventPlanning(42, mockPayload, 'coord-token');

    expect(outcome).toEqual({
      ok: true,
      event: mockRecord,
      arrangements_recheck_needed: true,
      outstanding_arrangements: ['venue_recheck'],
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/42/planning', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer coord-token',
      },
      body: JSON.stringify(mockPayload),
    });
  });

  test('[BOUNDARY] [SG2-39:AC1] defaults outstanding_arrangements to empty array when omitted in 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            event: mockRecord,
            arrangements_recheck_needed: false,
          },
          200,
        ),
      ),
    );

    const outcome = await updateEventPlanning(42, {}, 'coord-token');
    expect(outcome).toEqual({
      ok: true,
      event: mockRecord,
      arrangements_recheck_needed: false,
      outstanding_arrangements: [],
    });
  });

  test('[CONFLICT] [SG2-39:AC2] handles 409 conflict when confirmation is required (arrangement impact)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: 'Arrangements require rechecking.',
            requires_confirmation: true,
            affected_arrangements: ['venue_recheck', 'equipment_recheck'],
            impact_notes: ['Proposed date changed.'],
          },
          409,
        ),
      ),
    );

    const outcome = await updateEventPlanning(42, mockPayload, 'coord-token');
    expect(outcome).toEqual({
      ok: false,
      kind: 'confirmation_required',
      affected_arrangements: ['venue_recheck', 'equipment_recheck'],
      impact_notes: ['Proposed date changed.'],
      message: 'Arrangements require rechecking.',
    });
  });

  test('[CONFLICT] [SG2-39:AC2] handles 409 confirmation required with missing lists and error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            requires_confirmation: true,
          },
          409,
        ),
      ),
    );

    const outcome = await updateEventPlanning(42, mockPayload, 'coord-token');
    expect(outcome).toEqual({
      ok: false,
      kind: 'confirmation_required',
      affected_arrangements: [],
      impact_notes: [],
      message: 'Arrangements require rechecking.',
    });
  });

  test('[CONFLICT] [SG2-39:AC5] handles 409 conflict without confirmation required (terminal status)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: 'Cannot update planning information for a cancelled event.',
          },
          409,
        ),
      ),
    );

    const outcome = await updateEventPlanning(42, mockPayload, 'coord-token');
    expect(outcome).toEqual({
      ok: false,
      kind: 'conflict',
      message: 'Cannot update planning information for a cancelled event.',
    });

    // Fallback when error string is missing
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 409)));
    const fallbackOutcome = await updateEventPlanning(42, mockPayload, 'coord-token');
    expect(fallbackOutcome).toEqual({
      ok: false,
      kind: 'conflict',
      message: 'Cannot update planning information for this event.',
    });
  });

  test('[FAILURE] [SG2-39:planning-validation] handles 400 validation error with and without details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: 'Invalid planning details',
            details: ['registration_closes_at must be after registration_opens_at.'],
          },
          400,
        ),
      ),
    );

    const outcome = await updateEventPlanning(42, mockPayload, 'coord-token');
    expect(outcome).toEqual({
      ok: false,
      kind: 'validation',
      message: 'Invalid planning details',
      details: ['registration_closes_at must be after registration_opens_at.'],
    });

    // Without details
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: 'eventId must be a positive integer.',
          },
          400,
        ),
      ),
    );
    const noDetailsOutcome = await updateEventPlanning(42, mockPayload, 'coord-token');
    expect(noDetailsOutcome).toEqual({
      ok: false,
      kind: 'validation',
      message: 'eventId must be a positive integer.',
      details: undefined,
    });

    // Without message
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    const fallbackValidation = await updateEventPlanning(42, mockPayload, 'coord-token');
    expect(fallbackValidation).toEqual({
      ok: false,
      kind: 'validation',
      message: 'Invalid planning details.',
      details: undefined,
    });
  });

  test('[FAILURE] [SG2-39:AC1] handles 401 unauthorized with custom and fallback messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'Token expired' }, 401)),
    );
    expect(await updateEventPlanning(42, mockPayload, 'bad-token')).toEqual({
      ok: false,
      kind: 'unauthorized',
      message: 'Token expired',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    expect(await updateEventPlanning(42, mockPayload, 'bad-token')).toEqual({
      ok: false,
      kind: 'unauthorized',
      message: 'Authentication required',
    });
  });

  test('[FAILURE] [SG2-39:AC1] handles 403 forbidden with custom and fallback messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'Only assigned coordinator can update.' }, 403),
      ),
    );
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'forbidden',
      message: 'Only assigned coordinator can update.',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 403)));
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'forbidden',
      message: 'Access denied',
    });
  });

  test('[FAILURE] [SG2-39:AC1] handles 404 not found with custom and fallback messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: 'Event request does not exist.' }, 404),
      ),
    );
    expect(await updateEventPlanning(999, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'Event request does not exist.',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 404)));
    expect(await updateEventPlanning(999, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'not_found',
      message: 'Event request not found.',
    });
  });

  test('[FAILURE] [SG2-39:AC1] handles 503 unavailable with custom and fallback messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'DB down' }, 503)),
    );
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'DB down',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('[FAILURE] [SG2-39:AC1] handles unexpected HTTP error (e.g. 500) with custom and fallback messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'Fatal error' }, 500)),
    );
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Fatal error',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Failed to update planning details (HTTP 500).',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })),
    );
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Failed to update planning details (HTTP 502).',
    });
  });

  test('[FAILURE] [SG2-39:AC1] handles network failure (fetch rejected)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection lost')));
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });
  });

  test('[FAILURE] [SG2-39:AC1] handles 200 OK with empty or malformed body or missing event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, 200)));
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 200)));
    expect(await updateEventPlanning(42, mockPayload, 'coord-token')).toEqual({
      ok: false,
      kind: 'unavailable',
      message: 'Could not reach the server. Please try again.',
    });
  });
});

describe('fetchAssignable (SG2-33/34)', () => {
  const body = {
    requests: [
      { event_id: 7, name: 'Forum', organisation: 'Acme', status: 'approved', coordinator_id: 'c1', coordinator_name: 'Sarah' },
      { event_id: 'x', name: null, organisation: null, status: null, coordinator_id: null, coordinator_name: null },
    ],
    coordinators: [{ user_id: 'c1', name: 'Sarah' }, { user_id: null, name: null }],
  };

  test('[NORMAL] [SG2-33:AC1] calls the assignable endpoint with the bearer token and maps the rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAssignable('tok');

    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/assignable', {
      method: 'GET',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(result).toEqual({
      ok: true,
      requests: [
        { eventId: 7, name: 'Forum', organisation: 'Acme', status: 'approved', coordinatorId: 'c1', coordinatorName: 'Sarah' },
        { eventId: 0, name: '', organisation: null, status: 'submitted', coordinatorId: null, coordinatorName: null },
      ],
      coordinators: [{ userId: 'c1', name: 'Sarah' }, { userId: '', name: '' }],
    });
  });

  test.each([401, 403])('[FAILURE] [SG2-33:AC1] reports unauthorized on %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await fetchAssignable('tok')).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test('[FAILURE] [SG2-33:AC1] reports unavailable on a server error, a network failure or a malformed body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    expect(await fetchAssignable('tok')).toEqual({ ok: false, kind: 'unavailable' });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchAssignable('tok')).toEqual({ ok: false, kind: 'unavailable' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ requests: [] })));
    expect(await fetchAssignable('tok')).toEqual({ ok: false, kind: 'unavailable' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));
    expect(await fetchAssignable('tok')).toEqual({ ok: false, kind: 'unavailable' });
  });
});

describe('assignCoordinator (SG2-33/34)', () => {
  test('[NORMAL] [SG2-33:AC1] patches the coordinator endpoint with the chosen coordinator', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ request: {} }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await assignCoordinator(7, 'c1', 'tok')).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/event-requests/7/coordinator', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: JSON.stringify({ coordinatorId: 'c1' }),
    });
  });

  test.each([401, 403])('[FAILURE] [SG2-33:AC1] tells the user only Technical Support can assign on %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await assignCoordinator(7, 'c1', 'tok')).toEqual({
      ok: false,
      message: 'Only Technical Support Staff can assign a coordinator. Sign in again.',
    });
  });

  test.each([400, 404])("[FAILURE] [SG2-33:AC1] relays the server's reason on %i", async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Not assignable.' }, { status })));
    expect(await assignCoordinator(7, 'c1', 'tok')).toEqual({ ok: false, message: 'Not assignable.' });
  });

  test('[CONFLICT] [SG2-33:AC1] relays a refusal when the request is no longer assignable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Not assignable.' }, { status: 409 })));
    expect(await assignCoordinator(7, 'c1', 'tok')).toEqual({ ok: false, message: 'Not assignable.' });
  });

  test('[CONFLICT] [SG2-33:AC1] falls back to a generic message when a rejection carries no reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 409 })));
    expect(await assignCoordinator(7, 'c1', 'tok')).toEqual({ ok: false, message: 'That assignment was not accepted.' });
  });

  test('[FAILURE] [SG2-33:assignment-errors] reports a retryable failure for a server error or a network failure', async () => {
    const retry = { ok: false, message: 'Could not save the assignment. Please try again.' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    expect(await assignCoordinator(7, 'c1', 'tok')).toEqual(retry);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await assignCoordinator(7, 'c1', 'tok')).toEqual(retry);
  });
});
