import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  registerAccount,
  createRegisterHandler,
  RegisterAccountResult
} from './auth/register';

function buildApp(register: (input: unknown) => Promise<RegisterAccountResult>) {
  const app = express();
  app.use(express.json());
  app.post('/api/auth/register', createRegisterHandler(register as any));
  return app;
}

const validInput = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'correct-horse-battery',
  organisation: 'Analytical Engines Ltd'
};

function fakeAdmin(createUser: (payload: any) => Promise<any>): () => SupabaseClient | null {
  return () => ({ auth: { admin: { createUser } } } as unknown as SupabaseClient);
}

describe('registerAccount', () => {
  test('creates an account with name and organisation stored on the user', async () => {
    const result = await registerAccount(
      validInput,
      fakeAdmin(async (payload) => {
        assert.equal(payload.email, validInput.email);
        assert.equal(payload.password, validInput.password);
        assert.equal(payload.email_confirm, true);
        assert.deepEqual(payload.user_metadata, {
          name: validInput.name,
          organisation: validInput.organisation
        });
        return { data: { user: { id: 'user-123' } }, error: null };
      })
    );
    assert.deepEqual(result, { outcome: 'created', userId: 'user-123' });
  });

  test('rejects a duplicate email with a clear, generic message', async () => {
    const result = await registerAccount(
      validInput,
      fakeAdmin(async () => ({
        data: { user: null },
        error: { message: 'A user with this email address has already been registered' }
      }))
    );
    assert.deepEqual(result, {
      outcome: 'duplicate',
      message: 'An account with this email address already exists.'
    });
  });

  test('surfaces provider validation errors (e.g. weak password) as invalid', async () => {
    const result = await registerAccount(
      validInput,
      fakeAdmin(async () => ({
        data: { user: null },
        error: { message: 'Password should be at least 6 characters' }
      }))
    );
    assert.deepEqual(result, {
      outcome: 'invalid',
      message: 'Password should be at least 6 characters'
    });
  });

  test('rejects missing required fields without calling the admin client', async () => {
    let called = false;
    const result = await registerAccount({ email: validInput.email }, () => {
      called = true;
      return null;
    });
    assert.equal(result.outcome, 'invalid');
    assert.equal(called, false);
  });

  test('rejects a malformed email address', async () => {
    const result = await registerAccount({ ...validInput, email: 'not-an-email' }, () => null);
    assert.equal(result.outcome, 'invalid');
  });

  test('reports unavailable when the admin client cannot be created', async () => {
    const result = await registerAccount(validInput, () => null);
    assert.deepEqual(result, {
      outcome: 'unavailable',
      message: 'Registration is temporarily unavailable. Please try again later.'
    });
  });

  test('reports unavailable when the provider returns no user and no error', async () => {
    const result = await registerAccount(
      validInput,
      fakeAdmin(async () => ({ data: { user: null }, error: null }))
    );
    assert.equal(result.outcome, 'unavailable');
  });
});

describe('POST /api/auth/register', () => {
  test('returns 201 with the new user id on success', async () => {
    const app = buildApp(async () => ({ outcome: 'created', userId: 'user-123' }));
    const response = await request(app).post('/api/auth/register').send(validInput);
    assert.equal(response.status, 201);
    assert.equal(response.body.userId, 'user-123');
  });

  test('returns 409 for a duplicate email', async () => {
    const message = 'An account with this email address already exists.';
    const app = buildApp(async () => ({ outcome: 'duplicate', message }));
    const response = await request(app).post('/api/auth/register').send(validInput);
    assert.equal(response.status, 409);
    assert.equal(response.body.error, message);
  });

  test('returns 400 for invalid input', async () => {
    const app = buildApp(async () => ({ outcome: 'invalid', message: 'Enter a valid email address.' }));
    const response = await request(app).post('/api/auth/register').send(validInput);
    assert.equal(response.status, 400);
  });

  test('returns 503 when registration is unavailable', async () => {
    const message = 'Registration is temporarily unavailable. Please try again later.';
    const app = buildApp(async () => ({ outcome: 'unavailable', message }));
    const response = await request(app).post('/api/auth/register').send(validInput);
    assert.equal(response.status, 503);
    assert.equal(response.body.error, message);
  });
});
