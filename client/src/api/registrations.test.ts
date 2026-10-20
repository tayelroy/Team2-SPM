import { afterEach, describe, expect, test, vi } from 'vitest';
import { closeRegistrationNow, fetchRegistrations, readRegistrationView, saveRegistrationSettings, type RegistrationView } from './registrations';

const VIEW: RegistrationView = {
  event_id: 12, status: 'confirmed', registration_needed: true, registration_capacity: 3,
  registration_opens_at: '2030-06-01T01:00:00.000Z', registration_closes_at: '2030-06-10T01:00:00.000Z', window: 'open',
  registered_count: 1, places_remaining: 2, contact_details_visible: true,
  attendees: [{ registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', registered_at: '2030-06-02T01:00:00.000Z',
    email: 'ana@attendee.test', phone: null }],
  venues: [{ venue_id: 7, name: 'Main hall', capacity: 2 }],
  capacity_warnings: ['A capacity of 3 is more than Main hall holds (2).'],
  can_edit: true,
};

afterEach(() => vi.unstubAllGlobals());

const stub = (reply: () => Promise<Response> | Response) => {
  const fetch = vi.fn(async () => reply());
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

describe('readRegistrationView (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC1] [SG2-63:AC2] a complete picture is read as sent, with or without contact details', () => {
    expect(readRegistrationView(VIEW)).toEqual(VIEW);
    const colleague = { ...VIEW, contact_details_visible: false, attendees: [{ registration_id: 3, name: 'Ana Attendee',
      organisation: null, registered_at: '2030-06-02T01:00:00.000Z' }], registration_capacity: null, places_remaining: null,
    registration_opens_at: null, registration_closes_at: null };
    expect(readRegistrationView(colleague)).toEqual(colleague);
  });

  test('[FAILURE] [SG2-63:AC1] anything that is not a registration picture is refused rather than shown half-read', () => {
    for (const bad of [null, 'text', { ...VIEW, window: 'paused' }, { ...VIEW, attendees: [{ ...VIEW.attendees[0], name: 4 }] },
      { ...VIEW, attendees: [null] }, { ...VIEW, attendees: [{ ...VIEW.attendees[0], email: 5 }] },
      { ...VIEW, attendees: [{ ...VIEW.attendees[0], phone: 5 }] }, { ...VIEW, capacity_warnings: [1] }, { ...VIEW, venues: {} },
      { ...VIEW, registration_capacity: '3' }, { ...VIEW, can_edit: 'yes' }, { ...VIEW, registered_count: null },
      { ...VIEW, status: undefined }]) {
      expect(readRegistrationView(bad)).toBeNull();
    }
  });
});

describe('registration requests (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC1] the picture is read with the caller\'s token', async () => {
    const fetch = stub(() => Response.json(VIEW));
    const signal = new AbortController().signal;
    expect(await fetchRegistrations(12, 'token', signal)).toEqual({ ok: true, view: VIEW });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/registrations', { headers: { Authorization: 'Bearer token' }, signal });
  });

  test('[NORMAL] [SG2-63:AC5] only the settings being changed are sent', async () => {
    const fetch = stub(() => Response.json(VIEW));
    expect(await saveRegistrationSettings(12, 'token', { registration_capacity: 3 })).toEqual({ ok: true, view: VIEW });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/registration-settings', {
      method: 'PATCH', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: '{"registration_capacity":3}',
    });
  });

  test('[NORMAL] [SG2-63:AC6] closing now posts nothing but the event', async () => {
    const fetch = stub(() => Response.json({ ...VIEW, window: 'closed' }));
    expect(await closeRegistrationNow(12, 'token')).toEqual({ ok: true, view: { ...VIEW, window: 'closed' } });
    expect(fetch).toHaveBeenCalledWith('/api/event-requests/12/registration-settings/close',
      { method: 'POST', headers: { Authorization: 'Bearer token' } });
  });

  test('[CONFLICT] [SG2-63:AC5] [SG2-63:AC8] a refusal keeps the server\'s words and every detail it gives', async () => {
    stub(() => Response.json({ error: 'Invalid registration settings', details: ['Registration must close after it opens.', 7] }, { status: 400 }));
    expect(await saveRegistrationSettings(12, 'token', { registration_closes_at: null })).toEqual({
      ok: false, status: 400, message: 'Invalid registration settings', details: ['Registration must close after it opens.'],
    });
    stub(() => Response.json({ error: 'Only the organiser who created this event can close its registration.' }, { status: 403 }));
    expect(await closeRegistrationNow(12, 'token')).toEqual({
      ok: false, status: 403, message: 'Only the organiser who created this event can close its registration.', details: [],
    });
  });

  test('[FAILURE] [SG2-63:AC1] an unreachable server, a reply without words or a malformed picture falls back to plain wording', async () => {
    stub(() => Promise.reject(new TypeError('offline')));
    expect(await fetchRegistrations(12, 'token')).toEqual({ ok: false, status: 0, message: 'Registrations could not be loaded. Please try again.', details: [] });
    stub(() => new Response('oops', { status: 503 }));
    expect(await fetchRegistrations(12, 'token')).toEqual({ ok: false, status: 503, message: 'Registrations could not be loaded. Please try again.', details: [] });
    stub(() => Response.json({ ...VIEW, window: 'paused' }));
    expect(await saveRegistrationSettings(12, 'token', { registration_capacity: 4 })).toEqual({
      ok: false, status: 200, message: 'Registration settings could not be saved. Please try again.', details: [],
    });
  });
});
