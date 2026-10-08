import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchAssignmentQueue } from './assignmentQueue';

afterEach(() => vi.unstubAllGlobals());

const RAW = {
  event_id: 1, name: 'Leadership Forum', organiser_name: 'Olivia Organiser',
  proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 120, submitted_at: '2026-10-06T01:00:00.000Z'
};

describe('fetchAssignmentQueue (SG2-87)', () => {
  test('[NORMAL] [SG2-87:AC3] maps each queue entry and sends the bearer token', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ entries: [RAW] }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchAssignmentQueue('tok')).toEqual({
      ok: true,
      entries: [{
        eventId: 1, name: 'Leadership Forum', organiserName: 'Olivia Organiser',
        proposedDate: '2030-06-15T02:00:00.000Z', expectedAttendance: 120, submittedAt: '2026-10-06T01:00:00.000Z',
      }],
    });
    expect(fetch).toHaveBeenCalledWith('/api/assignment-queue', { method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  test('[BOUNDARY] [SG2-87:AC3] missing optional details come through as null, not as invented values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ entries: [{ event_id: 2 }, { event_id: 'x' }] })));
    expect(await fetchAssignmentQueue('tok')).toEqual({
      ok: true,
      entries: [
        { eventId: 2, name: '', organiserName: null, proposedDate: null, expectedAttendance: null, submittedAt: null },
        { eventId: 0, name: '', organiserName: null, proposedDate: null, expectedAttendance: null, submittedAt: null },
      ],
    });
  });

  test.each([401, 403])('[FAILURE] [SG2-87:AC2] a %i is reported as not allowed', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await fetchAssignmentQueue('tok')).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test('[FAILURE] [SG2-87:AC2] a server error, a malformed body or a network failure is reported as unavailable', async () => {
    for (const reply of [
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.resolve(Response.json({ entries: 'nope' })),
      () => Promise.resolve(new Response('not json', { status: 200 })),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockImplementation(reply));
      expect(await fetchAssignmentQueue('tok')).toEqual({ ok: false, kind: 'unavailable' });
    }
  });
});
