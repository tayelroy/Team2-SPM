import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createApp } from './app';
import { createAuthorization, type Principal } from './auth';
import { PERMISSIONS } from './auth/policy';
import { dbConfig } from './db/config';
import type {
  FetchRegistrationOverviewResult,
  RegistrationOverview,
  UpdateRegistrationSettingsInput,
  UpdateRegistrationSettingsResult
} from './db/registrations';
import type { OrganiserLookupResult } from './db/eventRequests';
import { createRegistrationHandlers, type RegistrationDependencies } from './events/registrationRoutes';

const OWNER = 'organiser-1';
const COLLEAGUE = 'organiser-2';
const OUTSIDER = 'organiser-3';
const COORDINATOR = 'coordinator-1';
const ADMIN = {} as SupabaseClient;
const UNAVAILABLE = { error: 'Registrations are temporarily unavailable. Please try again later.' };
const NOT_FOUND = { error: 'Event not found.' };
/** Between the event's registration opening (1 June) and closing (10 June). */
const NOW = Date.parse('2030-06-05T00:00:00.000Z');

const OVERVIEW: RegistrationOverview = {
  event: {
    event_id: 12, name: 'Partner Forum', status: 'confirmed', organisation: 'Acme', organiser_id: OWNER,
    coordinator_id: COORDINATOR, proposed_date: '2030-06-20T01:00:00.000Z', registration_needed: true,
    registration_capacity: 3, registration_opens_at: '2030-06-01T01:00:00.000Z', registration_closes_at: '2030-06-10T01:00:00.000Z',
    waiting_list_response_hours: 24
  },
  attendees: [
    { registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', email: 'ana@attendee.test', phone: '+65 6000 0001',
      needs: 'Step-free access', registered_at: '2030-06-02T01:00:00.000Z' },
    { registration_id: 4, name: 'Ben Attendee', organisation: null, email: 'ben@attendee.test', phone: null,
      needs: null, registered_at: '2030-06-03T01:00:00.000Z' }
  ],
  waiting_list: [],
  venues: [{ venue_id: 7, name: 'Main hall', capacity: 2 }]
};

/** What the creating organiser sees of OVERVIEW at NOW. */
const OWNER_VIEW = {
  event_id: 12, name: 'Partner Forum', status: 'confirmed', registration_needed: true, registration_capacity: 3,
  registration_opens_at: '2030-06-01T01:00:00.000Z', registration_closes_at: '2030-06-10T01:00:00.000Z',
  waiting_list_response_hours: 24, window: 'open',
  registered_count: 2, places_remaining: 1, contact_details_visible: true,
  attendees: [
    { registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', registered_at: '2030-06-02T01:00:00.000Z',
      email: 'ana@attendee.test', phone: '+65 6000 0001', needs: 'Step-free access' },
    { registration_id: 4, name: 'Ben Attendee', organisation: null, registered_at: '2030-06-03T01:00:00.000Z',
      email: 'ben@attendee.test', phone: null, needs: null }
  ],
  waiting_list: [],
  venues: [{ venue_id: 7, name: 'Main hall', capacity: 2 }],
  capacity_warnings: ['A capacity of 3 is more than Main hall holds (2).'],
  can_edit: true
};

const ORGANISATIONS: Record<string, string | null> = { [OWNER]: 'Acme', [COLLEAGUE]: 'Acme', [OUTSIDER]: 'Other', blank: '  ' };

const originalConfig = { ...dbConfig };

