/** Mandatory-field validation for submitting an event request (SG2-30). */

export interface EventRequestFields {
  eventName?: string;
  purpose?: string;
  description?: string;
  proposedDateTime?: string;
  expectedAttendance?: number;
  venueRequirements?: string;
  equipmentRequirements?: string;
  registrationNeeded?: boolean;
  /** Optional per SG2-28/29 — never part of mandatory-field validation. */
  accessibilityNeeds?: string | null;
}

interface MandatoryFieldSpec {
  label: string;
  isMissing: (fields: EventRequestFields) => boolean;
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

export const MANDATORY_EVENT_REQUEST_FIELDS: readonly MandatoryFieldSpec[] = [
  { label: 'Event name', isMissing: (f) => isBlank(f.eventName) },
  { label: 'Purpose', isMissing: (f) => isBlank(f.purpose) },
  { label: 'Description', isMissing: (f) => isBlank(f.description) },
  {
    label: 'Proposed date and time',
    isMissing: (f) => isBlank(f.proposedDateTime) || Number.isNaN(Date.parse(f.proposedDateTime as string))
  },
  {
    label: 'Expected attendance',
    isMissing: (f) =>
      typeof f.expectedAttendance !== 'number' ||
      !Number.isInteger(f.expectedAttendance) ||
      f.expectedAttendance <= 0
  },
  { label: 'Venue requirements', isMissing: (f) => isBlank(f.venueRequirements) },
  { label: 'Equipment requirements', isMissing: (f) => isBlank(f.equipmentRequirements) },
  {
    label: 'Whether registration is needed',
    isMissing: (f) => typeof f.registrationNeeded !== 'boolean'
  }
];

export type SubmissionValidationResult = { ok: true } | { ok: false; missingFields: string[] };

/**
 * Checks the mandatory fields from SG2-28/29 (everything except the optional
 * accessibility needs). Returns every missing field, not just the first, so
 * callers can list them all (SG2-30 AC2).
 */
export function validateEventRequestForSubmission(fields: EventRequestFields): SubmissionValidationResult {
  const missingFields = MANDATORY_EVENT_REQUEST_FIELDS.filter((spec) => spec.isMissing(fields)).map(
    (spec) => spec.label
  );
  return missingFields.length === 0 ? { ok: true } : { ok: false, missingFields };
}
