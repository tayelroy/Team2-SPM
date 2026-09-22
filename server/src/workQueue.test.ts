import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAuthorization, type Role } from './auth';
import { createApp } from './app';
import { createWorkQueueRouter } from './workQueue';
import type { fetchWorkQueue, WorkItem } from './db/workQueue';

const item: WorkItem = { kind: 'event', item_id: 42, event_id: 42, title: 'Forum', event_name: 'Forum',
  status: 'submitted', starts_at: null, ends_at: null, category: 'review', details: { purpose: 'Planning' } };

function fixture(role: Role = 'event_coordinator', fetchItems: typeof fetchWorkQueue = async () => [item], admin: SupabaseClient | null = {} as SupabaseClient) {
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'verified-user', role }) });
  const router = createWorkQueueRouter(access, { fetchItems, getAdminClient: () => admin });
  const app = express();
  app.use('/api/work-queue', router);
  return { app, router, access };
}

test('list and detail forward verified identity and exact selection; app mounts the queue and prevents caching', async () => {
  const { router, access } = fixture('event_coordinator', async (_admin, principal, selection) => {
    assert.deepEqual(principal, { userId: 'verified-user', role: 'event_coordinator' });
    assert.deepEqual(selection, { kind: 'event', item_id: 42 });
    return [item];
  });
  const app = createApp(undefined, access, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, router);
  const response = await request(app).get('/api/work-queue/event/42?userId=someone-else&role=venue_staff').set('Authorization', 'Bearer token');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, { items: [item] });
  const list = fixture('venue_staff', async (_admin, principal, selection) => {
    assert.equal(principal.role, 'venue_staff');
    assert.equal(selection, undefined);
    return [];
  });
  assert.deepEqual((await request(list.app).get('/api/work-queue').set('Authorization', 'Bearer token')).body, { items: [] });
});

for (const role of ['event_coordinator', 'venue_staff', 'technical_support_staff', 'event_organiser', 'attendee'] as const) {
  test(`${role} is governed by the work queue role grant on both routes`, async () => {
    let reads = 0;
    const { app } = fixture(role, async () => { reads++; return [item]; });
    const allowed = ['event_coordinator', 'venue_staff', 'technical_support_staff'].includes(role);
    for (const path of ['', '/event/42']) {
      const response = await request(app).get(`/api/work-queue${path}`).set('Authorization', 'Bearer token');
      assert.equal(response.status, allowed ? 200 : 403);
    }
    assert.equal(reads, allowed ? 2 : 0);
  });
}

test('an unauthenticated caller cannot access either work queue route', async () => {
  const { app } = fixture('venue_staff', async () => { assert.fail('Must not read'); });
  for (const path of ['', '/venue/1']) assert.equal((await request(app).get(`/api/work-queue${path}`)).status, 401);
});

for (const path of ['unknown/1', 'event/0', 'venue/1.5', 'equipment/-1', 'event/9007199254740992', 'event/1e2']) {
  test(`rejects invalid selection ${path} before querying storage`, async () => {
    const { app } = fixture('venue_staff', async () => { assert.fail('Must not read'); });
    assert.equal((await request(app).get(`/api/work-queue/${path}`).set('Authorization', 'Bearer token')).status, 400);
  });
}

test('a missing, moved or decided record reports 404 with a useful return instruction', async () => {
  const { app } = fixture('venue_staff', async () => []);
  const response = await request(app).get('/api/work-queue/venue/1').set('Authorization', 'Bearer token');
  assert.equal(response.status, 404);
  assert.match(response.body.error, /Return to the queue/);
});

for (const failure of ['unconfigured', 'database'] as const) {
  test(`${failure} returns a generic retryable failure`, async () => {
    const { app } = fixture('technical_support_staff', async () => { throw new Error('DATABASE_SECRET'); },
      failure === 'unconfigured' ? null : {} as SupabaseClient);
    const response = await request(app).get('/api/work-queue').set('Authorization', 'Bearer token');
    assert.equal(response.status, 503);
    assert.match(response.body.error, /temporarily unavailable/);
    assert.ok(!JSON.stringify(response.body).includes('DATABASE_SECRET'));
  });
}