describe('registration routes behind the app (SG2-63)', () => {
  beforeEach(() => {
    dbConfig.supabaseUrl = undefined;
    dbConfig.supabaseAnonKey = undefined;
    dbConfig.supabaseServiceRoleKey = undefined;
  });
  afterEach(() => Object.assign(dbConfig, originalConfig));

  const appAs = (role: Principal['role']) => createApp(undefined,
    createAuthorization({ resolvePrincipal: async () => ({ userId: OWNER, role }), permissions: PERMISSIONS }));
  const routes: [Principal['role'][], 'get' | 'patch' | 'post', string][] = [
    [['event_organiser', 'event_coordinator'], 'get', '/api/event-requests/12/registrations'],
    [['event_organiser'], 'patch', '/api/event-requests/12/registration-settings'],
    [['event_organiser'], 'post', '/api/event-requests/12/registration-settings/close']
  ];
  const ROLES: Principal['role'][] = ['event_organiser', 'event_coordinator', 'venue_staff', 'technical_support_staff', 'attendee',
    'event_coordinator_lead', 'safety_officer'];

  test('[FAILURE] [SG2-63:AC3] a request without a session is refused with 401', async () => {
    for (const [, method, path] of routes) {
      assert.equal((await request(appAs('event_organiser'))[method](path)).status, 401, path);
    }
  });

  test('[FAILURE] [SG2-63:AC3] [SG2-63:AC8] every role outside each route\'s grant is refused with 403 before the handler runs', async () => {
    for (const [allowed, method, path] of routes) {
      for (const role of ROLES.filter(role => !allowed.includes(role))) {
        const res = await request(appAs(role))[method](path).set('Authorization', 'Bearer token').send({ registration_capacity: 5 });
        assert.deepEqual([res.status, res.body], [403, { error: 'Access denied' }], `${role} ${path}`);
      }
    }
  });

  test('[BOUNDARY] [SG2-63:AC1] [SG2-63:AC5] an allowed role reaches each handler, which reports the unconfigured database as 503', async () => {
    for (const [allowed, method, path] of routes) {
      const res = await request(appAs(allowed[0]))[method](path).set('Authorization', 'Bearer token').send({ registration_capacity: 5 });
      assert.deepEqual([res.status, res.body], [503, UNAVAILABLE], path);
    }
  });
});

interface Harness { app: express.Express; writes: UpdateRegistrationSettingsInput[] }

function harness(principal: Principal | null, overrides: Partial<RegistrationDependencies> & {
  overview?: RegistrationOverview; reread?: FetchRegistrationOverviewResult; result?: UpdateRegistrationSettingsResult
} = {}): Harness {
  const writes: UpdateRegistrationSettingsInput[] = [];
  const overview = overrides.overview ?? OVERVIEW;
  let reads = 0;
  const handlers = createRegistrationHandlers({
    getPrincipal: () => principal ?? undefined,
    getAdminClient: () => ADMIN,
    fetchOverview: async (_admin, eventId) => {
      reads++;
      if (reads > 1 && overrides.reread) return overrides.reread;
      return eventId === 12 ? { ok: true, overview } : { ok: false, reason: 'not_found' };
    },
    fetchOrganisation: async (_admin, userId): Promise<OrganiserLookupResult> => (userId in ORGANISATIONS
      ? { ok: true, organisation: ORGANISATIONS[userId] } : { ok: false, reason: 'not_found', message: 'No user record.' }),
    updateSettings: async (_admin, input) => {
      writes.push(input);
      return overrides.result ?? { outcome: 'ok' };
    },
    now: () => NOW,
    ...overrides
  });
  const app = express();
  app.use(express.json());
  app.get('/events/:eventId/registrations', handlers.overview);
  app.patch('/events/:eventId/registration-settings', handlers.update);
  app.post('/events/:eventId/registration-settings/close', handlers.close);
  return { app, writes };
}

const as = (userId: string, role: Principal['role'] = 'event_organiser'): Principal => ({ userId, role });

