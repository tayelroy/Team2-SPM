/**
 * Field rules for event requests (SG2-28 create draft, SG2-29 keep draft).
 *
 * A draft deliberately accepts incomplete data: SG2-28's acceptance criteria
 * say leaving submission-required fields blank must NOT prevent creating a
 * draft. So validation here rejects only *malformed* values (wrong type, bad
 * date, nonsensical attendance) — never merely missing ones.
 *
 * Completeness is a separate question, answered by SUBMISSION_REQUIRED_FIELDS
 * and missingForSubmission(). Those are the shared contract with SG2-30
 * (submit an event request), which enforces completeness at submission time.
 * SG2-105 widened that list to the customer's full minimum. SG2-70's
 * category is a draft field but not required for submission.
 */

/**
 * SG2-70 AC2: what kind of event this is, so internal users can filter by it.
 * Mirrors the events_category_known check in
 * supabase/migrations/202610200005_event_search.sql; the two must change
 * together.
 */
export const EVENT_CATEGORIES = [
  'conference',
  'workshop',
  'seminar',
  'training',
  'networking',
  'social',
  'other'
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function isEventCategory(value: unknown): value is EventCategory {
  return typeof value === 'string' && (EVENT_CATEGORIES as readonly string[]).includes(value);
}

/** Columns a client may supply. Anything else is ignored (no mass assignment). */
export const DRAFT_FIELDS = [
  'name',
  'purpose',
  'description',
  'proposed_date',
  'expected_attendance',
  'venue_requirements',
  // SG2-105: the room arrangement the organiser wants (theatre, banquet, ...).
  'preferred_layout',
  'accessibility_needs',
  'equipment_requirements',
  'registration_needed',
  // SG2-70: one of EVENT_CATEGORIES.
  'category'
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

/**
 * Fields that must be present before a request can be submitted for review.
 *
 * ⚠️ SHARED CONTRACT WITH SG2-30 — agree any change with that ticket's owner
 * rather than diverging. SG2-105 makes this the customer's minimum from
 * clarification session 2, which replaces SG2-28 AC2: accessibility needs
 * and equipment requirements may be answered "None" but not left blank, and
 * `registration_needed` must be answered either way (false is an answer).
 * Only submission checks this list, so requests already submitted are not
 * affected and drafts still save incomplete. SG2-70's `category` is optional
 * and deliberately absent.
 */
export const SUBMISSION_REQUIRED_FIELDS: readonly DraftField[] = [
  'name',
  'purpose',
  'description',
  'proposed_date',
  'expected_attendance',
  'venue_requirements',
  'preferred_layout',
  'accessibility_needs',
  'equipment_requirements',
  'registration_needed'
];

export interface DraftValues {
  name: string | null;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  expected_attendance: number | null;
  venue_requirements: string | null;
  preferred_layout: string | null;
  accessibility_needs: string | null;
  equipment_requirements: string | null;
  registration_needed: boolean | null;
  category: EventCategory | null;
}

export type DraftValidation =
  | { valid: true; values: DraftValues }
  | { valid: false; errors: string[] };

/**
 * Narrower than DraftField on purpose: indexing DraftValues with the full
 * union would widen the assignment target to the intersection of every
 * field's type, so the text fields need their own key type.
 */
type TextField =
  | 'name'
  | 'purpose'
  | 'description'
  | 'venue_requirements'
  | 'preferred_layout'
  | 'accessibility_needs'
  | 'equipment_requirements';

const TEXT_FIELDS: TextField[] = [
  'name',
  'purpose',
  'description',
  'venue_requirements',
  'preferred_layout',
  'accessibility_needs',
  'equipment_requirements'
];

/** Match event.name VARCHAR(255) and event.expected_attendance INTEGER. */
const MAX_EVENT_NAME_LENGTH = 255;
const MAX_ATTENDANCE = 2_147_483_647;
/** Other free-text fields retain their existing input limit. */
const MAX_TEXT_LENGTH = 5000;

function readText(value: unknown, field: string, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.push(`${field} must be text.`);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const maxLength = field === 'name' ? MAX_EVENT_NAME_LENGTH : MAX_TEXT_LENGTH;
  // PostgreSQL VARCHAR counts Unicode code points, not UTF-16 code units.
  const length = field === 'name' ? Array.from(trimmed).length : trimmed.length;
  if (length > maxLength) {
    errors.push(`${field} must be ${maxLength} characters or fewer.`);
    return null;
  }
  return trimmed;
}

function readAttendance(value: unknown, errors: string[]): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    errors.push('expected_attendance must be a whole number.');
    return null;
  }
  if (value < 1) {
    errors.push('expected_attendance must be at least 1.');
    return null;
  }
  if (value > MAX_ATTENDANCE) {
    errors.push(`expected_attendance must be at most ${MAX_ATTENDANCE}.`);
    return null;
  }
  return value;
}

