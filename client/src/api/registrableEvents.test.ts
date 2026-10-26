import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchRegistrableEvent, fetchRegistrableEvents, registerForEvent } from './registrableEvents';

const raw = {
  event_id: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture.', proposed_date: '2030-07-20T11:00:00.000Z',
  registration_opens_at: '2026-10-01T00:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: true,
};
const parsed = {
  eventId: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture.', proposedDate: '2030-07-20T11:00:00.000Z',
  registrationOpensAt: '2026-10-01T00:00:00.000Z', registrationClosesAt: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: true,
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
        registrationOpensAt: null, registrationClosesAt: null, venues: [{ name: 'Unnamed venue', location: null }], registered: false },
      { eventId: 2, name: '', organisation: null, category: null, description: null, proposedDate: null,
        registrationOpensAt: null, registrationClosesAt: null, venues: [], registered: false },
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

describe('registerForEvent', () => {
  const held = { registration_id: 7, event_id: 591, registered_at: '2030-06-02T01:00:00.000Z', contact_phone: '91234567', needs: null };

  test('[NORMAL] [SG2-60:AC1] [SG2-60:AC4] posts the phone and needs with the bearer token and returns the place held', async () => {
    const fetch = serve(() => Response.json({ registration: held }, { status: 201 }));
    expect(await registerForEvent(591, { contactPhone: '9123 4567', needs: 'Ramp' }, 'attendee-token'))
      .toEqual({ ok: true, registration: { registrationId: 7, registeredAt: '2030-06-02T01:00:00.000Z' } });
    expect(fetch).toHaveBeenCalledWith('/api/registrable-events/591/registrations', {
      method: 'POST', headers: { Authorization: 'Bearer attendee-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_phone: '9123 4567', needs: 'Ramp' }),
    });
  });

  test('[BOUNDARY] [SG2-60:AC4] blank needs are sent as none', async () => {
    const fetch = serve(() => Response.json({ registration: held }, { status: 201 }));
    await registerForEvent(591, { contactPhone: '91234567', needs: '   ' }, 't');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ contact_phone: '91234567', needs: null });
  });

  test('[FAILURE] [SG2-60:AC3] each refusal keeps the server message the attendee is shown', async () => {
    for (const [reason, error] of [['duplicate', 'You are already registered for this event.'], ['full', 'This event is full.'],
      ['not_open', 'Registration opens 01 Jun 2030 08:00 SGT.'], ['closed', 'Registration for this event has closed.']]) {
      serve(() => Response.json({ error, reason }, { status: 409 }));
      expect(await registerForEvent(591, { contactPhone: '91234567', needs: '' }, 't')).toEqual({ ok: false, kind: reason, message: error });
    }
  });

  test('[FAILURE] [SG2-60:AC4] invalid details come back with what to fix', async () => {
    serve(() => Response.json({ error: 'Check your registration details.', errors: ['contact_phone is required.', 5] }, { status: 400 }),
      () => Response.json({ error: 'Check your registration details.' }, { status: 400 }));
    expect(await registerForEvent(591, { contactPhone: '', needs: '' }, 't'))
      .toEqual({ ok: false, kind: 'invalid', message: 'Check your registration details.', errors: ['contact_phone is required.'] });
    expect(await registerForEvent(591, { contactPhone: '', needs: '' }, 't'))
      .toEqual({ ok: false, kind: 'invalid', message: 'Check your registration details.', errors: [] });
  });

  test('[FAILURE] [SG2-60:AC1] refusals, failures and malformed answers are reported by kind', async () => {
    serve(() => new Response(null, { status: 401 }), () => new Response(null, { status: 403 }), () => new Response(null, { status: 404 }),
      () => new Response(null, { status: 503 }), () => new Response('not json', { status: 201 }),
      () => Response.json({ registration: { ...held, registration_id: '7' } }, { status: 201 }),
      () => Response.json({ registration: { ...held, registered_at: null } }, { status: 201 }),
      () => Response.json({ error: 'Something', reason: 'surprise' }, { status: 409 }),
      () => Response.json({ reason: 'full' }, { status: 409 }), () => Response.json({}, { status: 400 }));
    const details = { contactPhone: '91234567', needs: '' };
    for (const kind of ['unauthorized', 'unauthorized', 'not_found', 'unavailable', 'unavailable', 'unavailable', 'unavailable',
      'unavailable', 'unavailable', 'unavailable']) {
      expect(await registerForEvent(591, details, 't')).toEqual({ ok: false, kind });
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await registerForEvent(591, details, 't')).toEqual({ ok: false, kind: 'unavailable' });
  });
});