describe('GET /api/event-requests/:eventId/registrations (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC1] [SG2-63:AC2] [SG2-63:AC4] [SG2-63:AC7] [SG2-60:AC4] the creating organiser sees the numbers, the attendees with contact details and needs, the warning and can edit', async () => {
    const res = await request(harness(as(OWNER)).app).get('/events/12/registrations');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, OWNER_VIEW);
  });

  test('[NORMAL] [SG2-63:AC3] [SG2-63:AC4] [SG2-63:AC8] [SG2-60:AC4] an organisation colleague sees the picture without contact details or needs and cannot edit', async () => {
    const res = await request(harness(as(COLLEAGUE)).app).get('/events/12/registrations');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ...OWNER_VIEW, contact_details_visible: false, can_edit: false, attendees: [
      { registration_id: 3, name: 'Ana Attendee', organisation: 'Guests Ltd', registered_at: '2030-06-02T01:00:00.000Z' },
      { registration_id: 4, name: 'Ben Attendee', organisation: null, registered_at: '2030-06-03T01:00:00.000Z' }
    ] });
  });

  test('[NORMAL] [SG2-63:AC4] [SG2-63:AC8] the assigned coordinator sees contact details but cannot edit', async () => {
    const res = await request(harness(as(COORDINATOR, 'event_coordinator')).app).get('/events/12/registrations');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ...OWNER_VIEW, can_edit: false });
  });

  test('[FAILURE] [SG2-63:AC3] another organisation, an account without one, another coordinator or a missing event learn only that it was not found', async () => {
    for (const [principal, path] of [
      [as(OUTSIDER), '/events/12/registrations'], [as('blank'), '/events/12/registrations'],
      [as('no-profile'), '/events/12/registrations'], [as('coordinator-2', 'event_coordinator'), '/events/12/registrations'],
      [as(OWNER), '/events/99/registrations']
    ] as const) {
      const res = await request(harness(principal).app).get(path);
      assert.deepEqual([res.status, res.body], [404, NOT_FOUND], `${principal.userId} ${path}`);
    }
  });

  test('[BOUNDARY] [SG2-63:AC1] [SG2-63:AC5] no capacity, no registrations, no warning, and editing ends once the event starts', async () => {
    const empty = { ...OVERVIEW, attendees: [], event: { ...OVERVIEW.event, registration_capacity: null } };
    const res = await request(harness(as(OWNER), { overview: empty }).app).get('/events/12/registrations');
    assert.deepEqual([res.body.registered_count, res.body.places_remaining, res.body.capacity_warnings, res.body.attendees, res.body.can_edit],
      [0, null, [], [], true]);
    const started = { ...OVERVIEW, event: { ...OVERVIEW.event, proposed_date: '2030-06-05T00:00:00.000Z' } };
    assert.equal((await request(harness(as(OWNER), { overview: started }).app).get('/events/12/registrations')).body.can_edit, false);
    const undated = { ...OVERVIEW, event: { ...OVERVIEW.event, proposed_date: null } };
    assert.equal((await request(harness(as(OWNER), { overview: undated }).app).get('/events/12/registrations')).body.can_edit, true);
  });

  test('[CONFLICT] [SG2-63:AC5] a cancelled, completed or rejected event, or one without registration, cannot be edited', async () => {
    for (const event of [{ status: 'cancelled' }, { status: 'completed' }, { status: 'rejected' }, { registration_needed: false }]) {
      const overview = { ...OVERVIEW, event: { ...OVERVIEW.event, ...event } };
      const res = await request(harness(as(OWNER), { overview }).app).get('/events/12/registrations');
      assert.equal(res.body.can_edit, false, JSON.stringify(event));
    }
    const notNeeded = { ...OVERVIEW, event: { ...OVERVIEW.event, registration_needed: null } };
    const res = await request(harness(as(OWNER), { overview: notNeeded }).app).get('/events/12/registrations');
    assert.deepEqual([res.body.registration_needed, res.body.window], [false, 'not_required']);
  });

  test('[FAILURE] [SG2-63:AC1] a failed event or organisation read is 503, and bad ids, no session or no database are refused', async () => {
    const down = harness(as(OWNER), { fetchOverview: async () => ({ ok: false, reason: 'unavailable' }) });
    assert.deepEqual([(await request(down.app).get('/events/12/registrations')).status], [503]);
    const membership = harness(as(OWNER), { fetchOrganisation: async () => ({ ok: false, reason: 'unavailable', message: 'x' }) });
    assert.deepEqual((await request(membership.app).get('/events/12/registrations')).body, UNAVAILABLE);
    for (const id of ['0', 'abc', '2147483648', '1.5']) {
      assert.equal((await request(harness(as(OWNER)).app).get(`/events/${id}/registrations`)).status, 400, id);
    }
    assert.equal((await request(harness(as(OWNER)).app).get('/events/2147483647/registrations')).status, 404);
    assert.equal((await request(harness(null).app).get('/events/12/registrations')).status, 401);
    const noDb = harness(as(OWNER), { getAdminClient: () => null });
    assert.deepEqual((await request(noDb.app).get('/events/12/registrations')).body, UNAVAILABLE);
  });
});

