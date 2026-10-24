import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchCoordinatorOverview } from './coordinatorOverview';

afterEach(() => vi.unstubAllGlobals());

const RAW_EVENT = {
  event_id: 4, name: 'Partner Forum', organisation: 'Acme', status: 'needs_clarification',
  proposed_date: '2030-06-15T02:00:00.000Z', coordinator_id: 'c1', coordinator_name: 'Ada Coordinator',
};
const ALL = { coordinatorId: '', status: '' };

describe('fetchCoordinatorOverview (SG2-89)', () => {
  test('[NORMAL] [SG2-89:AC1] [SG2-89:AC2] maps events, workloads and statuses and sends the bearer token', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({
      events: [RAW_EVENT],
      coordinators: [{ user_id: 'c1', name: 'Ada Coordinator', active_events: 1, assignable: true }],
      statuses: ['needs_clarification', 'planning'],
    }));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchCoordinatorOverview('tok', ALL)).toEqual({
      ok: true,
      events: [{
        eventId: 4, name: 'Partner Forum', organisation: 'Acme', status: 'needs_clarification',
        proposedDate: '2030-06-15T02:00:00.000Z', coordinatorId: 'c1', coordinatorName: 'Ada Coordinator',
      }],
      coordinators: [{ userId: 'c1', name: 'Ada Coordinator', activeEvents: 1, assignable: true }],
      statuses: ['needs_clarification', 'planning'],
    });
    expect(fetch).toHaveBeenCalledWith('/api/coordinator-overview', { method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  test('[NORMAL] [SG2-89:AC3] sends the coordinator and status filters it is given, and only those', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ events: [], coordinators: [], statuses: [] }));
    vi.stubGlobal('fetch', fetch);
    await fetchCoordinatorOverview('tok', { coordinatorId: 'c 1', status: 'planning' });
    await fetchCoordinatorOverview('tok', { coordinatorId: '', status: 'needs_clarification' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/coordinator-overview?coordinatorId=c+1&status=planning',
      '/api/coordinator-overview?status=needs_clarification',
    ]);
  });

  test('[BOUNDARY] [SG2-89:AC1] missing details come through as null or empty, never invented', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
      events: [{ event_id: 'x' }], coordinators: [{}], statuses: ['planning', 3],
    })));
    expect(await fetchCoordinatorOverview('tok', ALL)).toEqual({
      ok: true,
      events: [{ eventId: 0, name: '', organisation: null, status: '', proposedDate: null, coordinatorId: '', coordinatorName: null }],
      coordinators: [{ userId: '', name: '', activeEvents: 0, assignable: false }],
      statuses: ['planning'],
    });
  });

  test.each([401, 403])('[FAILURE] [SG2-89:AC4] a %i is reported as not allowed', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    expect(await fetchCoordinatorOverview('tok', ALL)).toEqual({ ok: false, kind: 'unauthorized' });
  });

  test('[FAILURE] [SG2-89:AC3] a refused filter carries the server\'s reason, or a fallback', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ error: 'status must be the status of an active event.' }, { status: 400 }))
      .mockResolvedValueOnce(new Response('not json', { status: 400 })));
    expect(await fetchCoordinatorOverview('tok', { coordinatorId: '', status: 'draft' }))
      .toEqual({ ok: false, kind: 'invalid', message: 'status must be the status of an active event.' });
    expect(await fetchCoordinatorOverview('tok', { coordinatorId: '', status: 'draft' }))
      .toEqual({ ok: false, kind: 'invalid', message: 'Those filters were not accepted.' });
  });

  test('[FAILURE] [SG2-89:AC1] a network error, a server error or a malformed answer is unavailable', async () => {
    for (const answer of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.resolve(Response.json({ events: [], coordinators: [] })),
      () => Promise.resolve(Response.json({ events: {}, coordinators: [], statuses: [] })),
      () => Promise.resolve(Response.json({ events: [], coordinators: null, statuses: [] })),
    ]) {
      vi.stubGlobal('fetch', vi.fn(answer));
      expect(await fetchCoordinatorOverview('tok', ALL)).toEqual({ ok: false, kind: 'unavailable' });
    }
  });
});
