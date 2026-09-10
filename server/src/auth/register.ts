import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { createUserRecord, VALID_ROLE_NAMES, type RoleName } from '../db/users';
import { createAccountRole, deleteAccountRole } from '../db/accountRoles';
import { toSnakeRole } from './roleFormat';

export interface RegisterAccountInput {
  name: string;
  email: string;
  password: string;
  organisation: string;
  role: string;
}

export type RegisterAccountResult =
  | { outcome: 'created'; userId: string }
  | { outcome: 'invalid'; message: string }
  | { outcome: 'duplicate'; message: string }
  | { outcome: 'unavailable'; message: string };

/**
 * Roles selectable at registration. Currently all five — the team's
 * decision as of 2026-09-09, expected to narrow later (e.g. to just the
 * externally-facing Event Organiser / Attendee) once internal-staff
 * provisioning is settled. Change only this list to change what's offered.
 */
export const SELF_REGISTERABLE_ROLES: readonly RoleName[] = VALID_ROLE_NAMES;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUPLICATE_EMAIL_PATTERN = /already (been )?registered|already exists/i;
const UNAVAILABLE_MESSAGE = 'Registration is temporarily unavailable. Please try again later.';
const PASSWORD_MIN_LENGTH = 8;

function passwordError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must include an uppercase letter, a lowercase letter, and a number.';
  }
  return null;
}

function validate(input: Partial<RegisterAccountInput>): string | null {
  const { name, email, password, organisation, role } = input;
  if (!name?.trim() || !email?.trim() || !password || !organisation?.trim() || !role?.trim()) {
    return 'Name, email, password, organisation, and role are all required.';
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    return 'Enter a valid email address.';
  }
  if (!SELF_REGISTERABLE_ROLES.includes(role as RoleName)) {
    return 'Choose a valid role.';
  }
  return passwordError(password);
}

/**
 * Uses the service-role client so account creation and duplicate-email
 * detection are deterministic, instead of relying on anon-key signUp's
 * enumeration-safe (and therefore ambiguous) response for existing emails.
 *
 * Writes land in two tables: public.users holds profile data (name,
 * organisation) and a legacy role_id kept only to satisfy that column's
 * NOT NULL constraint — it is not read for authorisation. The account's
 * real, authoritative role lives in public.account_roles (SG2-25), which
 * requireAuth/requirePermission actually check.
 */
export async function registerAccount(
  input: Partial<RegisterAccountInput>,
  getAdminClient: () => SupabaseClient | null = getSupabaseAdminClient
): Promise<RegisterAccountResult> {
  const validationError = validate(input);
  if (validationError) {
    return { outcome: 'invalid', message: validationError };
  }

  const admin = getAdminClient();
  if (!admin) {
    return { outcome: 'unavailable', message: UNAVAILABLE_MESSAGE };
  }

  const { name, email, password, organisation, role } = input as RegisterAccountInput;

  const { data, error } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true
  });

  if (error) {
    if (DUPLICATE_EMAIL_PATTERN.test(error.message)) {
      return {
        outcome: 'duplicate',
        message: 'An account with this email address already exists.'
      };
    }
    return { outcome: 'invalid', message: error.message };
  }

  if (!data?.user) {
    return { outcome: 'unavailable', message: UNAVAILABLE_MESSAGE };
  }

  const userId = data.user.id;

  const profile = await createUserRecord(admin, {
    userId,
    name: name.trim(),
    organisation: organisation.trim(),
    roleName: role
  });

  const roleRecord = profile.ok
    ? await createAccountRole(admin, userId, toSnakeRole(role))
    : { ok: false as const, error: 'skipped: profile creation already failed' };

  if (!profile.ok || !roleRecord.ok) {
    // Either write failing leaves an incomplete account — role_id is NOT
    // NULL on public.users, and account_roles is what authorisation
    // actually checks, so a partial account can neither exist cleanly nor
    // authenticate correctly. Remove it so the email isn't stuck as
    // "already registered" for a signup that never completed.
    await deleteAccountRole(admin, userId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return { outcome: 'unavailable', message: UNAVAILABLE_MESSAGE };
  }

  return { outcome: 'created', userId };
}

export function createRegisterHandler(
  register: typeof registerAccount = registerAccount
): RequestHandler {
  return async (req, res) => {
    const result = await register(req.body ?? {});

    switch (result.outcome) {
      case 'created':
        res.status(201).json({ message: 'Account created successfully.', userId: result.userId });
        return;
      case 'duplicate':
        res.status(409).json({ error: result.message });
        return;
      case 'invalid':
        res.status(400).json({ error: result.message });
        return;
      case 'unavailable':
        res.status(503).json({ error: result.message });
        return;
    }
  };
}
