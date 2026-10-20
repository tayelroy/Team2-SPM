import { afterEach, describe, expect, test, vi } from 'vitest';
import { EMPTY_SEARCH, fetchSearchOptions, searchEvents } from './eventSearch';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(response: () => Response | Promise<Response>) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const RAW_EVENT = {
  event_id: 7, name: 'Harbour Gala', organisation: 'Harbour Foundation', category: 'social', status: 'planning',
  proposed_date: '2031-11-01T02:00:00.000Z', coordinator_id: 'c1', coordinator_name: 'Alice', venues: ['Atrium'],
};
const RAW_FILTERS = {
  query: 'harbour', date_from: '2031-11-01', date_to: '2031-11-30', status: 'planning', venue_id: 4,
  category: 'social', coordinator_id: 'c1',
};

describe('searchEvents (SG2-70)', () => {
  test('[NORMAL] [SG2-70:AC1] [SG2-70:AC2] sends only the filters that are set, trimmed, with the bearer token, and maps each result', async () => {
    const fetch = respond(() => Response.json({ events: [RAW_EVENT], truncated: false, filters: RAW_FILTERS }));
    const result = await searchEvents({ ...EMPTY_SEARCH, q: '  harbour ', category: 'social', venue: '4' }, 'token');
    expect(fetch).toHaveBeenCalledWith('/api/event-search?q=harbour&venue=4&category=social', expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer token' },
    }));
    expect(result).toEqual({
      ok: true, truncated: false,
      events: [{ eventId: 7, name: 'Harbour Gala', organisation: 'Harbour Foundation', category: 'social', status: 'planning',
        proposedDate: '2031-11-01T02:00:00.000Z', coordinatorName: 'Alice', venues: ['Atrium'] }],
      filters: { query: 'harbour', dateFrom: '2031-11-01', dateTo: '2031-11-30', status: 'planning', venueId: 4,
        category: 'social', coordinatorId: 'c1' },
    });
  });

  test('[BOUNDARY] [SG2-70:AC4] with no filters set the search has no query string, and a truncated page says so', async () => {
    const fetch = respond(() => Response.json({ events: [], truncated: true, filters: {} }));
    const result = await searchEvents(EMPTY_SEARCH, 'token');
    expect(fetch.mock.calls[0][0]).toBe('/api/event-search');
    expect(result).toEqual({ ok: true, events: [], truncated: true, filters: {
      query: null, dateFrom: null, dateTo: null, status: null, venueId: null, category: null, coordinatorId: null,
    } });
  });

  test('[BOUNDARY] [SG2-70:AC1] details the server left out become empty values rather than errors', async () => {
    respond(() => Response.json({ events: [{ venues: ['Annex', 3] }, { event_id: 'x', venues: 'Atrium' }], filters: { venue_id: '4' } }));
    const result = await searchEvents(EMPTY_SEARCH, 'token');
    expect(result.ok && result.events).toEqual([
      { eventId: 0, name: '', organisation: null, category: null, status: '', proposedDate: null, coordinatorName: null, venues: ['Annex'] },
      { eventId: 0, name: '', organisation: null, category: null, status: '', proposedDate: null, coordinatorName: null, venues: [] },
    ]);
    expect(result.ok && result.filters.venueId).toBeNull();
  });

  test('[FAILURE] [SG2-70:AC2] a refused filter is reported with the server message, or a fallback', async () => {
    respond(() => Response.json({ error: 'Unknown event category.' }, { status: 400 }));
    expect(await searchEvents(EMPTY_SEARCH, 'token')).toEqual({ ok: false, kind: 'invalid', message: 'Unknown event category.' });
    respond(() => new Response('not json', { status: 400 }));
    expect(await searchEvents(EMPTY_SEARCH, 'token')).toEqual({ ok: false, kind: 'invalid', message: 'Check the search filters and try again.' });
  });

  test('[FAILURE] [SG2-70:AC3] a refused caller is unauthorized; anything else unexpected is unavailable', async () => {
    for (const status of [401, 403]) {
      respond(() => new Response(null, { status }));
      expect(await searchEvents(EMPTY_SEARCH, 'token')).toEqual({ ok: false, kind: 'unauthorized' });
    }
    for (const response of [() => new Response(null, { status: 503 }), () => Response.json({ events: 'x', filters: {} }),
      () => Response.json({ events: [], filters: [] }), () => Response.json({ events: [] })]) {
      respond(response);
      expect(await searchEvents(EMPTY_SEARCH, 'token')).toEqual({ ok: false, kind: 'unavailable' });
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await searchEvents(EMPTY_SEARCH, 'token')).toEqual({ ok: false, kind: 'unavailable' });
  });

  test('[CONFLICT] [SG2-70:AC1] the abort signal of a superseded search is passed to fetch', async () => {
    const fetch = respond(() => Response.json({ events: [], filters: {} }));
    const controller = new AbortController();
    await searchEvents(EMPTY_SEARCH, 'token', controller.signal);
    expect(fetch.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

describe('fetchSearchOptions (SG2-70)', () => {
  test('[NORMAL] [SG2-70:AC2] maps the venues and coordinators to filter by', async () => {
    const fetch = respond(() => Response.json({ venues: [{ venue_id: 4, name: 'Atrium' }], coordinators: [{ user_id: 'c1', name: 'Alice' }] }));
    expect(await fetchSearchOptions('token')).toEqual({
      ok: true, options: { venues: [{ venueId: 4, name: 'Atrium' }], coordinators: [{ userId: 'c1', name: 'Alice' }] },
    });
    expect(fetch.mock.calls[0][0]).toBe('/api/event-search/options');
  });

  test('[BOUNDARY] [SG2-70:AC2] options missing their details fall back to empty values', async () => {
    respond(() => Response.json({ venues: [{}], coordinators: [{}] }));
    expect(await fetchSearchOptions('token')).toEqual({
      ok: true, options: { venues: [{ venueId: 0, name: '' }], coordinators: [{ userId: '', name: '' }] },
    });
  });

  test('[FAILURE] [SG2-70:AC3] refusals, failures and malformed bodies are reported without throwing', async () => {
    respond(() => new Response(null, { status: 403 }));
    expect(await fetchSearchOptions('token')).toEqual({ ok: false, kind: 'unauthorized' });
    for (const response of [() => new Response(null, { status: 500 }), () => Response.json({ venues: [] }), () => new Response('x')]) {
      respond(response);
      expect(await fetchSearchOptions('token')).toEqual({ ok: false, kind: 'unavailable' });
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchSearchOptions('token')).toEqual({ ok: false, kind: 'unavailable' });
  });
});
