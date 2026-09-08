import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app, createApp } from './app';
import {
  checkDatabaseHealth,
  isSupabaseConfigured,
  dbConfig,
  UnifiedDatabaseHealth
} from './db';

// Unit tests must not connect to a developer's configured database.
before(() => {
  for (const key of Object.keys(dbConfig) as (keyof typeof dbConfig)[]) {
    dbConfig[key] = undefined;
  }
});

describe('Public database readiness', () => {
  for (const route of ['/health/db', '/api/health/db']) {
    for (const status of ['connected', 'unconfigured', 'error'] as const) {
      test(`${route}: ${status} returns only public fields`, async () => {
        const configured = status !== 'unconfigured';
        const health: UnifiedDatabaseHealth = {
          provider: 'Supabase', configured,
          supabase: {
            configured, status,
            url: 'https://private-project.supabase.co',
            error: 'SUPABASE_SECRET_SENTINEL'
          }
        };
        const response = await request(createApp(async () => health)).get(route);
        assert.equal(response.status, status === 'error' ? 503 : 200);
        assert.equal(response.body.status, status === 'error' ? 'degraded' : 'ok');
        assert.deepEqual(response.body.database, {
          provider: health.provider, configured,
          supabase: { configured, status }
        });
        assert.doesNotMatch(response.text, /SENTINEL|private-project|internal-db/);
      });
    }

    test(`${route}: unexpected failure returns generic JSON`, async () => {
      const response = await request(createApp(async () => {
        throw new Error('PASSWORD_SENTINEL: invalid connection string');
      })).get(route);
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, { status: 'degraded' });
    });
  }
});

describe('Health Check API', () => {
  test('base health aliases report configured Supabase without exposing credentials', async (t) => {
    const previous = { ...dbConfig };
    t.after(() => Object.assign(dbConfig, previous));
    dbConfig.supabaseUrl = 'https://private-project.supabase.co';
    dbConfig.supabaseAnonKey = 'API_KEY_SENTINEL';
    for (const route of ['/health', '/api/health']) {
      const response = await request(app).get(route);
      assert.equal(response.status, 200);
      assert.equal(response.body.database.configured, true);
      assert.equal(response.body.database.supabaseClient, 'configured');
      assert.doesNotMatch(response.text, /SENTINEL|private-project/);
    }
  });

  test('GET /health returns 200 and status ok with database info', async () => {
    const response = await request(app).get('/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.service, 'ConnectSphere Backend');
    assert.ok(typeof response.body.uptime === 'number');
    assert.ok(typeof response.body.timestamp === 'string');
    assert.ok(response.body.database);
    assert.equal(response.body.database.provider, 'Supabase');
    assert.ok('configured' in response.body.database);
  });

  test('GET /api/health returns 200 and status ok with database info', async () => {
    const response = await request(app).get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.service, 'ConnectSphere Backend');
    assert.ok(typeof response.body.uptime === 'number');
    assert.ok(typeof response.body.timestamp === 'string');
    assert.ok(response.body.database);
    assert.equal(response.body.database.provider, 'Supabase');
  });

  test('GET /api/health/db returns database health report', async () => {
    const response = await request(app).get('/api/health/db');
    assert.ok(response.status === 200 || response.status === 503);
    assert.ok(response.body.database);
    assert.equal(response.body.database.provider, 'Supabase');
    assert.ok('supabase' in response.body.database);
    assert.ok(!('postgres' in response.body.database));
  });
});

describe('Supabase HTTPS Client Connection Modules', () => {
  test('checkDatabaseHealth returns structured health object', async () => {
    const health = await checkDatabaseHealth();
    assert.equal(health.provider, 'Supabase');
    assert.ok(typeof health.configured === 'boolean');
    assert.ok(health.supabase);
    assert.ok(['connected', 'unconfigured', 'error'].includes(health.supabase.status));
  });

  test('isSupabaseConfigured returns a boolean flag', () => {
    assert.equal(typeof isSupabaseConfigured(), 'boolean');
  });
});
