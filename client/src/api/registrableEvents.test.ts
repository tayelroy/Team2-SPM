import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchRegistrableEvent, fetchRegistrableEvents } from './registrableEvents';

const raw = {
  event_id: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture.', proposed_date: '2030-07-20T11:00:00.000Z',
  registration_opens_at: '2026-10-01T00:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }],
};
const parsed = {
  eventId: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture.', proposedDate: '2030-07-20T11:00:00.000Z',
  registrationOpensAt: '2026-10-01T00:00:00.000Z', registrationClosesAt: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }],
};

function serve(...responses: (() => Response)[]) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockImplementationOnce(async () => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchRegistrableEvents', () => {
  test('[NORMAL] [SG2-59:AC1] reads the list with the bearer token and maps each event', async () => {
    const fetch = serve(() => Response.json({ events: [raw] }));
    expect(await fetchRegistrableEvents('attendee-token')).toEqual({ ok: true, events: [parsed] });
    expect(fetch).toHaveBeenCalledWith('/api/registrable-events', { method: 'GET', headers: { Authorization: 'Bearer attendee-token' } });
  });

  test('[BOUNDARY] [SG2-59:AC1] missing details become empty or null rather than invented', async () => {
    serve(() => Response.json({ events: [{ event_id: 'x', venues: [{ location: 3 }, 'hall'] }, { event_id: 2, venues: 'none' }, 'junk'] }));
    expect(await fetchRegistrableEvents('t')).toEqual({ ok: true, events: [
      { eventId: 0, name: '', organisation: null, category: null, description: null, proposedDate: null,
        registrationOpensAt: null, registrationClosesAt: null, venues: [{ name: 'Unnamed venue', location: null }] },
      { eventId: 2, name: '', organisation: null, category: null, description: null, proposedDate: null,
        registrationOpensAt: null, registrationClosesAt: null, venues: [] },
    ] });
  });

  test('[FAILURE] [SG2-59:AC1] refusals, failures and malformed bodies are reported by kind', async () => {
    serve(() => new Response(null, { status: 401 }), () => new Response(null, { status: 403 }),
      () => new Response(null, { status: 503 }), () => Response.json({ events: {} }), () => new Response('not json'));
    expect(await fetchRegistrableEvents('t')).toEqual({ ok: false, kind: 'unauthorized' });
    expect(await fetchRegistrableEvents('t')).toEqual({ ok: false, kind: 'unauthorized' });
    expect(await fetchRegistrableEvents('t')).toEqual({ ok: false, kind: 'unavailable' });
    expect(await fetchRegistrableEvents('t')).toEqual({ ok: false, kind: 'unavailable' });
    expect(await fetchRegistrableEvents('t')).toEqual({ ok: false, kind: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchRegistrableEvents('t')).toEqual({ ok: false, kind: 'unavailable' });
  });
});

describe('fetchRegistrableEvent', () => {
  test('[NORMAL] [SG2-59:AC3] reads one event by id', async () => {
    const fetch = serve(() => Response.json({ event: raw }));
    expect(await fetchRegistrableEvent(591, 'attendee-token')).toEqual({ ok: true, event: parsed });
    expect(fetch).toHaveBeenCalledWith('/api/registrable-events/591', { method: 'GET', headers: { Authorization: 'Bearer attendee-token' } });
  });

  test('[FAILURE] [SG2-59:AC2] an event that is not listed is not found, and other failures are reported by kind', async () => {
    serve(() => Response.json({ error: 'This event is not open for registration.' }, { status: 404 }),
      () => new Response(null, { status: 403 }), () => new Response(null, { status: 500 }), () => Response.json({ event: [raw] }));
    expect(await fetchRegistrableEvent(593, 't')).toEqual({ ok: false, kind: 'not_found' });
    expect(await fetchRegistrableEvent(593, 't')).toEqual({ ok: false, kind: 'unauthorized' });
    expect(await fetchRegistrableEvent(593, 't')).toEqual({ ok: false, kind: 'unavailable' });
    expect(await fetchRegistrableEvent(593, 't')).toEqual({ ok: false, kind: 'unavailable' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchRegistrableEvent(593, 't')).toEqual({ ok: false, kind: 'unavailable' });
  });
});
