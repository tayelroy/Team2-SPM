import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createAuthorization, ROLES, type Role } from './auth';
import { createProfileRouter, type ProfileRouterDependencies } from './profile';
import { isInternalRole, validateProfileUpdate } from './profile/fields';
import type { ProfileRecord, ProfileResult } from './db/profile';

const PROFILE: ProfileRecord = {
  user_id: 'user-1',
  name: 'Alex Tan',
  organisation: 'ConnectSphere Test',
  phone: '+65 8123 4567',
  communication_preferences: ['email'],
  department: 'Operations'
};

const VALID_BODY = { name: 'Alex Tan', phone: '+65 8123 4567', communication_preferences: ['email'] };

function fixture(
  role: Role = 'event_organiser',
  overrides: {
    fetch?: ProfileRouterDependencies['fetch'];
    update?: ProfileRouterDependencies['update'];
    admin?: object | null;
  } = {}
) {
  const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role }) });
  const app = express();
  app.use(express.json());
  app.use(
    '/api/profile',
    createProfileRouter(access, {
      getAdminClient: () => (overrides.admin === undefined ? ({} as any) : overrides.admin),
      fetch: overrides.fetch ?? (async () => ({ ok: true, profile: PROFILE })),
      update:
        overrides.update ??
        (async (_admin, _userId, updates) => ({ ok: true, profile: { ...PROFILE, ...updates } }))
    })
  );
  return app;
}

