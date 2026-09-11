import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from './app';
import { createAuthorization, AccessError, type Role } from './auth';

const expected: Record<Role, string[]> = {
  event_organiser: ['page.dashboard', 'page.detail', 'page.change', 'event_request.create', 'event_request.change'],
  event_coordinator: ['page.dashboard', 'page.events', 'page.detail', 'page.venues', 'page.calendar', 'page.booking', 'page.equipment', 'page.change', 'event_request.review', 'venue_booking.request'],
  venue_staff: ['page.dashboard', 'page.venues', 'page.calendar', 'page.booking', 'venue_booking.decide'],
  technical_support_staff: ['page.dashboard', 'page.calendar', 'page.equipment', 'equipment.reserve', 'users.role.update'],
  attendee: ['page.dashboard', 'page.attendee', 'event_registration.manage']
};

for (const role of Object.keys(expected) as Role[]) {
  test(`SG2-25: ${role} receives exact page/action grants and real routes enforce them`, async () => {
    let drafts = 0, roleWrites = 0;
    const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'verified-user', role }) });
    const app = createApp(undefined, access, (_req, res) => { drafts++; res.sendStatus(201); }, undefined, undefined,
      (_req, res) => { roleWrites++; res.sendStatus(200); });
    const summary = await request(app).get('/api/auth/me').set('Authorization', 'Bearer token');
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body.permissions.sort(), [...expected[role]].sort());
    const forged = { role: 'technical_support_staff', permissions: ['users.role.update', 'event_request.create'], userId: 'someone-else' };
    const draft = await request(app).post('/api/event-requests').set('Authorization', 'Bearer token').send(forged);
    assert.equal(draft.status, role === 'event_organiser' ? 201 : 403);
    const update = await request(app).patch('/api/users/target/role').set('Authorization', 'Bearer token').send(forged);
    assert.equal(update.status, role === 'technical_support_staff' ? 200 : 403);
    assert.equal(drafts, Number(role === 'event_organiser'));
    assert.equal(roleWrites, Number(role === 'technical_support_staff'));
  });
}

test('SG2-25: absent/expired sessions and a role downgrade stop real actions before side effects', async () => {
  let role: Role = 'event_organiser', writes = 0;
  const access = createAuthorization({ resolvePrincipal: async token => {
    if (token === 'expired') throw new AccessError(401);
    return { userId: 'same-user', role };
  } });
  const app = createApp(undefined, access, (_req, res) => { writes++; res.sendStatus(201); }, undefined, undefined,
    (_req, res) => { writes++; res.sendStatus(200); });
  for (const token of [null, 'expired']) {
    let draft = request(app).post('/api/event-requests');
    let update = request(app).patch('/api/users/target/role');
    if (token) { draft = draft.set('Authorization', `Bearer ${token}`); update = update.set('Authorization', `Bearer ${token}`); }
    assert.equal((await draft.send({})).status, 401);
    assert.equal((await update.send({})).status, 401);
  }
  assert.equal(writes, 0);
  assert.equal((await request(app).post('/api/event-requests').set('Authorization', 'Bearer same-token')).status, 201);
  role = 'attendee';
  const summary = await request(app).get('/api/auth/me').set('Authorization', 'Bearer same-token');
  assert.ok(!summary.body.permissions.includes('event_request.create'));
  assert.equal((await request(app).post('/api/event-requests').set('Authorization', 'Bearer same-token')).status, 403);
  assert.equal(writes, 1);
});
