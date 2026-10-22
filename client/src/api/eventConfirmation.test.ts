import { afterEach, expect, test, vi } from 'vitest';
import { ARRANGEMENT_LABELS, EventConfirmationError, confirmEvent, loadEventConfirmation } from './eventConfirmation';

afterEach(() => { vi.unstubAllGlobals(); });

function respond(response: () => Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response());
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const UNAVAILABLE = { ok: false, kind: 'unavailable', message: 'Could not confirm the event. Please try again.' };
const view = {
  event_id: 7, status: 'confirmed', confirmed_at: '2026-10-11T02:00:00.000Z',
  venues: [{ venue_name: 'Regression Hall', starts_at: '2030-06-20T02:00:00.000Z', ends_at: '2030-06-20T06:00:00.000Z' }],
  equipment: [{ equipment_type: 'Wireless microphones', quantity_reserved: 12 }],
  registration: { needed: true, capacity: 120, opens_at: '2030-06-01T01:00:00.000Z', closes_at: '2030-06-19T15:59:00.000Z', window: 'not_yet_open' },
};

test('[NORMAL] [SG2-58:AC1] confirming sends one authorised PATCH and returns the confirmation time and notification flag', async () => {
  const fetch = respond(() => Response.json({ event_id: 7, status: 'confirmed', confirmed_at: '2026-10-11T02:00:00.000Z', organiser_notified: true }));
  expect(await confirmEvent(7, 'coordinator-token')).toEqual({ ok: true, confirmedAt: '2026-10-11T02:00:00.000Z', organiserNotified: true });
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/7/confirm', { method: 'PATCH', headers: { Authorization: 'Bearer coordinator-token' } });
  respond(() => Response.json({ confirmed_at: '2026-10-11T02:00:00.000Z', organiser_notified: false }));
  expect(await confirmEvent(7, 'coordinator-token')).toEqual({ ok: true, confirmedAt: '2026-10-11T02:00:00.000Z', organiserNotified: false });
  expect(ARRANGEMENT_LABELS).toEqual({ venue: 'Venue booking', equipment: 'Equipment', registration: 'Registration', safety: 'Safety check' });
});

