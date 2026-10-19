import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchSafetyChecks } from './safetyChecks';

afterEach(() => vi.unstubAllGlobals());

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
