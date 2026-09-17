import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  fetchOwnEventDetail,
  fetchOwnEventRequests,
  isWaitingOnOrganiser,
  submitEventRequest,
  type EventRequestDetail,
  type EventRequestSummary,
} from './eventRequests';

afterEach(() => {
  vi.unstubAllGlobals();
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
        name: 'Annual Tech Summit',
        proposed_date: '2026-11-20',
        status: 'draft',
        coordinator_id: null,
        coordinator_name: null,
      },
      {
        event_id: 102,
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
        waitingOnMe: true,
      },
      {
        eventId: 102,
        name: 'Leadership Workshop',
        proposedDate: '2026-12-05',
        status: 'submitted',
        coordinatorId: 'coord-uuid-1',
        coordinatorName: 'Jane Doe',
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
          waitingOnMe: true,
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
        waitingOnMe: true,
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
