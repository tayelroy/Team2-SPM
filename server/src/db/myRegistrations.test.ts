import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createMyRegistrationsStore } from './myRegistrations';
import { dbConfig } from './config';
import { AccessError } from '../auth';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const row = {
  registration_id: 7, event_id: 41, standing: 'registered', can_withdraw: true,
  registered_at: '2030-06-02T01:00:00+00:00', withdrawn_at: null, contact_phone: '91234567', needs: 'Wheelchair access',
  event: {
    name: 'Harbour Lecture', organisation: 'Harbour Foundation', category: 'seminar', description: 'Talks and a panel.',
    proposed_date: '2030-07-20T11:00:00+00:00', registration_closes_at: '2030-07-19T02:00:00+00:00',
    venues: [{ name: 'Regression Hall', location: 'Level 1' }]
  }
};

function client(result: { data?: unknown; error?: unknown; status?: number }, calls: unknown[] = []) {
  return { rpc: async (...args: unknown[]) => { calls.push(args); return { data: null, error: null, status: 200, ...result }; } } as unknown as SupabaseClient;
}

test('[NORMAL] [SG2-62:AC1] the list goes through my_registrations with the caller token', async () => {
  const calls: unknown[] = []; let token = '';
  const store = createMyRegistrationsStore('attendee-token', value => { token = value; return client({ data: [row] }, calls); });
  assert.deepEqual(await store.list(), [row]);
  assert.equal(token, 'attendee-token');
  assert.deepEqual(calls, [['my_registrations']]);
});

test('[BOUNDARY] [SG2-62:AC1] details the database left out are null or empty, extra fields are dropped and malformed rows are skipped', async () => {
  const [sparse, ...rest] = await createMyRegistrationsStore('t', () => client({ data: [
    { registration_id: 8, event_id: 42, standing: 'withdrawn', can_withdraw: 'yes', secret: 'x',
      event: { name: null, venues: [{ name: null, location: 'Annex' }, 'bad'], status: 'planning' } },
    { registration_id: 9, event_id: 43, standing: 'lost', event: {} },
    { registration_id: '10', event_id: 44, standing: 'registered', event: {} },
    { registration_id: 11, event_id: 45, standing: 'registered' },
    'not a row'
  ] })).list();
  assert.deepEqual(sparse, {
    registration_id: 8, event_id: 42, standing: 'withdrawn', can_withdraw: false, registered_at: null, withdrawn_at: null,
    contact_phone: null, needs: null,
    event: { name: '', organisation: null, category: null, description: null, proposed_date: null, registration_closes_at: null,
      venues: [{ name: 'Unnamed venue', location: 'Annex' }] }
  });
  assert.deepEqual(rest, []);
});

test('[NORMAL] [SG2-62:AC2] a withdrawal goes through withdraw_registration and returns what was withdrawn', async () => {
  const calls: unknown[] = [];
  const result = await createMyRegistrationsStore('t', () => client({ data: {
    outcome: 'ok', registration: { registration_id: 7, event_id: 41, withdrawn_at: '2030-06-03T01:00:00+00:00', extra: 1 }
  } }, calls)).withdraw(7);
  assert.deepEqual(result, { outcome: 'ok', withdrawal: { registration_id: 7, event_id: 41, withdrawn_at: '2030-06-03T01:00:00+00:00' } });
  assert.deepEqual(calls, [['withdraw_registration', { p_registration_id: 7 }]]);
});

test('[FAILURE] [SG2-62:AC4] each refusal the database gives is passed on', async () => {
  const outcome = (data: unknown) => createMyRegistrationsStore('t', () => client({ data })).withdraw(7);
  assert.deepEqual(await outcome({ outcome: 'started', proposed_date: '2030-07-20T11:00:00+00:00' }),
    { outcome: 'started', proposed_date: '2030-07-20T11:00:00+00:00' });
  assert.deepEqual(await outcome({ outcome: 'started' }), { outcome: 'started', proposed_date: null });
  for (const name of ['missing', 'withdrawn', 'cancelled']) {
    assert.deepEqual(await outcome({ outcome: name }), { outcome: name });
  }
});

test('[FAILURE] [SG2-62:AC2] an answer the store does not recognise is a 503, never a guess', async () => {
  for (const data of [null, [], 'ok', { outcome: 'ok' }, { outcome: 'ok', registration: { registration_id: 7, event_id: 41 } },
    { outcome: 'deleted' }]) {
    await assert.rejects(createMyRegistrationsStore('t', () => client({ data })).withdraw(7),
      (error: unknown) => error instanceof AccessError && error.status === 503, JSON.stringify(data));
  }
  await assert.rejects(createMyRegistrationsStore('t', () => client({ data: { registrations: [] } })).list(),
    (error: unknown) => error instanceof AccessError && error.status === 503);
});

test('[FAILURE] [SG2-62:AC1] [SG2-62:AC2] database refusals map to 401, 403 or 503, and a missing client is 503', async () => {
  const refused = async (error: unknown, status: number) => {
    const store = createMyRegistrationsStore('t', () => client({ error, status }));
    for (const call of [() => store.list(), () => store.withdraw(7)]) {
      try { await call(); assert.fail('expected a refusal'); } catch (failure) { return (failure as AccessError).status; }
    }
  };
  assert.equal(await refused({ code: '42501' }, 400), 403);
  assert.equal(await refused({}, 403), 403);
  assert.equal(await refused({}, 401), 401);
  assert.equal(await refused({ code: 'XX000' }, 500), 503);
  const withdrawRefused = createMyRegistrationsStore('t', () => client({ error: { code: '42501' }, status: 400 }));
  await assert.rejects(withdrawRefused.withdraw(7), (error: unknown) => error instanceof AccessError && error.status === 403);
  assert.throws(() => createMyRegistrationsStore('t', () => null), (error: unknown) => error instanceof AccessError && error.status === 503);
});