test('[CONFLICT] [SG2-58:AC2] an outstanding refusal keeps the server message and order and drops unknown keys', async () => {
  respond(() => Response.json({ error: 'Confirmation refused: arrangements are still outstanding.', code: 'outstanding', outstanding: ['venue', 'equipment', 'registration'] }, { status: 409 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'outstanding', message: 'Confirmation refused: arrangements are still outstanding.', outstanding: ['venue', 'equipment', 'registration'] });
  respond(() => Response.json({ code: 'outstanding', outstanding: ['catering', 'registration', 3, 'venue'] }, { status: 409 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'outstanding', message: 'Confirmation refused: arrangements are still outstanding.', outstanding: ['registration', 'venue'] });
  respond(() => Response.json({ error: 'Refused.', code: 'outstanding', outstanding: 'venue' }, { status: 409 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'outstanding', message: 'Refused.', outstanding: [] });
});

test('[CONFLICT] [SG2-94:AC5] a refusal for an unapproved safety check keeps safety among the outstanding items in server order', async () => {
  respond(() => Response.json({ error: 'Confirmation refused: arrangements are still outstanding.', code: 'outstanding', outstanding: ['venue', 'safety'] }, { status: 409 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'outstanding', message: 'Confirmation refused: arrangements are still outstanding.', outstanding: ['venue', 'safety'] });
  respond(() => Response.json({ code: 'outstanding', outstanding: ['safety'] }, { status: 409 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'outstanding', message: 'Confirmation refused: arrangements are still outstanding.', outstanding: ['safety'] });
});

test('[CONFLICT] [SG2-58:AC1] a stale status, missing event or invalid id is refused with the server text verbatim', async () => {
  respond(() => Response.json({ error: 'Only an event in Preparation can be confirmed.', code: 'closed' }, { status: 409 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'refused', message: 'Only an event in Preparation can be confirmed.' });
  respond(() => Response.json({ error: 'No event in preparation is assigned to this account.' }, { status: 404 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'refused', message: 'No event in preparation is assigned to this account.' });
  respond(() => new Response('not json', { status: 400 }));
  expect(await confirmEvent(0, 'token')).toEqual({ ok: false, kind: 'refused', message: 'That change was not accepted.' });
  respond(() => Response.json('Conflict', { status: 409 }));
  expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'refused', message: 'That change was not accepted.' });
});

test('[FAILURE] [SG2-58:AC1] auth failures, server failures, network errors and malformed success bodies are explained', async () => {
  for (const status of [401, 403]) {
    respond(() => Response.json({ error: 'Forbidden' }, { status }));
    expect(await confirmEvent(7, 'token')).toEqual({ ok: false, kind: 'unauthorized', message: 'Only the assigned Event Coordinator can confirm this event.' });
  }
  respond(() => Response.json({ error: 'Event confirmation is unavailable.' }, { status: 503 }));
  expect(await confirmEvent(7, 'token')).toEqual(UNAVAILABLE);
  respond(() => { throw new TypeError('Failed to fetch'); });
  expect(await confirmEvent(7, 'token')).toEqual(UNAVAILABLE);
  for (const body of [null, {}, { confirmed_at: '2026-10-11T02:00:00.000Z' }, { confirmed_at: 1, organiser_notified: true }]) {
    respond(() => Response.json(body));
    expect(await confirmEvent(7, 'token')).toEqual(UNAVAILABLE);
  }
});

test('[NORMAL] [SG2-58:AC1] [SG2-58:AC3] the confirmed arrangements are read uncached with the caller token and signal', async () => {
  const fetch = respond(() => Response.json(view));
  const signal = new AbortController().signal;
  expect(await loadEventConfirmation(7, 'organiser-token', signal)).toEqual(view);
  expect(fetch).toHaveBeenCalledWith('/api/event-requests/7/confirmation', { cache: 'no-store', signal, headers: { Authorization: 'Bearer organiser-token' } });
});

test('[BOUNDARY] [SG2-58:AC3] completed events, empty lists, unrequired registration and unset times are valid views', async () => {
  const minimal = { ...view, status: 'completed', confirmed_at: null, venues: [], equipment: [],
    registration: { needed: false, capacity: null, opens_at: null, closes_at: null, window: 'not_required' } };
  respond(() => Response.json(minimal));
  expect(await loadEventConfirmation(7, 'token')).toEqual(minimal);
});

test('[FAILURE] [SG2-58:AC1] a 404 is distinguishable and other failures or malformed views throw a typed error', async () => {
  for (const status of [404, 401, 503]) {
    respond(() => Response.json({ error: 'No' }, { status }));
    const failure = await loadEventConfirmation(7, 'token').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EventConfirmationError);
    expect(failure).toMatchObject({ status, message: 'Confirmed arrangements could not be loaded. Please try again.' });
  }
  const registration = view.registration;
  for (const body of [null, { ...view, event_id: '7' }, { ...view, status: 'preparation' }, { ...view, confirmed_at: 5 },
    { ...view, venues: null }, { ...view, venues: [null] }, { ...view, venues: [{ ...view.venues[0], starts_at: null }] }, { ...view, venues: [{ ...view.venues[0], ends_at: 1 }] },
    { ...view, equipment: {} }, { ...view, equipment: [null] }, { ...view, equipment: [{ equipment_type: 'Mic', quantity_reserved: 1.5 }] },
    { ...view, registration: null }, { ...view, registration: { ...registration, capacity: '120' } },
    { ...view, registration: { ...registration, opens_at: 1 } }, { ...view, registration: { ...registration, closes_at: 1 } },
    { ...view, registration: { ...registration, window: 'pending' } }]) {
    respond(() => Response.json(body));
    await expect(loadEventConfirmation(7, 'token')).rejects.toMatchObject({ status: 0 });
  }
});
