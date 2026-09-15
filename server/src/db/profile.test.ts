import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchProfile, updateProfile } from './profile';
import type { ProfileUpdateValues } from '../profile/fields';

type Result = { data: unknown; error: { message: string } | null };

const PROFILE_ROW = {
  user_id: 'user-1',
  name: 'Alex Tan',
  organisation: 'ConnectSphere Test',
  phone: '+65 8123 4567',
  communication_preferences: ['email'],
  department: null
};

function fakeSelectClient(result: Result, capture?: (userId: unknown, columns: string) => void): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'users');
      return {
        select: (columns: string) => ({
          eq: async (column: string, value: unknown) => {
            assert.equal(column, 'user_id');
            capture?.(value, columns);
            return result;
          }
        })
      };
    }
  } as unknown as SupabaseClient;
}

function fakeUpdateClient(
  result: Result,
  capture?: (row: Record<string, unknown>, userId: unknown) => void
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, 'users');
      return {
        update: (row: Record<string, unknown>) => ({
          eq: (column: string, value: unknown) => {
            assert.equal(column, 'user_id');
            return {
              select: async () => {
                capture?.(row, value);
                return result;
              }
            };
          }
        })
      };
    }
  } as unknown as SupabaseClient;
}

describe('fetchProfile', () => {
  test('returns the profile for the given user', async () => {
    let askedFor: unknown;
    const result = await fetchProfile(
      fakeSelectClient({ data: [PROFILE_ROW], error: null }, (v) => (askedFor = v)),
      'user-1'
    );
    assert.deepEqual(result, { ok: true, profile: PROFILE_ROW });
    assert.equal(askedFor, 'user-1');
  });

  test('reports not_found when the user has no record', async () => {
    const result = await fetchProfile(fakeSelectClient({ data: [], error: null }), 'ghost');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('reports not_found when the driver returns no data at all', async () => {
    const result = await fetchProfile(fakeSelectClient({ data: null, error: null }), 'ghost');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('reports unavailable when the query errors', async () => {
    const result = await fetchProfile(
      fakeSelectClient({ data: null, error: { message: 'connection reset' } }),
      'user-1'
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
      assert.equal(result.message, 'connection reset');
    }
  });
});

describe('updateProfile', () => {
  const UPDATE: ProfileUpdateValues = {
    name: 'Alex Tan',
    phone: '+65 8123 4567',
    communication_preferences: ['email']
  };

  test('writes name, phone and communication_preferences for an external role', async () => {
    let written: Record<string, unknown> | undefined;
    const result = await updateProfile(
      fakeUpdateClient({ data: [PROFILE_ROW], error: null }, (row) => (written = row)),
      'user-1',
      UPDATE
    );
    assert.equal(result.ok, true);
    assert.deepEqual(written, {
      name: 'Alex Tan',
      phone: '+65 8123 4567',
      communication_preferences: ['email']
    });
    assert.equal('department' in (written ?? {}), false);
  });

  test('also writes department when the validated update included it', async () => {
    let written: Record<string, unknown> | undefined;
    await updateProfile(
      fakeUpdateClient({ data: [{ ...PROFILE_ROW, department: 'Operations' }], error: null }, (row) => (written = row)),
      'user-1',
      { ...UPDATE, department: 'Operations' }
    );
    assert.equal(written?.department, 'Operations');
  });

  test('reports not_found when the user has no record', async () => {
    const result = await updateProfile(fakeUpdateClient({ data: [], error: null }), 'ghost', UPDATE);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('reports not_found when the driver returns no data at all', async () => {
    const result = await updateProfile(fakeUpdateClient({ data: null, error: null }), 'ghost', UPDATE);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'not_found');
  });

  test('reports unavailable when the update errors', async () => {
    const result = await updateProfile(
      fakeUpdateClient({ data: null, error: { message: 'violates check constraint' } }),
      'user-1',
      UPDATE
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unavailable');
      assert.equal(result.message, 'violates check constraint');
    }
  });
});
