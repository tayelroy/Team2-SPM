/**
 * SG2-63: the Event Organiser's registration settings and the registration
 * picture built from them. The SQL in
 * 202610200004_event_registration_settings.sql repeats these rules; they
 * must change together.
 */

/**
 * AC5: what the organiser sets. Registration needed stays an event detail.
 * SG2-62 AC6 adds the waiting-list response window.
 */
export const REGISTRATION_SETTING_FIELDS = [
  'registration_capacity',
  'registration_opens_at',
  'registration_closes_at',
  'waiting_list_response_hours'
] as const;
export type RegistrationSettingField = (typeof REGISTRATION_SETTING_FIELDS)[number];

export interface RegistrationSettingValues {
  registration_capacity?: number | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  /** Never cleared: it always has a value, 24 hours unless the organiser changed it. */
  waiting_list_response_hours?: number;
}

export interface RegistrationSettings {
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
}

export type ValidateRegistrationSettingsResult =
  | { valid: true; values: RegistrationSettingValues }
  | { valid: false; errors: string[] };

/** Matches the events.registration_capacity integer column. */
const MAX_CAPACITY = 2_147_483_647;
/**
 * SG2-62 AC6: how long a place offered from the waiting list is held, in
 * whole hours up to a week (team decision, 28 Oct 2026; PO to confirm).
 */
export const MAX_RESPONSE_HOURS = 168;

/** Statuses whose registration can no longer change (AC5). */
export const SETTLED_STATUSES = ['completed', 'cancelled', 'rejected'] as const;

export function isRegistrationSettingField(field: string): field is RegistrationSettingField {
  return (REGISTRATION_SETTING_FIELDS as readonly string[]).includes(field);
}

function parseTime(field: RegistrationSettingField, value: unknown, errors: string[]): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    errors.push(`${field} must be a valid date and time.`);
    return undefined;
  }
  return new Date(value).toISOString();
}

/**
 * AC5: the shape of a settings change. Only the settings being changed are
 * sent; null clears one. Anything else in the body is refused rather than
 * ignored, so a coordinator-only field cannot ride along.
 */
export function validateRegistrationSettings(body: unknown): ValidateRegistrationSettingsResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }
  const input = body as Record<string, unknown>;
  const errors: string[] = [];
  const unknown = Object.keys(input).filter(key => !isRegistrationSettingField(key));
  if (unknown.length > 0) {
    errors.push(`Only ${REGISTRATION_SETTING_FIELDS.join(', ')} can be changed here.`);
  }
  const values: RegistrationSettingValues = {};

  if ('registration_capacity' in input) {
    const capacity = input.registration_capacity;
    if (capacity === null) {
      values.registration_capacity = null;
    } else if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      errors.push(`registration_capacity must be a whole number from 1 to ${MAX_CAPACITY}.`);
    } else {
      values.registration_capacity = capacity;
    }
  }
  if ('waiting_list_response_hours' in input) {
    const hours = input.waiting_list_response_hours;
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > MAX_RESPONSE_HOURS) {
      errors.push(`waiting_list_response_hours must be a whole number of hours from 1 to ${MAX_RESPONSE_HOURS}.`);
    } else {
      values.waiting_list_response_hours = hours;
    }
  }
  for (const field of ['registration_opens_at', 'registration_closes_at'] as const) {
    if (field in input) {
      const parsed = parseTime(field, input[field], errors);
      if (parsed !== undefined) values[field] = parsed;
    }
  }
  if (errors.length === 0 && Object.keys(values).length === 0) {
    errors.push('Send at least one registration setting to change.');
  }
  return errors.length > 0 ? { valid: false, errors } : { valid: true, values };
}

/**
 * AC5/AC6: the change against what is stored and the clock. Each time is the
 * one being saved when the request changes it, otherwise the stored one.
 * - registration closes after it opens;
 * - a new closing time is in the future (closing now is its own action),
 *   which is also how registration is reopened or extended;
 * - registration opens and closes before the event starts, as SG2-39 had it.
 */
export function validateRegistrationSchedule(
  current: RegistrationSettings & { proposed_date: string | null },
  update: RegistrationSettingValues,
  now: number
): string[] {
  const errors: string[] = [];
  const timeOf = (field: 'registration_opens_at' | 'registration_closes_at') => {
    const value = update[field] !== undefined ? update[field] : current[field];
    return value ? Date.parse(value) : null;
  };
  const opens = timeOf('registration_opens_at');
  const closes = timeOf('registration_closes_at');
  const start = current.proposed_date ? Date.parse(current.proposed_date) : null;

  if (opens !== null && closes !== null && closes <= opens) {
    errors.push('Registration must close after it opens.');
  }
  if (update.registration_closes_at && closes !== null && closes <= now) {
    errors.push('A new closing time must be in the future. Use Close registration now to close it immediately.');
  }
  if (start !== null && opens !== null && opens >= start) {
    errors.push('Registration must open before the event starts.');
  }
  if (start !== null && closes !== null && closes >= start) {
    errors.push('Registration must close before the event starts.');
  }
  return errors;
}

export interface BookedVenue {
  venue_id: number;
  name: string;
  capacity: number | null;
}

/**
 * AC7: a capacity above a booked venue's capacity is allowed, with a warning
 * naming each venue it exceeds.
 */
export function capacityWarnings(capacity: number | null, venues: readonly BookedVenue[]): string[] {
  if (capacity === null) return [];
  return venues
    .filter(venue => venue.capacity !== null && capacity > venue.capacity)
    .map(venue => `A capacity of ${capacity} is more than ${venue.name} holds (${venue.capacity}).`);
}

/**
 * Capacity never drops below the registrations already held: no story says
 * who would lose their place (SG2-61 AC4 only raises it). Capacity is at
 * least 1, so this only arises with two or more registered.
 */
export function belowRegisteredMessage(registered: number): string {
  return `${registered} people are already registered, so the capacity cannot be lower than ${registered}.`;
}

/**
 * Once an event is confirmed its capacity and times stay set: clearing one
 * would end registration without the AC10 notice and undo what confirmation
 * needed (SG2-57). Closing early is the way to stop registration.
 */
export const CLEARED_ONCE_CONFIRMED_MESSAGE =
  'Capacity and opening and closing times cannot be cleared once the event is confirmed. Close registration early instead.';

export function clearedOnceConfirmed(status: string, values: RegistrationSettingValues): string[] {
  return status === 'confirmed' && REGISTRATION_SETTING_FIELDS.some(field => values[field] === null)
    ? [CLEARED_ONCE_CONFIRMED_MESSAGE] : [];
}

/** AC1: places left, never below zero; null when no capacity is set. */
export function placesRemaining(capacity: number | null, registered: number): number | null {
  return capacity === null ? null : Math.max(capacity - registered, 0);
}
