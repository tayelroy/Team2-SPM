import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyCaller, readBearerToken } from './auth/session';

function fakeClients(options: {
  getUser?: () => Promise<any>;
  userRow?: { data: any; error: any };
  roleRow?: { data: any; error: any };
}) {
  const anon = {
    auth: {
      getUser: options.getUser ?? (async () => ({ data: { user: { id: 'user-1', email: 'a@b.com' } }, error: null }))
    }
  } as unknown as SupabaseClient;

  const admin = {
    from(table: string) {
      if (table === 'users') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle:
                async () => options.userRow ?? { data: { name: 'Ada', organisation: 'Org', role_id: 5 }, error: null }
            })
          })
        };
      }
      if (table === 'roles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => options.roleRow ?? { data: { role_name: 'Attendee' }, error: null }
            })
          })
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  } as unknown as SupabaseClient;

  return { anon, admin };
}

describe('verifyCaller', () => {
  test('resolves the caller with their role on a valid token', async () => {
    const { anon, admin } = fakeClients({});
    const result = await verifyCaller(anon, admin, 'valid-token');
    assert.deepEqual(result, {
      ok: true,
      caller: { userId: 'user-1', email: 'a@b.com', name: 'Ada', organisation: 'Org', role: 'Attendee' }
    });
  });

  test('rejects an invalid or expired token', async () => {
    const { anon, admin } = fakeClients({
      getUser: async () => ({ data: { user: null }, error: { message: 'invalid JWT' } })
    });
    const result = await verifyCaller(anon, admin, 'bad-token');
    assert.deepEqual(result, { ok: false, reason: 'invalid_token' });
  });

  test('rejects a valid token with no matching public.users row', async () => {
    const { anon, admin } = fakeClients({ userRow: { data: null, error: null } });
    const result = await verifyCaller(anon, admin, 'valid-token');
    assert.deepEqual(result, { ok: false, reason: 'no_account' });
  });

  test('rejects when the role lookup fails', async () => {
    const { anon, admin } = fakeClients({ roleRow: { data: null, error: null } });
    const result = await verifyCaller(anon, admin, 'valid-token');
    assert.deepEqual(result, { ok: false, reason: 'no_account' });
  });
});

describe('readBearerToken', () => {
  test('extracts the token from a well-formed header', () => {
    assert.equal(readBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  });

  test('returns null for a missing header', () => {
    assert.equal(readBearerToken(undefined), null);
  });

  test('returns null for a malformed header', () => {
    assert.equal(readBearerToken('abc.def.ghi'), null);
    assert.equal(readBearerToken('Basic abc'), null);
  });
});
