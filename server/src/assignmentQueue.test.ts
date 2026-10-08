import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, ROLES, type Role } from './auth';
import { dbConfig } from './db';
import { createApp } from './app';
import { createAssignmentQueueRouter } from './assignmentQueue';
import type { FetchUnassignedQueueResult } from './db/assignmentQueue';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) dbConfig[key] = undefined;
});

const ENTRY = {
  event_id: 1, name: 'Leadership Forum', organiser_name: 'Olivia Organiser',
  proposed_date: '2030-06-15T02:00:00.000Z', expected_attendance: 120, submitted_at: '2026-10-06T01:00:00.000Z'
};

function appFor(role: Role, {
  admin = {} as SupabaseClient | null,
  result = { ok: true, entries: [ENTRY] } as FetchUnassignedQueueResult
} = {}) {
  let reads = 0;
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) });
  const app = express();
  app.use('/api/assignment-queue', createAssignmentQueueRouter(access, {
    getAdminClient: () => admin,
    fetchQueue: async () => { reads += 1; return result; }
  }));
  return { app, reads: () => reads };
}

test('[NORMAL] [SG2-87:AC2] [SG2-87:AC3] the Event Coordinator Lead reads the unassigned queue', async () => {
  const { app } = appFor('event_coordinator_lead');
  const response = await request(app).get('/api/assignment-queue').set('Authorization', 'Bearer token');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { entries: [ENTRY] });
});

test('[FAILURE] [SG2-87:AC2] every other role is refused before the queue is read', async () => {
  const others = ROLES.filter(role => role !== 'event_coordinator_lead');
  assert.equal(others.length, 6);
  for (const role of others) {
    const { app, reads } = appFor(role);
    const response = await request(app).get('/api/assignment-queue').set('Authorization', 'Bearer token');
    assert.equal(response.status, 403, role);
    assert.equal(reads(), 0, role);
  }
});

test('[FAILURE] [SG2-87:AC2] a request without a bearer token is refused, even for the Lead role', async () => {
  const { app, reads } = appFor('event_coordinator_lead');
  const response = await request(app).get('/api/assignment-queue');
  assert.equal(response.status, 401);
  assert.equal(reads(), 0);
});

test('[FAILURE] [SG2-87:AC2] an unconfigured or failing database answers 503 without leaking the cause', async () => {
  for (const options of [
    { admin: null },
    { result: { ok: false, reason: 'unavailable', message: 'DATABASE_SECRET' } as FetchUnassignedQueueResult }
  ]) {
    const { app } = appFor('event_coordinator_lead', options);
    const response = await request(app).get('/api/assignment-queue').set('Authorization', 'Bearer token');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: 'The assignment queue is temporarily unavailable. Please try again.' });
  }
});

test('[FAILURE] [SG2-87:AC2] the production app mounts the queue behind authentication', async () => {
  const response = await request(createApp()).get('/api/assignment-queue');
  assert.equal(response.status, 401);
});
