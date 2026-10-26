import { afterEach, expect, test, vi } from 'vitest';
import { fetchMyRegistrations, withdrawRegistration } from './myRegistrations';

const row = {
  registration_id: 7, event_id: 591, standing: 'registered', can_withdraw: true, registered_at: '2026-10-23T01:00:00.000Z',
  withdrawn_at: null, contact_phone: '91234567', needs: null,
  event: {
    name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar', description: null,
    proposed_date: '2030-07-20T11:00:00.000Z', registration_closes_at: '2030-07-19T02:00:00.000Z',
    venues: [{ name: 'Regression Hall', location: 'Level 1' }],
  },
};

function respond(response: Response | Error) {
  const fetch = vi.fn(async () => { if (response instanceof Error) throw response; return response; });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

test('[NORMAL] [SG2-62:AC1] the list is read with the attendee token and mapped to the screen\'s shape', async () => {
  const fetch = respond(Response.json({ registrations: [row] }));
  expect(await fetchMyRegistrations('attendee-token')).toEqual({ ok: true, registrations: [{
    registrationId: 7, eventId: 591, standing: 'registered', canWithdraw: true, registeredAt: '2026-10-23T01:00:00.000Z',
    withdrawnAt: null, contactPhone: '91234567', needs: null,
    event: { name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar', description: null,
      proposedDate: '2030-07-20T11:00:00.000Z', registrationClosesAt: '2030-07-19T02:00:00.000Z',
      venues: [{ name: 'Regression Hall', location: 'Level 1' }] },
  }] });
  expect(fetch).toHaveBeenCalledWith('/api/my-registrations', { method: 'GET', headers: { Authorization: 'Bearer attendee-token' } });
});

test('[BOUNDARY] [SG2-62:AC1] rows the screen cannot show are skipped and missing details are null', async () => {
  respond(Response.json({ registrations: [
    { registration_id: 8, event_id: 592, standing: 'withdrawn', can_withdraw: 'yes', event: { venues: [{ location: 'Annex' }, 3] } },
    { ...row, standing: 'lost' }, { ...row, registration_id: '7' }, { ...row, event: null }, 'row',
    { ...row, registration_id: 9, event: { ...row.event, venues: 'Regression Hall' } },
  ] }));
  const result = await fetchMyRegistrations('t');
  expect(result.ok && result.registrations[1]).toMatchObject({ registrationId: 9, event: { venues: [] } });
  expect(result.ok && result.registrations.slice(0, 1)).toEqual([{
    registrationId: 8, eventId: 592, standing: 'withdrawn', canWithdraw: false, registeredAt: null, withdrawnAt: null,
    contactPhone: null, needs: null,
    event: { name: '', organisation: null, category: null, description: null, proposedDate: null, registrationClosesAt: null,
      venues: [{ name: 'Unnamed venue', location: 'Annex' }] },
  }]);
});

test('[FAILURE] [SG2-62:AC1] refusals, outages and malformed answers are told apart', async () => {
  respond(new Response(null, { status: 401 }));
  expect(await fetchMyRegistrations('t')).toEqual({ ok: false, kind: 'unauthorized' });
  respond(new Response(null, { status: 403 }));
  expect(await fetchMyRegistrations('t')).toEqual({ ok: false, kind: 'unauthorized' });
  respond(Response.json({ error: 'down' }, { status: 503 }));
  expect(await fetchMyRegistrations('t')).toEqual({ ok: false, kind: 'unavailable' });
  respond(Response.json({ registrations: 'none' }));
  expect(await fetchMyRegistrations('t')).toEqual({ ok: false, kind: 'unavailable' });
  respond(new Response('not json'));
  expect(await fetchMyRegistrations('t')).toEqual({ ok: false, kind: 'unavailable' });
  respond(new Error('offline'));
  expect(await fetchMyRegistrations('t')).toEqual({ ok: false, kind: 'unavailable' });
});

test('[NORMAL] [SG2-62:AC2] a withdrawal posts to the registration and returns when it was withdrawn', async () => {
  const fetch = respond(Response.json({ withdrawal: { registration_id: 7, event_id: 591, withdrawn_at: '2026-10-25T02:00:00.000Z' } }));
  expect(await withdrawRegistration(7, 'attendee-token')).toEqual({ ok: true, withdrawnAt: '2026-10-25T02:00:00.000Z' });
  expect(fetch).toHaveBeenCalledWith('/api/my-registrations/7/withdrawal', { method: 'POST', headers: { Authorization: 'Bearer attendee-token' } });
});

test('[FAILURE] [SG2-62:AC4] each refusal keeps the server\'s message, and anything else is unavailable', async () => {
  for (const reason of ['started', 'withdrawn', 'cancelled'] as const) {
    respond(Response.json({ error: `Refused: ${reason}`, reason }, { status: 409 }));
    expect(await withdrawRegistration(7, 't')).toEqual({ ok: false, kind: reason, message: `Refused: ${reason}` });
  }
  respond(new Response(null, { status: 404 }));
  expect(await withdrawRegistration(7, 't')).toEqual({ ok: false, kind: 'not_found' });
  respond(new Response(null, { status: 403 }));
  expect(await withdrawRegistration(7, 't')).toEqual({ ok: false, kind: 'unauthorized' });
  for (const response of [
    Response.json({ error: 'Refused', reason: 'full' }, { status: 409 }),
    Response.json({ reason: 'started' }, { status: 409 }),
    Response.json({ withdrawal: { registration_id: 7 } }),
    Response.json({ error: 'down' }, { status: 503 }),
    new Response('not json', { status: 409 }),
    // A refusal reason counts only on a 409.
    Response.json({ error: 'Refused', reason: 'started' }, { status: 400 }),
  ]) {
    respond(response);
    expect(await withdrawRegistration(7, 't')).toEqual({ ok: false, kind: 'unavailable' });
  }
  respond(new Error('offline'));
  expect(await withdrawRegistration(7, 't')).toEqual({ ok: false, kind: 'unavailable' });
});
