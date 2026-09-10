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
  password: 'Correct-Horse-9',
  organisation: 'Analytical Engines Ltd',
  role: 'Attendee'
};

interface FakeAdminOptions {
  createUser: (payload: any) => Promise<any>;
  roleLookup?: () => Promise<{ data: { role_id: number } | null; error: { message: string } | null }>;
  usersInsert?: (row: any) => Promise<{ error: { message: string } | null }>;
  accountRoleInsert?: (row: any) => Promise<{ error: { message: string } | null }>;
  deleteUser?: (id: string) => Promise<any>;
}

function fakeAdmin(options: FakeAdminOptions): () => SupabaseClient | null {
  return () =>
    ({
      auth: {
        admin: {
          createUser: options.createUser,
          deleteUser: options.deleteUser ?? (async () => ({ error: null }))
        }
      },
      from(table: string) {
        if (table === 'roles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: options.roleLookup ?? (async () => ({ data: { role_id: 5 }, error: null }))
              })
            })
          };
        }
        if (table === 'users') {
          return { insert: options.usersInsert ?? (async () => ({ error: null })) };
        }
        if (table === 'account_roles') {
          return {
            insert: options.accountRoleInsert ?? (async () => ({ error: null })),
            delete: () => ({ eq: async () => ({ error: null }) })
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }
    }) as unknown as SupabaseClient;
}

