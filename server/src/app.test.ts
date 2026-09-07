import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './app';
import {
  checkDatabaseHealth,
  isSupabaseConfigured,
  isPostgresConfigured
} from './db';

describe('Health Check API', () => {
  test('GET /health returns 200 and status ok with database info', async () => {
    const response = await request(app).get('/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.service, 'ConnectSphere Backend');
    assert.ok(typeof response.body.uptime === 'number');
    assert.ok(typeof response.body.timestamp === 'string');
    assert.ok(response.body.database);
    assert.equal(response.body.database.provider, 'Supabase Postgres');
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
    assert.equal(response.body.database.provider, 'Supabase Postgres');
  });

  test('GET /api/health/db returns database health report', async () => {
    const response = await request(app).get('/api/health/db');
    assert.ok(response.status === 200 || response.status === 503);
    assert.ok(response.body.database);
    assert.equal(response.body.database.provider, 'Supabase Postgres');
    assert.ok('supabase' in response.body.database);
    assert.ok('postgres' in response.body.database);
  });
});

describe('Supabase Postgres Client Connection Modules', () => {
  test('checkDatabaseHealth returns structured health object', async () => {
    const health = await checkDatabaseHealth();
    assert.equal(health.provider, 'Supabase Postgres');
    assert.ok(typeof health.configured === 'boolean');
    assert.ok(health.supabase);
    assert.ok(health.postgres);
    assert.ok(['connected', 'unconfigured', 'error'].includes(health.supabase.status));
    assert.ok(['connected', 'unconfigured', 'error'].includes(health.postgres.status));
  });

  test('isSupabaseConfigured and isPostgresConfigured return boolean flags', () => {
    assert.equal(typeof isSupabaseConfigured(), 'boolean');
    assert.equal(typeof isPostgresConfigured(), 'boolean');
  });
});
