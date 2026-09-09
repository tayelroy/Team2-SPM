import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthenticatedCaller {
  userId: string;
  email: string;
  name: string;
  organisation: string | null;
  role: string;
}

export type VerifyCallerResult =
  | { ok: true; caller: AuthenticatedCaller }
  | { ok: false; reason: 'invalid_token' | 'no_account' };

/**
 * Verifies a Supabase access token and resolves the caller's role.
 * Two clients are needed: the anon client to check the token against
 * Supabase Auth (what it's for), and the admin client to read the role
 * reliably regardless of RLS state.
 */
export async function verifyCaller(
  anonClient: SupabaseClient,
  adminClient: SupabaseClient,
  accessToken: string
): Promise<VerifyCallerResult> {
  const { data: authData, error: authError } = await anonClient.auth.getUser(accessToken);
  if (authError || !authData?.user) {
    return { ok: false, reason: 'invalid_token' };
  }

  const { data: userRow, error: userError } = await adminClient
    .from('users')
    .select('name, organisation, role_id')
    .eq('user_id', authData.user.id)
    .maybeSingle();

  if (userError || !userRow) {
    return { ok: false, reason: 'no_account' };
  }

  const { name, organisation, role_id: roleId } = userRow as {
    name: string;
    organisation: string | null;
    role_id: number;
  };

  const { data: roleRow, error: roleError } = await adminClient
    .from('roles')
    .select('role_name')
    .eq('role_id', roleId)
    .maybeSingle();

  if (roleError || !roleRow) {
    return { ok: false, reason: 'no_account' };
  }

  return {
    ok: true,
    caller: {
      userId: authData.user.id,
      email: authData.user.email ?? '',
      name,
      organisation,
      role: (roleRow as { role_name: string }).role_name
    }
  };
}

/** Reads the bearer token from an Authorization header, if present and well-formed. */
export function readBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}
