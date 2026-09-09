import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../app';
import { dbConfig } from '../db/config';

const originalNodeEnv = process.env.NODE_ENV;
const originalConfig = { ...dbConfig };

beforeEach(() => {
  dbConfig.supabaseUrl = 'https://test-project.supabase.co';
  dbConfig.supabaseAnonKey = 'sb_publishable_test-key';
  dbConfig.supabaseServiceRoleKey = undefined;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  mock.restoreAll();
  Object.assign(dbConfig, originalConfig);
});

// Regression test for the header-based auth stand-in being spoofable
// (x-user-id/x-user-internal are entirely client-controlled). Flagged by the
// repo's AI security review on PR #4 as a critical IDOR risk, so requireUser
// must refuse to run at all once NODE_ENV is production, regardless of what
// headers are sent.
test('requireUser refuses the header stand-in in production, even with valid-looking headers', async () => {
  process.env.NODE_ENV = 'production';
  const response = await request(app)
    .get('/api/profile')
    .set('x-user-id', 'u1')
    .set('x-user-internal', 'true');
  assert.equal(response.status, 404);
});

test('requireUser still accepts the header stand-in outside production', async () => {
  process.env.NODE_ENV = 'test';
  mock.method(globalThis, 'fetch', async () => new Response('[]', { status: 200 }));
  const response = await request(app).get('/api/profile').set('x-user-id', 'u1');
  // Reaches the real route handler (a clean "no such profile" 404 from
  // fetchProfile), not the auth gate's generic 404 — proving the request got
  // past requireUser and all the way to the database lookup.
  assert.equal(response.status, 404);
  assert.equal(response.body.error, 'Profile not found');
});
