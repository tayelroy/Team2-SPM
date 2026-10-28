import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError, createAuthorization, type Role } from './auth';
import { createRegistrableEventsRouter } from './registrableEvents';
import {
  createRegistrableEventsStore,
  type JoinWaitingListResult,
  type LeaveWaitingListResult,
  type RegistrableEventsStore
} from './db/registrableEvents';
import { dbConfig } from './db/config';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const auth = { Authorization: 'Bearer attendee-token' };
const path = '/api/registrable-events/41/waiting-list';
const second = { status: 'waiting' as const, position: 2, joined_at: '2030-06-02T01:00:00+00:00' };

function fixture(role: Role = 'attendee', join: JoinWaitingListResult | Error = { outcome: 'ok', waiting: second },
  leave: LeaveWaitingListResult | Error = { outcome: 'ok' }) {
  const asked: [string, number][] = [];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'attendee-1', role }) });
  const store = (token: string): RegistrableEventsStore => {
    assert.equal(token, 'attendee-token');
    return {
      list: async () => assert.fail('The waiting list never lists events'),
      get: async () => assert.fail('The waiting list never reads the detail'),
      register: async () => assert.fail('Joining the waiting list never registers'),
      joinWaitingList: async (eventId) => {
        asked.push(['join', eventId]);
        if (join instanceof Error) throw join;
        return join;
      },
      leaveWaitingList: async (eventId) => {
        asked.push(['leave', eventId]);
        if (leave instanceof Error) throw leave;
        return leave;
      }
    };
  };
  return { app: express().use('/api/registrable-events', createRegistrableEventsRouter(access, store)), asked };
}

test('[NORMAL] [SG2-61:AC5] an attendee refused by a full event joins its waiting list and is told their position', async () => {
  const { app, asked } = fixture();
  const response = await request(app).post(path).set(auth);
  assert.deepEqual([response.status, response.body], [201, { waiting: second }]);
  assert.deepEqual(asked, [['join', 41]]);
});

test('[CONFLICT] [SG2-61:AC6] an attendee already on the list, or already registered, cannot join it again', async () => {
  const already = await request(fixture('attendee', { outcome: 'already', waiting: second }).app).post(path).set(auth);
  assert.deepEqual([already.status, already.body], [409,
    { error: 'You are already on the waiting list for this event.', reason: 'already', waiting: second }]);
  const registered = await request(fixture('attendee', { outcome: 'registered' }).app).post(path).set(auth);
  assert.deepEqual([registered.status, registered.body], [409,
    { error: 'You are already registered for this event.', reason: 'registered' }]);
});

