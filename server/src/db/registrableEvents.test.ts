import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRegistrableEventsStore } from './registrableEvents';
import { dbConfig } from './config';
import { AccessError } from '../auth';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const event = {
  event_id: 41, name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar',
  description: 'Talks and a panel.', proposed_date: '2030-07-20T02:00:00+00:00',
  registration_opens_at: '2026-10-01T00:00:00+00:00', registration_closes_at: '2030-07-19T02:00:00+00:00',
  venues: [{ name: 'Regression Hall', location: 'Level 1' }], registered: false
};

function client(result: { data?: unknown; error?: unknown; status?: number }, calls: unknown[] = []) {
  return { rpc: async (...args: unknown[]) => { calls.push(args); return { data: null, error: null, status: 200, ...result }; } } as unknown as SupabaseClient;
}

test('[NORMAL] [SG2-59:AC1] the list goes through registrable_events with the caller token', async () => {
  const calls: unknown[] = []; let token = '';
  const store = createRegistrableEventsStore('attendee-token', value => { token = value; return client({ data: [event] }, calls); });
  assert.deepEqual(await store.list(), [event]);
  assert.equal(token, 'attendee-token');
  assert.deepEqual(calls, [['registrable_events']]);
});

test('[NORMAL] [SG2-59:AC3] one event is read through registrable_event, and an unlisted one is null', async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await createRegistrableEventsStore('t', () => client({ data: event }, calls)).get(41), event);
  assert.deepEqual(calls, [['registrable_event', { p_event_id: 41 }]]);
  assert.equal(await createRegistrableEventsStore('t', () => client({ data: null })).get(42), null);
});

test('[BOUNDARY] [SG2-59:AC3] details the database left out are null or empty rather than invented, and extra fields are dropped', async () => {
  const [sparse] = await createRegistrableEventsStore('t', () => client({ data: [
    { event_id: 9, status: 'confirmed', planning_notes: 'secret', venues: [{ location: 5 }, 'x', null] }, 'not an event'
  ] })).list();
  assert.deepEqual(sparse, {
    event_id: 9, name: '', organisation: null, category: null, description: null, proposed_date: null,
    registration_opens_at: null, registration_closes_at: null, venues: [{ name: 'Unnamed venue', location: null }],
    registered: false
  });
  const none = await createRegistrableEventsStore('t', () => client({ data: { event_id: 10 } })).get(10);
  assert.deepEqual(none?.venues, []);
});

test('[FAILURE] [SG2-59:AC1] a refusal or failure is translated without disclosing database error text', async () => {
  for (const [status, error, data, expected] of [[401, { code: 'secret' }, null, 401], [403, {}, null, 403],
    [400, { code: '42501' }, null, 403], [500, { code: 'secret' }, null, 503],
    [200, null, { events: [] }, 503], [200, null, null, 503]] as const) {
    await assert.rejects(createRegistrableEventsStore('t', () => client({ status, error, data })).list(),
      failure => failure instanceof AccessError && failure.status === expected && !failure.message.includes('secret'));
  }
  for (const [status, error, data, expected] of [[403, { code: 'x' }, null, 403], [500, {}, null, 503],
    [200, null, [event], 503], [200, null, 'event', 503]] as const) {
    await assert.rejects(createRegistrableEventsStore('t', () => client({ status, error, data })).get(41),
      failure => failure instanceof AccessError && failure.status === expected);
  }
});

test('[FAILURE] [SG2-59:AC1] an unconfigured database is unavailable before anything is read', () => {
  assert.throws(() => createRegistrableEventsStore('t'), failure => failure instanceof AccessError && failure.status === 503);
  assert.throws(() => createRegistrableEventsStore('t', () => null), failure => failure instanceof AccessError && failure.status === 503);
});

test('[NORMAL] [SG2-60:AC2] an event the caller already registered for says so', async () => {
  const [registered] = await createRegistrableEventsStore('t', () => client({ data: [{ ...event, registered: true }] })).list();
  assert.equal(registered.registered, true);
  const unclear = await createRegistrableEventsStore('t', () => client({ data: { ...event, registered: 'yes' } })).get(41);
  assert.equal(unclear?.registered, false);
});

const registration = { registration_id: 7, event_id: 41, registered_at: '2030-06-02T01:00:00+00:00', contact_phone: '91234567', needs: 'Ramp' };

test('[NORMAL] [SG2-60:AC1] registering goes through register_for_event with the caller token and returns the place held', async () => {
  const calls: unknown[] = []; let token = '';
  const store = createRegistrableEventsStore('attendee-token', value => {
    token = value; return client({ data: { outcome: 'ok', registration: { ...registration, attendee_id: 'hidden' } } }, calls);
  });
  assert.deepEqual(await store.register(41, { contact_phone: '91234567', needs: 'Ramp' }), { outcome: 'ok', registration });
  assert.equal(token, 'attendee-token');
  assert.deepEqual(calls, [['register_for_event', { p_event_id: 41, p_contact_phone: '91234567', p_needs: 'Ramp' }]]);
  const plain = await createRegistrableEventsStore('t', () => client({ data: { outcome: 'ok', registration: { ...registration, needs: null } } }))
    .register(41, { contact_phone: '91234567', needs: null });
  assert.deepEqual(plain, { outcome: 'ok', registration: { ...registration, needs: null } });
});

test('[FAILURE] [SG2-60:AC3] every refusal the database gives is passed on with the time it needs', async () => {
  const register = (data: unknown) => createRegistrableEventsStore('t', () => client({ data })).register(41, { contact_phone: '91234567', needs: null });
  assert.deepEqual(await register({ outcome: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00' }),
    { outcome: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00' });
  assert.deepEqual(await register({ outcome: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00' }),
    { outcome: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00' });
  for (const outcome of ['duplicate', 'full', 'missing', 'invalid']) {
    assert.deepEqual(await register({ outcome }), { outcome });
  }
});

test('[FAILURE] [SG2-60:AC1] a refused or malformed registration answer is translated without database detail', async () => {
  const register = (result: { data?: unknown; error?: unknown; status?: number }) =>
    createRegistrableEventsStore('t', () => client(result)).register(41, { contact_phone: '91234567', needs: null });
  for (const [result, expected] of [
    [{ status: 400, error: { code: '42501', message: 'secret' } }, 403],
    [{ status: 401, error: { code: 'x' } }, 401],
    [{ status: 500, error: { code: 'secret' } }, 503],
    [{ data: null }, 503], [{ data: [] }, 503], [{ data: { outcome: 'surprise' } }, 503],
    [{ data: { outcome: 'ok' } }, 503],
    [{ data: { outcome: 'ok', registration: { ...registration, registration_id: '7' } } }, 503],
    [{ data: { outcome: 'ok', registration: { ...registration, event_id: null } } }, 503],
    [{ data: { outcome: 'ok', registration: { ...registration, registered_at: 1 } } }, 503],
    [{ data: { outcome: 'ok', registration: { ...registration, contact_phone: null } } }, 503],
    [{ data: { outcome: 'not_open' } }, 503], [{ data: { outcome: 'closed', registration_closes_at: 5 } }, 503]
  ] as const) {
    await assert.rejects(register(result), failure => failure instanceof AccessError && failure.status === expected
      && !failure.message.includes('secret'), JSON.stringify(result));
  }
});
