import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import handler from './index';

// Vercel's Node runtime invokes the module's default export directly as the
// request handler. If this stops being the Express app, the deployed API
// fails with FUNCTION_INVOCATION_FAILED even though `npm run build` succeeds.
test('default export is the Express app and serves /api/health', async () => {
  const response = await request(handler).get('/api/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'ConnectSphere Backend');
});
