import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  confirmSafetyRereview,
  fetchSafetyChecks,
  fetchSafetyDecisions,
  fetchSafetyRereviews,
  recordSafetyDecision,
  reworkSafetyRejectedEvent,
  safetyArrangementList,
  safetyDecisionProblems,
} from './safetyChecks';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const UNAVAILABLE = { ok: false, kind: 'unavailable', message: 'Could not reach the server. Please try again.' };
const decision = {
  decision_id: 9, event_id: 12, decision: 'request_changes', reason: 'Move the stage', arrangements: ['venue'],
  decided_by: 'safety-1', decided_by_name: 'Sam Safety', decided_at: '2030-06-01T00:00:00.000Z',
};

const RAW = {
  event_id: 7, safety_check_revision: 3, name: 'Open Day', organisation: 'SMU', proposed_date: '2031-11-01T01:00:00.000Z',
  awaiting_since: '2031-10-01T02:00:00.000Z', expected_attendance: 120, accessibility_needs: 'Wheelchair seating',
  expected_crowd_movement: 'Enter east, leave west',
  venues: [{ request_id: 11, venue_id: 4, venue_name: 'Hall', location: 'Level 1', capacity: 300, layout: 'theatre',
    starts_at: '2031-11-01T01:00:00.000Z', ends_at: '2031-11-01T09:00:00.000Z', accessibility_features: 'Ramp',
    emergency_access: 'Two exits', known_restrictions: 'No open flames' }],
  equipment: [{ request_id: 21, equipment_name: 'Speakers', quantity: 2, placement_venue_name: 'Hall',
    placement_position: 'Stage left', arrangement_notes: 'Cable ramps' }],
};

describe('fetchSafetyChecks (SG2-91)', () => {
  test('[NORMAL] [SG2-91:AC2] [SG2-91:AC3] maps every review detail and sends the bearer token', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ events: [RAW] }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchSafetyChecks('tok')).toEqual({
      ok: true,
      events: [{
        eventId: 7, revision: 3, name: 'Open Day', organisation: 'SMU', proposedDate: '2031-11-01T01:00:00.000Z',
        awaitingSince: '2031-10-01T02:00:00.000Z', expectedAttendance: 120, accessibilityNeeds: 'Wheelchair seating',
        expectedCrowdMovement: 'Enter east, leave west',
        venues: [{ requestId: 11, name: 'Hall', location: 'Level 1', capacity: 300, layout: 'theatre',
          startsAt: '2031-11-01T01:00:00.000Z', endsAt: '2031-11-01T09:00:00.000Z', accessibilityFeatures: 'Ramp',
          emergencyAccess: 'Two exits', knownRestrictions: 'No open flames' }],
        equipment: [{ requestId: 21, name: 'Speakers', quantity: 2, placementVenue: 'Hall',
          placementPosition: 'Stage left', arrangementNotes: 'Cable ramps' }],
      }],
    });
    expect(fetch).toHaveBeenCalledWith('/api/safety-checks', { method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  test('[BOUNDARY] [SG2-91:AC3] details never recorded come through as null or empty, not as invented values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ events: [
      { event_id: 'x', venues: [{}], equipment: [{}] },
      { event_id: 8, venues: 'none', equipment: null },
    ] })));
    expect(await fetchSafetyChecks('tok')).toEqual({
      ok: true,
      events: [
        { eventId: 0, revision: 0, name: '', organisation: null, proposedDate: null, awaitingSince: null, expectedAttendance: null,
          accessibilityNeeds: null, expectedCrowdMovement: null,
          venues: [{ requestId: 0, name: '', location: null, capacity: null, layout: null, startsAt: null, endsAt: null,
            accessibilityFeatures: null, emergencyAccess: null, knownRestrictions: null }],
          equipment: [{ requestId: 0, name: '', quantity: 0, placementVenue: null, placementPosition: null, arrangementNotes: null }] },
        { eventId: 8, revision: 0, name: '', organisation: null, proposedDate: null, awaitingSince: null, expectedAttendance: null,
          accessibilityNeeds: null, expectedCrowdMovement: null, venues: [], equipment: [] },
      ],
    });
  });

  test.each([401, 403])('[FAILURE] [SG2-91:AC4] a %i is reported as not allowed', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await fetchSafetyChecks('tok')).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test.each([
    ['a server error', () => Promise.resolve(new Response(null, { status: 503 }))],
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
    ['a body that is not JSON', () => Promise.resolve(new Response('not json', { status: 200 }))],
    ['a body without a list', () => Promise.resolve(Response.json({ events: null }))],
  ])('[FAILURE] [SG2-91:AC2] %s is reported as unavailable', async (_, reply) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(reply));
    expect(await fetchSafetyChecks('tok')).toEqual({ ok: false, kind: 'unavailable' });
  });
});