describe('the waiting list in the registration picture (SG2-61, SG2-62 AC6)', () => {
  const WAITING = { ...OVERVIEW, event: { ...OVERVIEW.event, waiting_list_response_hours: 6 }, waiting_list: [
    { entry_id: 5, name: 'Cara Waiting', organisation: null, status: 'offered' as const, joined_at: '2030-06-03T02:00:00.000Z',
      offer_expires_at: '2030-06-05T06:00:00.000Z' },
    { entry_id: 6, name: 'Dev Waiting', organisation: 'Guests Ltd', status: 'waiting' as const, joined_at: '2030-06-03T03:00:00.000Z',
      offer_expires_at: null },
    { entry_id: 8, name: 'Eve Waiting', organisation: null, status: 'waiting' as const, joined_at: '2030-06-04T03:00:00.000Z',
      offer_expires_at: null }
  ] };
  const LIST = [
    { ...WAITING.waiting_list[0], position: null },
    { ...WAITING.waiting_list[1], position: 1 },
    { ...WAITING.waiting_list[2], position: 2 }
  ];

  test('[NORMAL] [SG2-61:AC7] [SG2-62:AC6] the organiser and the assigned coordinator see the list in order, the offer and the response window', async () => {
    for (const viewer of [as(OWNER), as(COORDINATOR, 'event_coordinator')]) {
      const res = await request(harness(viewer, { overview: WAITING }).app).get('/events/12/registrations');
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.waiting_list, res.body.waiting_list_response_hours], [LIST, 6], viewer.userId);
    }
  });

  test('[FAILURE] [SG2-61:AC7] someone outside the event sees no list, only that it was not found', async () => {
    const res = await request(harness(as(OUTSIDER), { overview: WAITING }).app).get('/events/12/registrations');
    assert.deepEqual([res.status, res.body], [404, NOT_FOUND]);
  });

  test('[NORMAL] [SG2-62:AC6] the creating organiser sets the response window, which only they can change', async () => {
    const { app, writes } = harness(as(OWNER), { reread: { ok: true, overview: WAITING } });
    const res = await request(app).patch('/events/12/registration-settings').send({ waiting_list_response_hours: 6 });
    assert.deepEqual([res.status, res.body.waiting_list_response_hours], [200, 6]);
    assert.deepEqual(writes, [{ eventId: 12, actorId: OWNER, values: { waiting_list_response_hours: 6 }, closeNow: false }]);
    const coordinator = harness(as(COORDINATOR, 'event_coordinator'));
    assert.equal((await request(coordinator.app).patch('/events/12/registration-settings').send({ waiting_list_response_hours: 6 })).status, 403);
    assert.deepEqual(coordinator.writes, []);
  });
});

