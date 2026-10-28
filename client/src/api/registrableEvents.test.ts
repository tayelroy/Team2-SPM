import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchRegistrableEvent, fetchRegistrableEvents, joinWaitingList, leaveWaitingList, registerForEvent } from './registrableEvents';

const raw = {
  event_id: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture.', proposed_date: '2030-07-20T11:00:00.000Z',
  registration_opens_at: '2026-10-01T00:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: true, full: false, waiting: null,
};
const parsed = {
  eventId: 591, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'An evening lecture.', proposedDate: '2030-07-20T11:00:00.000Z',
  registrationOpensAt: '2026-10-01T00:00:00.000Z', registrationClosesAt: '2030-07-19T02:00:00.000Z',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: true, full: false, waiting: null,
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
        registrationOpensAt: null, registrationClosesAt: null, venues: [{ name: 'Unnamed venue', location: null }], registered: false,
        full: false, waiting: null },
      { eventId: 2, name: '', organisation: null, category: null, description: null, proposedDate: null,
        registrationOpensAt: null, registrationClosesAt: null, venues: [], registered: false,
        full: false, waiting: null },
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

describe('waiting list (SG2-61)', () => {
  const second = { status: 'waiting', position: 2, joined_at: 'j' };
  const offered = { status: 'offered', offer_expires_at: 'x', joined_at: 'j' };

  test('[NORMAL] [SG2-61:AC1] [SG2-61:AC5] an event reads as full, with where the attendee stands on its list', async () => {
    serve(() => Response.json({ events: [{ ...raw, full: true, waiting: second }, { ...raw, waiting: offered },
      { ...raw, waiting: { status: 'waiting', joined_at: 'j' } }, { ...raw, waiting: { status: 'offered', joined_at: 'j' } },
      { ...raw, waiting: { status: 'waiting', position: 1 } }] }));
    const result = await fetchRegistrableEvents('t');
    expect(result.ok && result.events.map((event) => [event.full, event.waiting])).toEqual([
      [true, { status: 'waiting', position: 2, joinedAt: 'j' }], [false, { status: 'offered', offerExpiresAt: 'x', joinedAt: 'j' }],
      [false, null], [false, null], [false, null]]);
  });

  test('[NORMAL] [SG2-61:AC5] joining posts with the bearer token and reads the position', async () => {
    const fetch = serve(() => Response.json({ waiting: second }, { status: 201 }));
    expect(await joinWaitingList(591, 'attendee-token')).toEqual({ ok: true, waiting: { status: 'waiting', position: 2, joinedAt: 'j' } });
    expect(fetch).toHaveBeenCalledWith('/api/registrable-events/591/waiting-list', { method: 'POST', headers: { Authorization: 'Bearer attendee-token' } });
  });

  test('[CONFLICT] [SG2-61:AC6] each refusal is read by kind with its message, and already carries where they stand', async () => {
    serve(() => Response.json({ error: 'On it.', reason: 'already', waiting: offered }, { status: 409 }),
      () => Response.json({ error: 'On it.', reason: 'already' }, { status: 409 }),
      () => Response.json({ error: 'Registered.', reason: 'registered' }, { status: 409 }),
      () => Response.json({ error: 'Free.', reason: 'not_full' }, { status: 409 }),
      () => Response.json({ error: 'Soon.', reason: 'not_open' }, { status: 409 }),
      () => Response.json({ error: 'Shut.', reason: 'closed' }, { status: 409 }));
    expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind: 'already', message: 'On it.',
      waiting: { status: 'offered', offerExpiresAt: 'x', joinedAt: 'j' } });
    expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind: 'already', message: 'On it.', waiting: null });
    expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind: 'registered', message: 'Registered.' });
    expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind: 'not_full', message: 'Free.' });
    expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind: 'not_open', message: 'Soon.' });
    expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind: 'closed', message: 'Shut.' });
  });

  test('[FAILURE] [SG2-61:AC5] refusals, failures and malformed answers to a join are reported by kind', async () => {
    serve(() => new Response(null, { status: 401 }), () => new Response(null, { status: 403 }), () => new Response(null, { status: 404 }),
      () => Response.json({ waiting: null }, { status: 201 }), () => Response.json({ reason: 'closed' }, { status: 409 }),
      () => Response.json({ error: 'x', reason: 'odd' }, { status: 409 }), () => new Response('not json', { status: 500 }));
    for (const kind of ['unauthorized', 'unauthorized', 'not_found', 'unavailable', 'unavailable', 'unavailable', 'unavailable']) {
      expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind });
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await joinWaitingList(591, 't')).toEqual({ ok: false, kind: 'unavailable' });
  });

  test('[NORMAL] [SG2-61:AC6] leaving deletes with the bearer token; each failure is reported by kind', async () => {
    const fetch = serve(() => Response.json({ left: true }), () => new Response(null, { status: 401 }), () => new Response(null, { status: 403 }),
      () => new Response(null, { status: 404 }), () => new Response(null, { status: 500 }));
    expect(await leaveWaitingList(591, 'attendee-token')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('/api/registrable-events/591/waiting-list', { method: 'DELETE', headers: { Authorization: 'Bearer attendee-token' } });
    for (const kind of ['unauthorized', 'unauthorized', 'not_found', 'unavailable']) {
      expect(await leaveWaitingList(591, 't')).toEqual({ ok: false, kind });
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await leaveWaitingList(591, 't')).toEqual({ ok: false, kind: 'unavailable' });
  });
});

