import { isSingaporePhone } from '../profile/fields';
import type { RegistrationInput } from '../db/registrableEvents';

/** The longest accessibility or dietary note an attendee may give (SG2-60 AC4). */
export const MAX_NEEDS_LENGTH = 500;
/** As the registrations table allows, separators included. */
const MAX_PHONE_LENGTH = 40;
const FIELDS = new Set(['contact_phone', 'needs']);

export type RegistrationValidation =
  | { valid: true; values: RegistrationInput }
  | { valid: false; errors: string[] };

/**
 * SG2-60 AC4: the information an attendee gives when registering. A contact
 * phone is required, as a Singapore number (SG2-27's rule); accessibility or
 * dietary needs are optional, at most 500 characters. Both are trimmed and
 * blank needs are none. Name and email come from the attendee's account.
 * register_for_event() checks the same rules again.
 */
export function readRegistration(body: unknown): RegistrationValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { valid: false, errors: ['Send the registration details as an object.'] };
  }
  const input = body as Record<string, unknown>;
  const errors = Object.keys(input).filter(key => !FIELDS.has(key)).map(key => `${key} is not a registration field.`);

  const phone = typeof input.contact_phone === 'string' ? input.contact_phone.trim() : '';
  if (input.contact_phone !== undefined && input.contact_phone !== null && typeof input.contact_phone !== 'string') {
    errors.push('contact_phone must be text.');
  } else if (phone === '') {
    errors.push('contact_phone is required.');
  } else if (phone.length > MAX_PHONE_LENGTH || !isSingaporePhone(phone)) {
    errors.push('contact_phone must be a Singapore number with 8 digits, optionally prefixed with +65.');
  }

  let needs: string | null = null;
  if (input.needs !== undefined && input.needs !== null) {
    if (typeof input.needs !== 'string') errors.push('needs must be text.');
    else if (input.needs.trim().length > MAX_NEEDS_LENGTH) errors.push(`needs must be ${MAX_NEEDS_LENGTH} characters or fewer.`);
    else needs = input.needs.trim() || null;
  }

  return errors.length ? { valid: false, errors } : { valid: true, values: { contact_phone: phone, needs } };
}
