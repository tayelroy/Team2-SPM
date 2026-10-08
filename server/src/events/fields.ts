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
 */

/** Columns a client may supply. Anything else is ignored (no mass assignment). */
export const DRAFT_FIELDS = [
  'name',
  'purpose',
  'description',
  'proposed_date',
  'expected_attendance',
  'venue_requirements',
  'accessibility_needs',
  'equipment_requirements',
  'registration_needed'
] as const;

export type DraftField = (typeof DRAFT_FIELDS)[number];

/**
 * Fields that must be present before a request can be submitted for review.
 *
 * ⚠️ SHARED CONTRACT WITH SG2-30 — agree any change with that ticket's owner
 * rather than diverging. `accessibility_needs` is deliberately absent: SG2-28
 * states it is optional and may be left blank.
 */
export const SUBMISSION_REQUIRED_FIELDS: readonly DraftField[] = [
  'name',
  'purpose',
  'description',
  'proposed_date',
  'expected_attendance',
  'venue_requirements'
];

export interface DraftValues {
  name: string | null;
  purpose: string | null;
  description: string | null;
  proposed_date: string | null;
  expected_attendance: number | null;
  venue_requirements: string | null;
  accessibility_needs: string | null;
  equipment_requirements: string | null;
  registration_needed: boolean | null;
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
  | 'accessibility_needs'
  | 'equipment_requirements';

const TEXT_FIELDS: TextField[] = [
  'name',
  'purpose',
  'description',
  'venue_requirements',
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

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, values };
}

/**
 * Lists the submission-required fields still blank on a draft, so the client
 * can show what is outstanding without blocking the save (SG2-28: "fields
 * required for submission are identified").
 */
export function missingForSubmission(values: Partial<DraftValues>): DraftField[] {
  return SUBMISSION_REQUIRED_FIELDS.filter((field) => {
    const value = values[field];
    return value === undefined || value === null || value === '';
  });
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

/**
 * Legal status transitions for the Week 7 event lifecycle (SG2-100).
 *
 * Single source of truth so later stories (Units 2-5, SG2-91/92/93/94) read
 * one table instead of scattering `.in('status', [...])` literals. `completed`
 * and `cancelled` are terminal — their entries are empty, which is what makes
 * `canTransition('completed', x)` false for every status (AC4's read-only
 * guarantee for a completed event).
 */
export const STATUS_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  draft: ['unassigned', 'cancelled'],
  unassigned: ['submitted'],
  submitted: ['under_review'],
  under_review: ['needs_clarification', 'rejected', 'approved'],
  needs_clarification: ['unassigned'],
  rejected: ['unassigned'],
  approved: ['planning'],
  planning: ['awaiting_safety_check', 'cancelled'],
  awaiting_safety_check: ['preparation', 'safety_rejected', 'planning', 'cancelled'],
  safety_rejected: ['cancelled'],
  preparation: ['confirmed', 'completed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: []
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}

