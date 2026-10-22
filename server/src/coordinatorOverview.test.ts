import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, ROLES, type Role } from './auth';
import { dbConfig } from './db';
import { createApp } from './app';
import { createCoordinatorOverviewRouter } from './coordinatorOverview';
import { OVERSIGHT_STATUSES, type FetchSupervisedEventsResult, type SupervisedEvent } from './db/coordinatorOverview';
import type { ListCoordinatorsResult } from './db/accountRoles';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const event = (event_id: number, status: string, coordinator_id: string, coordinator_name: string): SupervisedEvent => ({
  event_id, name: `Event ${event_id}`, organisation: 'Client Org', status,
  proposed_date: '2030-06-15T02:00:00.000Z', coordinator_id, coordinator_name
});

const EVENTS = [
  event(1, 'needs_clarification', 'coord-1', 'Ada Coordinator'),
  event(2, 'planning', 'coord-1', 'Ada Coordinator'),
  event(3, 'planning', 'coord-2', 'Ben Coordinator')
];
const COORDINATORS = [
  { user_id: 'coord-2', name: 'Ben Coordinator' },
  { user_id: 'coord-1', name: 'Ada Coordinator' },
  { user_id: 'coord-3', name: 'Cleo Coordinator' }
];

function appFor(role: Role, {
  admin = {} as SupabaseClient | null,
  events = { ok: true, events: EVENTS } as FetchSupervisedEventsResult,
  coordinators = { ok: true, coordinators: COORDINATORS } as ListCoordinatorsResult
} = {}) {
  const leads: string[] = [];
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'lead-1', role }) });
  const app = express();
  app.use('/api/coordinator-overview', createCoordinatorOverviewRouter(access, {
    getAdminClient: () => admin,
    fetchEvents: async (_admin, leadId) => { leads.push(leadId); return events; },
    fetchCoordinators: async () => coordinators
  }));
  return { app, leads };
}

const get = (app: express.Express, query = '') =>
  request(app).get(`/api/coordinator-overview${query}`).set('Authorization', 'Bearer token');

test('[NORMAL] [SG2-89:AC1] the Lead sees the active events they supervise, each with its coordinator and status', async () => {
  const { app, leads } = appFor('event_coordinator_lead');
  const response = await get(app);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events, EVENTS);
  assert.deepEqual(response.body.statuses, OVERSIGHT_STATUSES);
  // Per-row: the events read are the caller's own supervised ones.
  assert.deepEqual(leads, ['lead-1']);
});

test('[NORMAL] [SG2-89:AC2] every coordinator is listed with how many of the Lead\'s events they hold, including those with none', async () => {
  const { app } = appFor('event_coordinator_lead');
  const response = await get(app);
  assert.deepEqual(response.body.coordinators, [
    { user_id: 'coord-1', name: 'Ada Coordinator', active_events: 2, assignable: true },
    { user_id: 'coord-2', name: 'Ben Coordinator', active_events: 1, assignable: true },
    { user_id: 'coord-3', name: 'Cleo Coordinator', active_events: 0, assignable: true }
  ]);
});

test('[NORMAL] [SG2-89:AC2] [SG2-89:AC3] filtering by coordinator shows that coordinator\'s events and keeps every workload count', async () => {
  const { app } = appFor('event_coordinator_lead');
  const response = await get(app, '?coordinatorId=coord-1');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events.map((e: SupervisedEvent) => e.event_id), [1, 2]);
  assert.equal(response.body.coordinators.length, 3);
});

test('[NORMAL] [SG2-89:AC3] [SG2-89:AC6] filtering by status, including awaiting clarification, and by both at once', async () => {
  const { app } = appFor('event_coordinator_lead');
  const clarification = await get(app, '?status=needs_clarification');
  assert.deepEqual(clarification.body.events.map((e: SupervisedEvent) => e.event_id), [1]);
  const both = await get(app, '?status=planning&coordinatorId=coord-2');
  assert.deepEqual(both.body.events.map((e: SupervisedEvent) => e.event_id), [3]);
  const none = await get(app, '?status=confirmed&coordinatorId=coord-3');
  assert.deepEqual([none.status, none.body.events], [200, []]);
});

test('[BOUNDARY] [SG2-89:AC3] blank filters are ignored rather than matching nothing', async () => {
  const { app } = appFor('event_coordinator_lead');
  const response = await get(app, '?coordinatorId=%20&status=');
  assert.deepEqual(response.body.events.map((e: SupervisedEvent) => e.event_id), [1, 2, 3]);
});

test('[BOUNDARY] [SG2-89:AC2] a coordinator who has since lost the role still shows with the events they hold', async () => {
  const { app } = appFor('event_coordinator_lead', {
    events: { ok: true, events: [event(4, 'approved', 'coord-gone', 'Gil Former'), event(5, 'approved', 'coord-unnamed', null as never)] }
  });
  const response = await get(app, '?coordinatorId=coord-gone');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.events.map((e: SupervisedEvent) => e.event_id), [4]);
  assert.deepEqual(response.body.coordinators.filter((c: { active_events: number }) => c.active_events > 0), [
    { user_id: 'coord-unnamed', name: 'Former coordinator', active_events: 1, assignable: false },
    { user_id: 'coord-gone', name: 'Gil Former', active_events: 1, assignable: false }
  ]);
});

test('[FAILURE] [SG2-89:AC3] an unknown status or coordinator, or a repeated filter, is refused', async () => {
  const { app, leads } = appFor('event_coordinator_lead');
  for (const [query, error] of [
    ['?status=draft', 'status must be the status of an active event.'],
    ['?status=unassigned', 'status must be the status of an active event.'],
    ['?coordinatorId=nobody', 'coordinatorId must be an Event Coordinator.'],
    ['?status=planning&status=approved', 'Give status at most once.'],
    ['?coordinatorId=a&coordinatorId=b', 'Give coordinatorId at most once.']
  ]) {
    const response = await get(app, query);
    assert.deepEqual([response.status, response.body], [400, { error }], query);
  }
  // Malformed filters are refused before any read; only the unknown coordinator needed the roster.
  assert.equal(leads.length, 1);
});

test('[FAILURE] [SG2-89:AC4] Event Coordinators and every other role are refused before anything is read', async () => {
  const others = ROLES.filter(role => role !== 'event_coordinator_lead');
  assert.equal(others.length, 6);
  for (const role of others) {
    const { app, leads } = appFor(role);
    const response = await get(app);
    assert.equal(response.status, 403, role);
    assert.deepEqual(leads, [], role);
  }
});

test('[FAILURE] [SG2-89:AC4] a request without a bearer token is refused, even for the Lead role', async () => {
  const { app, leads } = appFor('event_coordinator_lead');
  const response = await request(app).get('/api/coordinator-overview');
  assert.equal(response.status, 401);
  assert.deepEqual(leads, []);
});

test('[FAILURE] [SG2-89:AC1] an unconfigured or failing database answers 503 without leaking the cause', async () => {
  for (const options of [
    { admin: null },
    { events: { ok: false, reason: 'unavailable', message: 'DATABASE_SECRET' } as FetchSupervisedEventsResult },
    { coordinators: { ok: false, error: 'DATABASE_SECRET' } as ListCoordinatorsResult }
  ]) {
    const { app } = appFor('event_coordinator_lead', options);
    const response = await get(app);
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'The coordinator overview is temporarily unavailable. Please try again.' });
  }
});

test('[FAILURE] [SG2-89:AC4] the production app mounts the overview behind authentication', async () => {
  const response = await request(createApp()).get('/api/coordinator-overview');
  assert.equal(response.status, 401);
});