describe('safetyDecisionProblems (SG2-92 AC2)', () => {
  test('[NORMAL] [SG2-92:AC2] a complete decision has no problems', () => {
    expect(safetyDecisionProblems({ decision: 'approve', reason: '', arrangements: [] })).toEqual([]);
    expect(safetyDecisionProblems({ decision: 'request_changes', reason: 'Move the stage', arrangements: ['venue'] })).toEqual([]);
  });

  test('[FAILURE] [SG2-92:AC2] Reject and Request changes need a reason, and Request changes an arrangement', () => {
    expect(safetyDecisionProblems({ decision: 'reject', reason: '   ', arrangements: [] }))
      .toEqual(['Give a reason to reject this event.']);
    expect(safetyDecisionProblems({ decision: 'request_changes', reason: '', arrangements: [] }))
      .toEqual(['Give a reason to request changes.', 'Name at least one arrangement to change.']);
  });

  test('[BOUNDARY] [SG2-92:AC2] the reason limit is 2000 characters, an emoji counting as one', () => {
    expect(safetyDecisionProblems({ decision: 'reject', reason: '🔥'.repeat(2000), arrangements: [] })).toEqual([]);
    expect(safetyDecisionProblems({ decision: 'approve', reason: 'x'.repeat(2001), arrangements: [] }))
      .toEqual(['Keep the reason to 2000 characters or fewer.']);
  });

  test('[NORMAL] [SG2-92:AC2] named arrangements read in order', () => {
    expect(safetyArrangementList(['venue', 'equipment', 'other'])).toBe('Venue, Equipment and technical, Other');
  });
});

describe('recordSafetyDecision (SG2-92)', () => {
  const recorded = { decision, previous_status: 'awaiting_safety_check', status: 'planning' };

  test('[NORMAL] [SG2-92:AC1] [SG2-92:AC2] posts the decision on the reviewed revision with its trimmed reason and, for Request changes, the arrangements', async () => {
    const fetch = respond(() => Response.json(recorded, { status: 201 }));
    expect(await recordSafetyDecision(12, { decision: 'request_changes', reason: ' Move the stage ', arrangements: ['venue'] }, 4, 'safety-token'))
      .toEqual({ ok: true, recorded });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/safety-decision', {
      method: 'POST',
      headers: { Authorization: 'Bearer safety-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'request_changes', safety_check_revision: 4, reason: 'Move the stage', arrangements: ['venue'] }),
    });
  });

  test('[BOUNDARY] [SG2-92:AC1] an Approve without a note sends only the decision and the reviewed revision', async () => {
    const fetch = respond(() => Response.json(recorded, { status: 201 }));
    await recordSafetyDecision(12, { decision: 'approve', reason: '   ', arrangements: ['venue'] }, 4, 't');
    expect(fetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ decision: 'approve', safety_check_revision: 4 }));
  });

  test('[CONFLICT] [SG2-92:AC1] a closed check reports the server message and the event status; validation details are kept', async () => {
    respond(() => Response.json({ error: 'This event is no longer awaiting a safety check.', status: 'preparation' }, { status: 409 }));
    expect(await recordSafetyDecision(12, { decision: 'approve', reason: '', arrangements: [] }, 4, 't')).toEqual({
      ok: false, kind: 'conflict', message: 'This event is no longer awaiting a safety check.', status: 'preparation',
    });
    respond(() => Response.json({ error: 'Invalid safety decision', details: ['A reason is required to reject.', 7] }, { status: 400 }));
    expect(await recordSafetyDecision(12, { decision: 'reject', reason: 'x', arrangements: [] }, 4, 't')).toEqual({
      ok: false, kind: 'validation', message: 'Invalid safety decision', details: ['A reason is required to reject.'],
    });
  });

  test('[CONFLICT] [SG2-92:AC1] a decision on a review the event has moved on from reads as stale, apart from a closed check', async () => {
    const message = 'This event changed after you opened it. Refresh the safety checks and review it again.';
    respond(() => Response.json({ error: message, code: 'stale', revision: 5 }, { status: 409 }));
    expect(await recordSafetyDecision(12, { decision: 'approve', reason: '', arrangements: [] }, 4, 't'))
      .toEqual({ ok: false, kind: 'stale', message });
  });

  test('[FAILURE] [SG2-92:AC1] network failures, a missing event and malformed replies are reported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await recordSafetyDecision(12, { decision: 'approve', reason: '', arrangements: [] }, 4, 't')).toEqual(UNAVAILABLE);
    respond(() => new Response(null, { status: 404 }));
    expect(await recordSafetyDecision(12, { decision: 'approve', reason: '', arrangements: [] }, 4, 't')).toEqual({
      ok: false, kind: 'not_found', message: 'This event could not be found. Refresh and try again.' });
    for (const body of [{ status: 7, decision }, { status: 'planning' }, { status: 'planning', decision: null }]) {
      respond(() => Response.json(body, { status: 201 }));
      expect(await recordSafetyDecision(12, { decision: 'approve', reason: '', arrangements: [] }, 4, 't')).toEqual(UNAVAILABLE);
    }
  });
});