test('[BOUNDARY] [SG2-61:AC5] the list is only for a full event that is open: places left, not open, closed or missing are refused', async () => {
  const cases: [JoinWaitingListResult, number, unknown][] = [
    [{ outcome: 'not_full' }, 409, { error: 'Places are still available. Register instead.', reason: 'not_full' }],
    [{ outcome: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00' }, 409,
      { error: 'Registration opens 01 Jun 2030 08:00 SGT.', reason: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00' }],
    [{ outcome: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00' }, 409,
      { error: 'Registration for this event has closed.', reason: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00' }],
    [{ outcome: 'missing' }, 404, { error: 'This event is not open for registration.' }]
  ];
  for (const [result, status, body] of cases) {
    const response = await request(fixture('attendee', result).app).post(path).set(auth);
    assert.deepEqual([response.status, response.body], [status, body], result.outcome);
  }
});

test('[NORMAL] [SG2-61:AC6] an attendee leaves the waiting list at any time', async () => {
  const { app, asked } = fixture();
  const response = await request(app).delete(path).set(auth);
  assert.deepEqual([response.status, response.body], [200, { left: true }]);
  assert.deepEqual(asked, [['leave', 41]]);
});

test('[FAILURE] [SG2-61:AC6] leaving a list the attendee is not on is 404', async () => {
  const response = await request(fixture('attendee', { outcome: 'ok', waiting: second }, { outcome: 'missing' }).app).delete(path).set(auth);
  assert.deepEqual([response.status, response.body], [404, { error: 'You are not on the waiting list for this event.' }]);
});

test('[FAILURE] [SG2-61:AC5] [SG2-61:AC6] only attendees reach the list, bad ids are refused, and a failure discloses nothing', async () => {
  for (const role of ['event_organiser', 'event_coordinator', 'venue_staff'] as const) {
    const { app, asked } = fixture(role);
    assert.equal((await request(app).post(path).set(auth)).status, 403, role);
    assert.equal((await request(app).delete(path).set(auth)).status, 403, role);
    assert.deepEqual(asked, []);
  }
  const { app, asked } = fixture();
  for (const bad of ['0', '-1', 'abc', '2147483648']) {
    assert.equal((await request(app).post(`/api/registrable-events/${bad}/waiting-list`).set(auth)).status, 400, bad);
    assert.equal((await request(app).delete(`/api/registrable-events/${bad}/waiting-list`).set(auth)).status, 400, bad);
  }
  assert.deepEqual(asked, []);
  const refused = fixture('attendee', new AccessError(403), new AccessError(403));
  assert.equal((await request(refused.app).post(path).set(auth)).status, 403);
  assert.equal((await request(refused.app).delete(path).set(auth)).status, 403);
  const broken = fixture('attendee', new Error('secret'), new Error('secret'));
  for (const response of [await request(broken.app).post(path).set(auth), await request(broken.app).delete(path).set(auth)]) {
    assert.deepEqual([response.status, response.body], [503, { error: 'Events are temporarily unavailable. Please try again.' }]);
  }
});

function client(result: { data?: unknown; error?: unknown; status?: number }, calls: unknown[] = []) {
  return { rpc: async (...args: unknown[]) => { calls.push(args); return { data: null, error: null, status: 200, ...result }; } } as unknown as SupabaseClient;
}

test('[NORMAL] [SG2-61:AC5] [SG2-62:AC6] joining goes through join_waiting_list with the caller token, and an offer reads with its time', async () => {
  const calls: unknown[] = [];
  const store = createRegistrableEventsStore('attendee-token', () => client({ data: { outcome: 'ok', waiting: second } }, calls));
  assert.deepEqual(await store.joinWaitingList(41), { outcome: 'ok', waiting: second });
  assert.deepEqual(calls, [['join_waiting_list', { p_event_id: 41 }]]);
  const offered = { status: 'offered', offer_expires_at: '2030-06-03T01:00:00+00:00', joined_at: '2030-06-02T01:00:00+00:00' };
  assert.deepEqual(await createRegistrableEventsStore('t', () => client({ data: { outcome: 'already', waiting: offered } })).joinWaitingList(41),
    { outcome: 'already', waiting: offered });
});

test('[BOUNDARY] [SG2-61:AC5] [SG2-61:AC6] each join refusal is read with what it carries', async () => {
  const cases: [unknown, JoinWaitingListResult][] = [
    [{ outcome: 'registered' }, { outcome: 'registered' }],
    [{ outcome: 'not_full' }, { outcome: 'not_full' }],
    [{ outcome: 'missing' }, { outcome: 'missing' }],
    [{ outcome: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00' },
      { outcome: 'not_open', registration_opens_at: '2030-06-01T00:00:00+00:00' }],
    [{ outcome: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00' },
      { outcome: 'closed', registration_closes_at: '2030-07-19T02:00:00+00:00' }]
  ];
  for (const [data, expected] of cases) {
    assert.deepEqual(await createRegistrableEventsStore('t', () => client({ data })).joinWaitingList(41), expected);
  }
});

test('[FAILURE] [SG2-61:AC5] a refused, failed or malformed join or leave is translated without disclosing database text', async () => {
  for (const data of [null, 'ok', { outcome: 'ok' }, { outcome: 'ok', waiting: { status: 'waiting', joined_at: 'x' } },
    { outcome: 'already', waiting: { status: 'offered', joined_at: 'x' } }, { outcome: 'ok', waiting: { status: 'gone', joined_at: 'x' } },
    { outcome: 'ok', waiting: { status: 'waiting', position: 1 } }, { outcome: 'ok', waiting: 'x' },
    { outcome: 'not_open' }, { outcome: 'closed' }, { outcome: 'surprise' }]) {
    await assert.rejects(createRegistrableEventsStore('t', () => client({ data })).joinWaitingList(41),
      failure => failure instanceof AccessError && failure.status === 503, JSON.stringify(data));
  }
  await assert.rejects(createRegistrableEventsStore('t', () => client({ status: 400, error: { code: '42501' } })).joinWaitingList(41),
    failure => failure instanceof AccessError && failure.status === 403);
  await assert.rejects(createRegistrableEventsStore('t', () => client({ status: 500, error: { message: 'secret' } })).leaveWaitingList(41),
    failure => failure instanceof AccessError && failure.status === 503 && !failure.message.includes('secret'));
  for (const data of [null, { outcome: 'left' }]) {
    await assert.rejects(createRegistrableEventsStore('t', () => client({ data })).leaveWaitingList(41),
      failure => failure instanceof AccessError && failure.status === 503);
  }
});

test('[NORMAL] [SG2-61:AC6] leaving goes through leave_waiting_list with the caller token', async () => {
  const calls: unknown[] = [];
  assert.deepEqual(await createRegistrableEventsStore('t', () => client({ data: { outcome: 'ok', left_at: 'x' } }, calls)).leaveWaitingList(41),
    { outcome: 'ok' });
  assert.deepEqual(calls, [['leave_waiting_list', { p_event_id: 41 }]]);
  assert.deepEqual(await createRegistrableEventsStore('t', () => client({ data: { outcome: 'missing' } })).leaveWaitingList(41),
    { outcome: 'missing' });
});

test('[NORMAL] [SG2-61:AC1] [SG2-61:AC5] the attendee read says whether the event is full and where the caller stands', async () => {
  const base = { event_id: 41, name: 'Harbour Lecture', venues: [] };
  const [full, waiting, offered, unclear] = await createRegistrableEventsStore('t', () => client({ data: [
    { ...base, full: true, waiting: null },
    { ...base, full: true, waiting: second },
    { ...base, full: false, waiting: { status: 'offered', offer_expires_at: '2030-06-03T01:00:00+00:00', joined_at: 'j' } },
    { ...base, full: 'yes', waiting: { status: 'waiting', position: '1', joined_at: 'j' } }
  ] })).list();
  assert.deepEqual([full.full, full.waiting], [true, null]);
  assert.deepEqual(waiting.waiting, second);
  assert.deepEqual(offered.waiting, { status: 'offered', offer_expires_at: '2030-06-03T01:00:00+00:00', joined_at: 'j' });
  assert.deepEqual([unclear.full, unclear.waiting], [false, null]);
});