describe('GET /api/profile (SG2-27)', () => {
  test("returns the caller's own profile including department for an internal role", async () => {
    const res = await request(fixture('event_coordinator')).get('/api/profile').set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.profile, PROFILE);
  });

  test('omits department for an external role', async () => {
    const res = await request(fixture('event_organiser')).get('/api/profile').set('Authorization', 'Bearer token');
    assert.equal(res.status, 200);
    assert.equal('department' in res.body.profile, false);
    const { department: _department, ...rest } = PROFILE;
    assert.deepEqual(res.body.profile, rest);
  });

  test('returns 401 without a bearer token', async () => {
    const res = await request(fixture()).get('/api/profile');
    assert.equal(res.status, 401);
  });

  test('returns 409 when the account has no user record', async () => {
    const res = await request(fixture('event_organiser', { fetch: async () => ({ ok: false, reason: 'not_found', message: 'missing' }) }))
      .get('/api/profile')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 409);
  });

  test('returns 503 without leaking the database error when the lookup fails', async () => {
    const res = await request(
      fixture('event_organiser', { fetch: async () => ({ ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' }) })
    )
      .get('/api/profile')
      .set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
    assert.doesNotMatch(res.text, /SENTINEL/);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const res = await request(fixture('event_organiser', { admin: null })).get('/api/profile').set('Authorization', 'Bearer token');
    assert.equal(res.status, 503);
  });
});

describe('PUT /api/profile (SG2-27)', () => {
  test('updates name, phone and communication preferences', async () => {
    let captured: { userId: string; updates: unknown } | undefined;
    const app = fixture('event_organiser', {
      update: async (_admin, userId, updates) => {
        captured = { userId, updates };
        return { ok: true, profile: { ...PROFILE, ...updates } };
      }
    });
    const res = await request(app).put('/api/profile').set('Authorization', 'Bearer token').send(VALID_BODY);
    assert.equal(res.status, 200);
    assert.equal(captured?.userId, 'user-1');
    assert.deepEqual(captured?.updates, VALID_BODY);
  });

  test('an internal role can also set department', async () => {
    let captured: unknown;
    const app = fixture('venue_staff', {
      update: async (_admin, _userId, updates) => {
        captured = updates;
        return { ok: true, profile: { ...PROFILE, ...updates } };
      }
    });
    const res = await request(app)
      .put('/api/profile')
      .set('Authorization', 'Bearer token')
      .send({ ...VALID_BODY, department: 'Facilities' });
    assert.equal(res.status, 200);
    assert.equal((captured as { department: string }).department, 'Facilities');
  });

  test('an external role cannot set department — it is dropped, not rejected', async () => {
    let captured: unknown;
    const app = fixture('attendee', {
      update: async (_admin, _userId, updates) => {
        captured = updates;
        return { ok: true, profile: PROFILE };
      }
    });
    const res = await request(app)
      .put('/api/profile')
      .set('Authorization', 'Bearer token')
      .send({ ...VALID_BODY, department: 'Snuck In' });
    assert.equal(res.status, 200);
    assert.equal('department' in (captured as object), false);
  });

  test('rejects malformed input with a message naming each field', async () => {
    const res = await request(fixture())
      .put('/api/profile')
      .set('Authorization', 'Bearer token')
      .send({ name: '', phone: 'not a phone', communication_preferences: ['carrier_pigeon'] });
    assert.equal(res.status, 400);
    assert.equal(res.body.details.length, 3);
    assert.ok(res.body.details.some((d: string) => d.includes('name')));
    assert.ok(res.body.details.some((d: string) => d.includes('phone')));
    assert.ok(res.body.details.some((d: string) => d.includes('communication_preferences')));
  });

  test('treats an absent request body as invalid (name is required)', async () => {
    const bare = express();
    const access = createAuthorization({ resolvePrincipal: async () => ({ userId: 'user-1', role: 'event_organiser' as Role }) });
    bare.use('/api/profile', createProfileRouter(access, { getAdminClient: () => ({} as any) }));
    const res = await request(bare).put('/api/profile').set('Authorization', 'Bearer token');
    assert.equal(res.status, 400);
  });

  test('returns 401 without a bearer token', async () => {
    const res = await request(fixture()).put('/api/profile').send(VALID_BODY);
    assert.equal(res.status, 401);
  });

  test('returns 409 when the account has no user record', async () => {
    const res = await request(fixture('event_organiser', { update: async () => ({ ok: false, reason: 'not_found', message: 'missing' }) }))
      .put('/api/profile')
      .set('Authorization', 'Bearer token')
      .send(VALID_BODY);
    assert.equal(res.status, 409);
  });

  test('returns 503 without leaking the database error when the update fails', async () => {
    const res = await request(
      fixture('event_organiser', { update: async () => ({ ok: false, reason: 'unavailable', message: 'PRIVATE_SENTINEL' }) })
    )
      .put('/api/profile')
      .set('Authorization', 'Bearer token')
      .send(VALID_BODY);
    assert.equal(res.status, 503);
    assert.doesNotMatch(res.text, /SENTINEL/);
  });

  test('returns 503 when the database client is unavailable', async () => {
    const res = await request(fixture('event_organiser', { admin: null }))
      .put('/api/profile')
      .set('Authorization', 'Bearer token')
      .send(VALID_BODY);
    assert.equal(res.status, 503);
  });
});

describe('profile permission wiring', () => {
  for (const role of ROLES) {
    test(`${role} may read and update their own profile`, async () => {
      const app = fixture(role);
      const get = await request(app).get('/api/profile').set('Authorization', 'Bearer token');
      assert.notEqual(get.status, 403);
      const put = await request(app).put('/api/profile').set('Authorization', 'Bearer token').send(VALID_BODY);
      assert.notEqual(put.status, 403);
    });
  }
});

describe('defensive handling of a missing principal', () => {
  function fakeAccess(): ReturnType<typeof createAuthorization> {
    return {
      protectedRouter: () => express.Router(),
      requirePermission: () => (_req: any, _res: any, next: any) => next(),
      getPrincipal: () => undefined
    } as unknown as ReturnType<typeof createAuthorization>;
  }

  test('GET and PUT report 401 when no principal is present, even behind requireAuth', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/profile', createProfileRouter(fakeAccess(), { getAdminClient: () => ({} as any) }));
    assert.equal((await request(app).get('/api/profile')).status, 401);
    assert.equal((await request(app).put('/api/profile').send(VALID_BODY)).status, 401);
  });
});

describe('validateProfileUpdate', () => {
  const EXTERNAL: Role = 'event_organiser';
  const INTERNAL: Role = 'venue_staff';

  for (const body of [null, 'a string', ['an', 'array'], 42]) {
    test(`rejects a non-object body: ${JSON.stringify(body)}`, () => {
      const result = validateProfileUpdate(body, EXTERNAL);
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.errors[0], /JSON object/);
    });
  }

  test('trims name', () => {
    const result = validateProfileUpdate({ name: '  Alex Tan  ' }, EXTERNAL);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.values.name, 'Alex Tan');
  });

  for (const name of [undefined, null, '', '   ', 42, 'x'.repeat(201)]) {
    test(`rejects an invalid name: ${JSON.stringify(name)}`, () => {
      const result = validateProfileUpdate({ name }, EXTERNAL);
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.errors[0], /name/);
    });
  }

  test('accepts a name at exactly the length limit', () => {
    const result = validateProfileUpdate({ name: 'A'.repeat(200) }, EXTERNAL);
    assert.equal(result.valid, true);
  });

  for (const phone of [undefined, null, '', '   ']) {
    test(`treats an absent/blank phone as cleared: ${JSON.stringify(phone)}`, () => {
      const result = validateProfileUpdate({ name: 'Alex', phone }, EXTERNAL);
      assert.equal(result.valid, true);
      if (result.valid) assert.equal(result.values.phone, null);
    });
  }

  test('accepts a well-formed phone number and trims it', () => {
    const result = validateProfileUpdate({ name: 'Alex', phone: ' +65 8123 4567 ' }, EXTERNAL);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.values.phone, '+65 8123 4567');
  });

  test('rejects a non-string phone', () => {
    const result = validateProfileUpdate({ name: 'Alex', phone: 12345678 }, EXTERNAL);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.errors[0], /phone must be text/);
  });

  test('rejects a phone with too few digits', () => {
    const result = validateProfileUpdate({ name: 'Alex', phone: '12345' }, EXTERNAL);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.errors[0], /valid phone number/);
  });

  test('rejects a phone with too many digits', () => {
    const result = validateProfileUpdate({ name: 'Alex', phone: '1'.repeat(16) }, EXTERNAL);
    assert.equal(result.valid, false);
  });

  test('rejects a phone with disallowed characters', () => {
    const result = validateProfileUpdate({ name: 'Alex', phone: '8123-4567-CALL' }, EXTERNAL);
    assert.equal(result.valid, false);
  });

  for (const communication_preferences of [undefined, null]) {
    test(`treats an absent communication_preferences as empty: ${JSON.stringify(communication_preferences)}`, () => {
      const result = validateProfileUpdate({ name: 'Alex', communication_preferences }, EXTERNAL);
      assert.equal(result.valid, true);
      if (result.valid) assert.deepEqual(result.values.communication_preferences, []);
    });
  }

  test('rejects a non-array communication_preferences', () => {
    const result = validateProfileUpdate({ name: 'Alex', communication_preferences: 'email' }, EXTERNAL);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.errors[0], /must be a list/);
  });

  test('accepts every allowed channel and dedupes repeats', () => {
    const result = validateProfileUpdate({ name: 'Alex', communication_preferences: ['email', 'sms', 'email'] }, EXTERNAL);
    assert.equal(result.valid, true);
    if (result.valid) assert.deepEqual(result.values.communication_preferences, ['email', 'sms']);
  });

  for (const channel of ['carrier_pigeon', 42]) {
    test(`rejects an unknown or non-string channel: ${JSON.stringify(channel)}`, () => {
      const result = validateProfileUpdate({ name: 'Alex', communication_preferences: [channel] }, EXTERNAL);
      assert.equal(result.valid, false);
      if (!result.valid) assert.match(result.errors[0], /email, sms, phone_call/);
    });
  }

  test('drops department for an external role even when supplied', () => {
    const result = validateProfileUpdate({ name: 'Alex', department: 'Operations' }, EXTERNAL);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal('department' in result.values, false);
  });

  test('accepts and trims department for an internal role', () => {
    const result = validateProfileUpdate({ name: 'Alex', department: '  Facilities  ' }, INTERNAL);
    assert.equal(result.valid, true);
    if (result.valid) assert.equal(result.values.department, 'Facilities');
  });

  for (const department of [undefined, null, '', '  ']) {
    test(`treats an absent/blank department as cleared for an internal role: ${JSON.stringify(department)}`, () => {
      const result = validateProfileUpdate({ name: 'Alex', department }, INTERNAL);
      assert.equal(result.valid, true);
      if (result.valid) assert.equal(result.values.department, null);
    });
  }

  test('rejects a non-string department for an internal role', () => {
    const result = validateProfileUpdate({ name: 'Alex', department: 42 }, INTERNAL);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.errors[0], /department must be text/);
  });

  test('rejects an oversized department for an internal role', () => {
    const result = validateProfileUpdate({ name: 'Alex', department: 'D'.repeat(151) }, INTERNAL);
    assert.equal(result.valid, false);
    if (!result.valid) assert.match(result.errors[0], /150 characters/);
  });

  test('accepts a department at exactly the length limit', () => {
    const result = validateProfileUpdate({ name: 'Alex', department: 'D'.repeat(150) }, INTERNAL);
    assert.equal(result.valid, true);
  });
});

describe('isInternalRole (SG2-27 team decision, 2026-09-15)', () => {
  test('event_coordinator, venue_staff and technical_support_staff are internal', () => {
    assert.equal(isInternalRole('event_coordinator'), true);
    assert.equal(isInternalRole('venue_staff'), true);
    assert.equal(isInternalRole('technical_support_staff'), true);
  });

  test('event_organiser and attendee are external', () => {
    assert.equal(isInternalRole('event_organiser'), false);
    assert.equal(isInternalRole('attendee'), false);
  });
});