describe('registerAccount', () => {
  test('creates the Auth account, a public.users profile row, and an account_roles row', async () => {
    let insertedUserRow: any;
    let insertedRoleRow: any;
    const result = await registerAccount(
      validInput,
      fakeAdmin({
        createUser: async (payload) => {
          assert.equal(payload.email, validInput.email);
          assert.equal(payload.password, validInput.password);
          assert.equal(payload.email_confirm, true);
          return { data: { user: { id: 'user-123' } }, error: null };
        },
        roleLookup: async () => ({ data: { role_id: 5 }, error: null }),
        usersInsert: async (row) => {
          insertedUserRow = row;
          return { error: null };
        },
        accountRoleInsert: async (row) => {
          insertedRoleRow = row;
          return { error: null };
        }
      })
    );
    assert.deepEqual(result, { outcome: 'created', userId: 'user-123' });
    assert.deepEqual(insertedUserRow, {
      user_id: 'user-123',
      name: validInput.name,
      organisation: validInput.organisation,
      role_id: 5
    });
    // account_roles is the authoritative store — the role is written in its
    // own snake_case form, converted from the Title Case the UI sent.
    assert.deepEqual(insertedRoleRow, { user_id: 'user-123', role: 'attendee' });
  });

  test('converts a multi-word role to snake_case (e.g. Event Coordinator)', async () => {
    let insertedRoleRow: any;
    const result = await registerAccount(
      { ...validInput, role: 'Event Coordinator' },
      fakeAdmin({
        createUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
        accountRoleInsert: async (row) => {
          insertedRoleRow = row;
          return { error: null };
        }
      })
    );
    assert.deepEqual(result, { outcome: 'created', userId: 'user-123' });
    assert.equal(insertedRoleRow.role, 'event_coordinator');
  });

  test('rejects a role that is not one of the self-registerable roles', async () => {
    let called = false;
    const result = await registerAccount({ ...validInput, role: 'Overlord' }, () => {
      called = true;
      return null;
    });
    assert.deepEqual(result, { outcome: 'invalid', message: 'Choose a valid role.' });
    assert.equal(called, false);
  });

  test('rejects Technical Support Staff at self-registration (privilege escalation guard)', async () => {
    let called = false;
    const result = await registerAccount({ ...validInput, role: 'Technical Support Staff' }, () => {
      called = true;
      return null;
    });
    assert.deepEqual(result, { outcome: 'invalid', message: 'Choose a valid role.' });
    assert.equal(called, false);
  });

  test('rejects a duplicate email with a clear, generic message', async () => {
    const result = await registerAccount(
      validInput,
      fakeAdmin({
        createUser: async () => ({
          data: { user: null },
          error: { message: 'A user with this email address has already been registered' }
        })
      })
    );
    assert.deepEqual(result, {
      outcome: 'duplicate',
      message: 'An account with this email address already exists.'
    });
  });

  test('surfaces provider validation errors (e.g. weak password) as invalid', async () => {
    const result = await registerAccount(
      validInput,
      fakeAdmin({
        createUser: async () => ({
          data: { user: null },
          error: { message: 'Password should be at least 6 characters' }
        })
      })
    );
    assert.deepEqual(result, {
      outcome: 'invalid',
      message: 'Password should be at least 6 characters'
    });
  });

  test('rejects missing required fields without calling the admin client', async () => {
    for (const field of ['name', 'email', 'password', 'organisation', 'role'] as const) {
      // Each required field is an independent validation decision. Whitespace
      // is empty only for fields that the implementation explicitly trims.
      const emptyValues = field === 'password' ? [undefined, ''] : [undefined, '', '   '];
      for (const value of emptyValues) {
        let called = false;
        const result = await registerAccount({ ...validInput, [field]: value }, () => {
          called = true;
          return null;
        });
        assert.equal(result.outcome, 'invalid', `${field}=${JSON.stringify(value)}`);
        assert.equal(called, false);
      }
    }
  });

  test('rejects a malformed email address', async () => {
    const result = await registerAccount({ ...validInput, email: 'not-an-email' }, () => null);
    assert.equal(result.outcome, 'invalid');
  });

  test('rejects a password shorter than 8 characters', async () => {
    let called = false;
    const result = await registerAccount({ ...validInput, password: 'Sh0rt-x' }, () => {
      called = true;
      return null;
    });
    assert.deepEqual(result, {
      outcome: 'invalid',
      message: 'Password must be at least 8 characters long.'
    });
    assert.equal(called, false);
  });

  test('rejects a password missing an uppercase letter', async () => {
    const result = await registerAccount({ ...validInput, password: 'lowercase-9' }, () => null);
    assert.deepEqual(result, {
      outcome: 'invalid',
      message: 'Password must include an uppercase letter, a lowercase letter, and a number.'
    });
  });

  test('rejects a password missing a lowercase letter', async () => {
    const result = await registerAccount({ ...validInput, password: 'UPPERCASE-9' }, () => null);
    assert.equal(result.outcome, 'invalid');
  });

  test('rejects a password missing a number', async () => {
    const result = await registerAccount({ ...validInput, password: 'NoNumbers-Here' }, () => null);
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
      fakeAdmin({ createUser: async () => ({ data: { user: null }, error: null }) })
    );
    assert.equal(result.outcome, 'unavailable');
  });

  test('rolls back the Auth account when the profile role is not configured', async () => {
    let deletedId: string | undefined;
    const result = await registerAccount(
      validInput,
      fakeAdmin({
        createUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
        roleLookup: async () => ({ data: null, error: null }),
        deleteUser: async (id) => {
          deletedId = id;
          return { error: null };
        }
      })
    );
    assert.equal(result.outcome, 'unavailable');
    assert.equal(deletedId, 'user-123');
  });

  test('rolls back the Auth account when the public.users insert fails', async () => {
    let deletedId: string | undefined;
    const result = await registerAccount(
      validInput,
      fakeAdmin({
        createUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
        usersInsert: async () => ({ error: { message: 'connection reset' } }),
        deleteUser: async (id) => {
          deletedId = id;
          return { error: null };
        }
      })
    );
    assert.equal(result.outcome, 'unavailable');
    assert.equal(deletedId, 'user-123');
  });

  test('rolls back the Auth account when the account_roles insert fails', async () => {
    let deletedId: string | undefined;
    const result = await registerAccount(
      validInput,
      fakeAdmin({
        createUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
        accountRoleInsert: async () => ({ error: { message: 'connection reset' } }),
        deleteUser: async (id) => {
          deletedId = id;
          return { error: null };
        }
      })
    );
    assert.equal(result.outcome, 'unavailable');
    assert.equal(deletedId, 'user-123');
  });

  test('still reports unavailable if the rollback delete itself fails', async () => {
    const result = await registerAccount(
      validInput,
      fakeAdmin({
        createUser: async () => ({ data: { user: { id: 'user-123' } }, error: null }),
        usersInsert: async () => ({ error: { message: 'connection reset' } }),
        deleteUser: async () => {
          throw new Error('network down');
        }
      })
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

  test('treats an absent request body as empty input and returns 400', async () => {
    const message = 'Name, email, password, organisation, and role are all required.';
    // Exercise the handler's fallback independently of express.json(), which
    // normalises a bodyless HTTP request to {} in this Express version.
    const app = express();
    app.post('/api/auth/register', createRegisterHandler(async input => {
      assert.deepEqual(input, {});
      return { outcome: 'invalid', message };
    }));
    const response = await request(app).post('/api/auth/register');
    assert.equal(response.status, 400);
    assert.equal(response.body.error, message);
  });

  test('returns 503 when registration is unavailable', async () => {
    const message = 'Registration is temporarily unavailable. Please try again later.';
    const app = buildApp(async () => ({ outcome: 'unavailable', message }));
    const response = await request(app).post('/api/auth/register').send(validInput);
    assert.equal(response.status, 503);
    assert.equal(response.body.error, message);
  });
});
