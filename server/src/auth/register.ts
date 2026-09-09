import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import { createUserRecord, VALID_ROLE_NAMES, type RoleName } from '../db/users';

export interface RegisterAccountInput {
  name: string;
  email: string;
  password: string;
  organisation: string;
  role: string;
}

/**
 * Roles selectable at registration. Currently all five — the team's
 * decision as of 2026-09-09, expected to narrow later (e.g. to just the
 * externally-facing Event Organiser / Attendee) once internal-staff
 * provisioning is settled. Change only this list to change what's offered.
 */
export const SELF_REGISTERABLE_ROLES: readonly RoleName[] = VALID_ROLE_NAMES;

export type RegisterAccountResult =
  | { outcome: 'created'; userId: string }
  | { outcome: 'invalid'; message: string }
  | { outcome: 'duplicate'; message: string }
  | { outcome: 'unavailable'; message: string };

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

  const record = await createUserRecord(admin, {
    userId: data.user.id,
    name: name.trim(),
    organisation: organisation.trim(),
    roleName: role
  });

  if (!record.ok) {
    // The Auth account was created but has no matching public.users row
    // (role_id is NOT NULL there) — remove it so the email isn't stuck
    // as "already registered" for a signup that never actually completed.
    await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
    return { outcome: 'unavailable', message: UNAVAILABLE_MESSAGE };
  }

  return { outcome: 'created', userId: data.user.id };
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