describe('fetchSafetyDecisions (SG2-92 AC6)', () => {
  test('[NORMAL] [SG2-92:AC6] [SG2-93:AC5] reads every decision on the event and what each sent back to staff', async () => {
    const rereview = {
      review_id: 3, decision_id: 9, arrangement: 'venue', label: 'Regression Hall (10 Jul 2030 10:00 – 14:00 SGT)',
      flagged_at: '2030-06-01T00:00:00.000Z', resolution: null, resolved_by_name: null, resolved_at: null,
    };
    const fetch = respond(() => Response.json({ decisions: [decision], rereviews: [rereview] }));
    expect(await fetchSafetyDecisions(12, 'token')).toEqual({ ok: true, decisions: [decision], rereviews: [rereview] });
    expect(fetch.mock.calls[0][0]).toBe('/api/event-requests/12/safety-decisions');
  });

  test('[FAILURE] [SG2-92:AC6] [SG2-93:AC5] a refused, unreachable or malformed read fails', async () => {
    respond(() => new Response(null, { status: 404 }));
    expect((await fetchSafetyDecisions(12, 't')).ok).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({ decisions: {}, rereviews: [] }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({ decisions: [decision] }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual(UNAVAILABLE);
  });

  test('[FAILURE] [SG2-92:AC6] refusals keep the server text, else fall back to plain wording per status', async () => {
    respond(() => Response.json({ error: 'Access denied' }, { status: 403 }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual({ ok: false, kind: 'unauthorized', message: 'Access denied' });
    respond(() => new Response(null, { status: 401 }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual({ ok: false, kind: 'unauthorized',
      message: 'You do not have access to this. Sign in again if your session has expired.' });
    respond(() => new Response(null, { status: 503 }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual(UNAVAILABLE);
    respond(() => new Response(null, { status: 418 }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual({ ok: false, kind: 'error', message: 'Could not load the safety decisions (HTTP 418).' });
    respond(() => new Response('not json', { status: 200 }));
    expect(await fetchSafetyDecisions(12, 't')).toEqual(UNAVAILABLE);
  });
});

describe('reworkSafetyRejectedEvent (SG2-92 AC4)', () => {
  test('[NORMAL] [SG2-92:AC4] posts the rework and returns the new status', async () => {
    const fetch = respond(() => Response.json({ event_id: 12, status: 'planning' }));
    expect(await reworkSafetyRejectedEvent(12, 'coord-token')).toEqual({ ok: true, status: 'planning' });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/rework', { method: 'POST', headers: { Authorization: 'Bearer coord-token' } });
  });

  test('[FAILURE] [SG2-92:AC4] a refusal, a network failure or a malformed reply is reported', async () => {
    respond(() => Response.json({ error: 'Only a Safety Rejected event can be reworked.', status: 'planning' }, { status: 409 }));
    expect(await reworkSafetyRejectedEvent(12, 't')).toEqual({
      ok: false, kind: 'conflict', message: 'Only a Safety Rejected event can be reworked.', status: 'planning' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await reworkSafetyRejectedEvent(12, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({}));
    expect(await reworkSafetyRejectedEvent(12, 't')).toEqual(UNAVAILABLE);
  });
});

const QUEUE_ITEM = {
  review_id: 3, arrangement: 'venue', event_id: 12, event_name: 'Open Day', proposed_date: '2030-07-10T02:00:00.000Z',
  coordinator_name: 'Casey Coordinator', flagged_at: '2030-06-01T00:00:00.000Z',
  label: 'Regression Hall (10 Jul 2030 10:00 – 14:00 SGT)', reason: 'Widen the aisles', decided_by_name: 'Sam Safety',
  layout: 'theatre', placement_venue_name: null, placement_position: null,
};

describe('fetchSafetyRereviews (SG2-93 AC2)', () => {
  test('[NORMAL] [SG2-93:AC2] reads the acting role\'s flags with the bearer token', async () => {
    const fetch = respond(() => Response.json({ arrangement: 'venue', rereviews: [QUEUE_ITEM] }));
    expect(await fetchSafetyRereviews('venue-token')).toEqual({ ok: true, arrangement: 'venue', rereviews: [QUEUE_ITEM] });
    expect(fetch).toHaveBeenCalledWith('/api/safety-rereviews', { method: 'GET', headers: { Authorization: 'Bearer venue-token' } });
    respond(() => Response.json({ arrangement: 'equipment', rereviews: [] }));
    expect(await fetchSafetyRereviews('t')).toEqual({ ok: true, arrangement: 'equipment', rereviews: [] });
  });

  test('[FAILURE] [SG2-93:AC2] a refused, unreachable or malformed read fails', async () => {
    respond(() => Response.json({ error: 'Access denied' }, { status: 403 }));
    expect(await fetchSafetyRereviews('t')).toEqual({ ok: false, kind: 'unauthorized', message: 'Access denied' });
    respond(() => new Response(null, { status: 418 }));
    expect(await fetchSafetyRereviews('t')).toEqual({
      ok: false, kind: 'error', message: 'Could not load the safety changes to confirm (HTTP 418).' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await fetchSafetyRereviews('t')).toEqual(UNAVAILABLE);
    for (const body of [null, { arrangement: 'other', rereviews: [] }, { arrangement: 'venue', rereviews: {} }]) {
      respond(() => Response.json(body));
      expect(await fetchSafetyRereviews('t')).toEqual(UNAVAILABLE);
    }
  });
});

describe('confirmSafetyRereview (SG2-93 AC2/AC4)', () => {
  test('[NORMAL] [SG2-93:AC4] posts the confirmation and returns where the event now stands', async () => {
    const confirmed = { review_id: 3, event_id: 12, status: 'awaiting_safety_check', outstanding_arrangements: [] };
    const fetch = respond(() => Response.json(confirmed));
    expect(await confirmSafetyRereview(3, 'venue-token')).toEqual({ ok: true, confirmed });
    expect(fetch).toHaveBeenCalledWith('/api/safety-rereviews/3/confirm', { method: 'POST', headers: { Authorization: 'Bearer venue-token' } });
  });

  test('[CONFLICT] [SG2-93:AC2] a flag already dealt with is a conflict in the server\'s words', async () => {
    respond(() => Response.json({ error: 'This booking or equipment request has already been dealt with.', resolution: 'confirmed' }, { status: 409 }));
    expect(await confirmSafetyRereview(3, 't')).toEqual({
      ok: false, kind: 'conflict', message: 'This booking or equipment request has already been dealt with.' });
  });

  test('[FAILURE] [SG2-93:AC2] a missing flag, a network failure or a malformed reply is reported', async () => {
    respond(() => Response.json({ error: 'That safety re-review was not found.' }, { status: 404 }));
    expect(await confirmSafetyRereview(3, 't')).toEqual({ ok: false, kind: 'not_found', message: 'That safety re-review was not found.' });
    respond(() => new Response(null, { status: 500 }));
    expect(await confirmSafetyRereview(3, 't')).toEqual({ ok: false, kind: 'error', message: 'Could not confirm the change (HTTP 500).' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect(await confirmSafetyRereview(3, 't')).toEqual(UNAVAILABLE);
    respond(() => Response.json({ review_id: 3 }));
    expect(await confirmSafetyRereview(3, 't')).toEqual(UNAVAILABLE);
  });
});