function readProposedDate(value: unknown, errors: string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push('proposed_date must be an ISO 8601 date-time string.');
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    errors.push('proposed_date must be a valid date and time.');
    return null;
  }
  return parsed.toISOString();
}

function readRegistrationNeeded(value: unknown, errors: string[]): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    errors.push('registration_needed must be true or false.');
    return null;
  }
  return value;
}

function readCategory(value: unknown, errors: string[]): EventCategory | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isEventCategory(value)) {
    errors.push(`category must be one of: ${EVENT_CATEGORIES.join(', ')}.`);
    return null;
  }
  return value;
}

/**
 * Validates a draft payload. Missing fields are always allowed; malformed ones
 * are rejected with a message naming the field and what was expected.
 */
export function validateDraftInput(body: unknown): DraftValidation {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: ['Request body must be a JSON object.'] };
  }

  const input = body as Record<string, unknown>;
  const errors: string[] = [];
  const values = {} as DraftValues;

  for (const field of TEXT_FIELDS) {
    values[field] = readText(input[field], field, errors);
  }
  values.expected_attendance = readAttendance(input.expected_attendance, errors);
  values.proposed_date = readProposedDate(input.proposed_date, errors);
  values.registration_needed = readRegistrationNeeded(input.registration_needed, errors);
  values.category = readCategory(input.category, errors);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, values };
}

/**
 * Outstanding item reported when the proposed date is set but no longer in
 * the future (SG2-30 AC2). It sits in the same list as blank field names, so
 * a draft with a past date still saves but is flagged as not ready, and
 * submission refuses it the same way it refuses a blank field.
 */
export const PROPOSED_DATE_IN_PAST = 'proposed_date_in_past';

/** Shared with planning edits (SG2-39), which refuse a newly chosen past date. */
export const PROPOSED_DATE_IN_FUTURE_MESSAGE = 'proposed_date must be in the future.';

export type OutstandingItem = DraftField | typeof PROPOSED_DATE_IN_PAST;

/**
 * Lists what still stops a draft being submitted: the submission-required
 * fields still blank, then PROPOSED_DATE_IN_PAST if the date is not after
 * `now`. Shown to the client without blocking the save (SG2-28: "fields
 * required for submission are identified") and enforced by submission.
 */
export function missingForSubmission(values: Partial<DraftValues>, now: number): OutstandingItem[] {
  const outstanding: OutstandingItem[] = SUBMISSION_REQUIRED_FIELDS.filter((field) => {
    const value = values[field];
    return value === undefined || value === null || value === '';
  });
  if (values.proposed_date && new Date(values.proposed_date).getTime() <= now) {
    outstanding.push(PROPOSED_DATE_IN_PAST);
  }
  return outstanding;
}

/** Allowed event request statuses in the Supabase public.event_status enum. */
export const EVENT_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'planning',
  'confirmed',
  'completed',
  'cancelled',
  'rejected',
  // SG2-36: returned to the organiser with a question; still live.
  'needs_clarification',
  // SG2-100: assignment-queue status — submitted but not yet assigned a coordinator.
  'unassigned',
  // SG2-100: arrangements complete, waiting on the Safety Officer (writer lands in SG2-91/92).
  'awaiting_safety_check',
  // SG2-100: the Safety Officer did not pass the check (writer lands in SG2-92).
  'safety_rejected',
  // SG2-100: safety approved, coordinator finalising ahead of confirmation.
  'preparation'
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export function isEventStatus(value: unknown): value is EventStatus {
  return typeof value === 'string' && (EVENT_STATUSES as readonly string[]).includes(value);
}