describe('PATCH and close of the registration settings (SG2-63)', () => {
  test('[NORMAL] [SG2-63:AC5] the creating organiser changes the settings as themselves and gets the picture as it now stands', async () => {
    const changed = { ...OVERVIEW, event: { ...OVERVIEW.event, registration_capacity: 150 } };
    const { app, writes } = harness(as(OWNER), { reread: { ok: true, overview: changed } });
    const res = await request(app).patch('/events/12/registration-settings').send({ registration_capacity: 150 });
    assert.equal(res.status, 200);
    assert.deepEqual(writes, [{ eventId: 12, actorId: OWNER, values: { registration_capacity: 150 }, closeNow: false }]);
    assert.deepEqual([res.body.registration_capacity, res.body.places_remaining, res.body.capacity_warnings],
      [150, 148, ['A capacity of 150 is more than Main hall holds (2).']]);
  });

  test('[BOUNDARY] [SG2-63:AC5] a saved change that cannot be re-read is answered with what was asked for', async () => {
    const { app } = harness(as(OWNER), { reread: { ok: false, reason: 'unavailable' } });
    const res = await request(app).patch('/events/12/registration-settings')
      .send({ registration_closes_at: '2030-06-15T01:00:00Z' });
    assert.equal(res.status, 200);
    assert.equal(res.body.registration_closes_at, '2030-06-15T01:00:00.000Z');
  });

  test('[NORMAL] [SG2-63:AC6] the creating organiser closes open registration now', async () => {
    const closed = { ...OVERVIEW, event: { ...OVERVIEW.event, registration_closes_at: '2030-06-04T23:59:00.000Z' } };
    const { app, writes } = harness(as(OWNER), { reread: { ok: true, overview: closed } });
    const res = await request(app).post('/events/12/registration-settings/close').send({ registration_capacity: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(writes, [{ eventId: 12, actorId: OWNER, values: {}, closeNow: true }]);
    assert.equal(res.body.window, 'closed');
  });

  test('[FAILURE] [SG2-63:AC8] a colleague or the assigned coordinator cannot change or close the settings, and nothing is written', async () => {
    for (const principal of [as(COLLEAGUE), as(COORDINATOR, 'event_coordinator')]) {
      const { app, writes } = harness(principal);
      const patch = await request(app).patch('/events/12/registration-settings').send({ registration_capacity: 150 });
      assert.deepEqual([patch.status, patch.body],
        [403, { error: 'Only the organiser who created this event can change its registration settings.' }]);
      const close = await request(app).post('/events/12/registration-settings/close');
      assert.deepEqual([close.status, close.body],
        [403, { error: 'Only the organiser who created this event can close its registration.' }]);
      assert.deepEqual(writes, []);
    }
  });

  test('[FAILURE] [SG2-63:AC3] an organiser outside the event\'s organisation learns only that it was not found, even with a bad body', async () => {
    const { app, writes } = harness(as(OUTSIDER));
    for (const body of [{ registration_capacity: 150 }, { registration_capacity: 0 }]) {
      const res = await request(app).patch('/events/12/registration-settings').send(body);
      assert.deepEqual([res.status, res.body], [404, NOT_FOUND]);
    }
    assert.deepEqual((await request(app).post('/events/12/registration-settings/close')).body, NOT_FOUND);
    assert.deepEqual(writes, []);
  });

  test('[FAILURE] [SG2-63:AC5] an invalid body or schedule is refused with every problem before anything is written', async () => {
    const { app, writes } = harness(as(OWNER));
    const shape = await request(app).patch('/events/12/registration-settings').send({ registration_capacity: 0, planning_notes: 'x' });
    assert.deepEqual([shape.status, shape.body], [400, { error: 'Invalid registration settings', details: [
      'Only registration_capacity, registration_opens_at, registration_closes_at, waiting_list_response_hours can be changed here.',
      'registration_capacity must be a whole number from 1 to 2147483647.'
    ] }]);
    const schedule = await request(app).patch('/events/12/registration-settings')
      .send({ registration_closes_at: '2030-06-21T01:00:00Z' });
    assert.deepEqual([schedule.status, schedule.body], [400, { error: 'Invalid registration settings',
      details: ['Registration must close before the event starts.'] }]);
    assert.deepEqual(writes, []);
  });

  test('[FAILURE] [SG2-63:AC10] clearing a setting on a confirmed event is refused before anything is written', async () => {
    const { app, writes } = harness(as(OWNER));
    const res = await request(app).patch('/events/12/registration-settings').send({ registration_closes_at: null });
    assert.deepEqual([res.status, res.body], [400, { error: 'Invalid registration settings', details: [
      'Capacity and opening and closing times cannot be cleared once the event is confirmed. Close registration early instead.'] }]);
    assert.equal(writes.length, 0);
  });

  test('[BOUNDARY] [SG2-63:AC5] capacity comes down to the registered count but not below it', async () => {
    const { app, writes } = harness(as(OWNER));
    const below = await request(app).patch('/events/12/registration-settings').send({ registration_capacity: 1 });
    assert.deepEqual([below.status, below.body], [400, { error: 'Invalid registration settings',
      details: ['2 people are already registered, so the capacity cannot be lower than 2.'] }]);
    assert.equal(writes.length, 0);
    assert.equal((await request(app).patch('/events/12/registration-settings').send({ registration_capacity: 2 })).status, 200);
    assert.deepEqual(writes.map(write => write.values), [{ registration_capacity: 2 }]);
  });

  test('[CONFLICT] [SG2-63:AC5] [SG2-63:AC6] each database refusal is answered with its own status', async () => {
    const cases: [UpdateRegistrationSettingsResult, number, unknown][] = [
      [{ outcome: 'missing' }, 404, NOT_FOUND],
      [{ outcome: 'closed', status: 'cancelled' }, 409,
        { error: 'This event is closed, so its registration settings can no longer change.', status: 'cancelled' }],
      [{ outcome: 'not_needed' }, 409, { error: 'This event does not take registrations.' }],
      [{ outcome: 'started' }, 409, { error: 'The event has started, so its registration settings can no longer change.' }],
      [{ outcome: 'not_open' }, 409, { error: 'Registration is not open, so it cannot be closed early.' }],
      // A registration arriving between the server's check and the write.
      [{ outcome: 'below_registered', registered: 3 }, 409,
        { error: '3 people are already registered, so the capacity cannot be lower than 3.', registered: 3 }],
      [{ outcome: 'invalid' }, 400, { error: 'Invalid registration settings', details: [] }],
      [{ outcome: 'unavailable' }, 503, UNAVAILABLE]
    ];
    for (const [result, status, body] of cases) {
      const res = await request(harness(as(OWNER), { result }).app).post('/events/12/registration-settings/close');
      assert.deepEqual([res.status, res.body], [status, body], result.outcome);
    }
  });
});
