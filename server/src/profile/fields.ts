/**
 * Field rules for maintaining a profile (SG2-27).
 *
 * Unlike event request drafts, a profile has no "incomplete" state to
 * support — every field here is either already set (seeded at account
 * creation) or optional, so validation only needs to reject malformed input.
 */

import { isInternalRole, type Role } from '../auth/policy';

export { isInternalRole };

/** Allowed values for communication_preferences. Order is not significant. */
export const COMMUNICATION_CHANNELS = ['email', 'sms', 'phone_call'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export interface ProfileUpdateValues {
  name: string;
  phone: string | null;
  communication_preferences: CommunicationChannel[];
  /** Present only when the caller's role is internal (see auth/policy.ts). */
  department?: string | null;
}

export type ProfileUpdateValidation =
  | { valid: true; values: ProfileUpdateValues }
  | { valid: false; errors: string[] };

const MAX_NAME_LENGTH = 200;
const MAX_DEPARTMENT_LENGTH = 150;
/** Eight Singapore national digits, optionally preceded by the +65 country code. */
const SINGAPORE_PHONE_PATTERN = /^(?:\+65)?[0-9]{8}$/;

function readName(value: unknown, errors: string[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push('name is required.');
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_NAME_LENGTH) {
    errors.push(`name must be ${MAX_NAME_LENGTH} characters or fewer.`);
    return '';
  }
  return trimmed;
}

function readPhone(value: unknown, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.push('phone must be text.');
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Ignore supported readability separators for validation, but preserve the
  // caller's trimmed formatting when storing their profile.
  const normalized = trimmed.replace(/[()\-.\s]/g, '');
  if (!SINGAPORE_PHONE_PATTERN.test(normalized)) {
    errors.push('phone must be a Singapore number with 8 digits, optionally prefixed with +65.');
    return null;
  }
  return trimmed;
}

function readCommunicationPreferences(value: unknown, errors: string[]): CommunicationChannel[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    errors.push('communication_preferences must be a list.');
    return [];
  }
  const allowed = new Set<string>(COMMUNICATION_CHANNELS);
  const seen = new Set<CommunicationChannel>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.has(entry)) {
      errors.push(`communication_preferences must only contain: ${COMMUNICATION_CHANNELS.join(', ')}.`);
      continue;
    }
    seen.add(entry as CommunicationChannel);
  }
  return [...seen];
}

function readDepartment(value: unknown, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.push('department must be text.');
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_DEPARTMENT_LENGTH) {
    errors.push(`department must be ${MAX_DEPARTMENT_LENGTH} characters or fewer.`);
    return null;
  }
  return trimmed;
}

/**
 * Validates a profile update payload.
 *
 * `department` is only accepted for internal roles (event_coordinator,
 * venue_staff, technical_support_staff — see auth/policy.ts); a value sent by
 * an external caller (event_organiser, attendee) is silently dropped rather
 * than stored or rejected, matching the "unknown fields are dropped" pattern
 * from SG2-28's event request draft.
 */
export function validateProfileUpdate(body: unknown, role: Role): ProfileUpdateValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }

  const input = body as Record<string, unknown>;
  const errors: string[] = [];

  const name = readName(input.name, errors);
  const phone = readPhone(input.phone, errors);
  const communication_preferences = readCommunicationPreferences(input.communication_preferences, errors);
  const internal = isInternalRole(role);
  const department = internal ? readDepartment(input.department, errors) : null;

  if (errors.length > 0) return { valid: false, errors };

  const values: ProfileUpdateValues = { name, phone, communication_preferences };
  if (internal) values.department = department;
  return { valid: true, values };
}
