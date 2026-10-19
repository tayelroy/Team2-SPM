/**
 * SG2-92: the Safety Officer's operational safety check decision. This file
 * owns the vocabulary; the SQL in 202610190005_safety_decisions.sql and
 * 202610190006_safety_decision_revision.sql mirrors it (decisions,
 * arrangements, labels, reason limit) and they must change together.
 */

/** AC1: the three outcomes of a safety check. */
export const SAFETY_DECISIONS = ['approve', 'reject', 'request_changes'] as const;
export type SafetyDecisionKind = typeof SAFETY_DECISIONS[number];

/** AC2: the arrangements a Request Changes decision names. */
export const SAFETY_ARRANGEMENTS = ['venue', 'equipment', 'other'] as const;
export type SafetyArrangement = typeof SAFETY_ARRANGEMENTS[number];

export const SAFETY_ARRANGEMENT_LABELS: Readonly<Record<SafetyArrangement, string>> = {
  venue: 'Venue',
  equipment: 'Equipment and technical',
  other: 'Other'
};

/**
 * Where each decision leaves the event: Approve moves it on to Preparation
 * (AC3), Reject stops it as Safety Rejected (AC4), and Request Changes sends
 * it back to Planning for the named arrangements (SG2-93 brings it back).
 */
export const SAFETY_DECISION_NEXT_STATUS: Readonly<
  Record<SafetyDecisionKind, 'preparation' | 'safety_rejected' | 'planning'>
> = {
  approve: 'preparation',
  reject: 'safety_rejected',
  request_changes: 'planning'
};

/** Matches the `event_safety_decisions.reason` check constraint. */
export const MAX_SAFETY_REASON_LENGTH = 2000;

export function isSafetyDecision(value: unknown): value is SafetyDecisionKind {
  return typeof value === 'string' && (SAFETY_DECISIONS as readonly string[]).includes(value);
}

export function isSafetyArrangement(value: unknown): value is SafetyArrangement {
  return typeof value === 'string' && (SAFETY_ARRANGEMENTS as readonly string[]).includes(value);
}

export interface SafetyDecisionInput {
  decision: SafetyDecisionKind;
  /** Trimmed; null when none was given (Approve only). */
  reason: string | null;
  /** Non-empty for Request Changes, empty otherwise. */
  arrangements: SafetyArrangement[];
  /**
   * The `safety_check_revision` SG2-91's list showed with the event. The
   * decision is refused if the event has changed since (a stale review).
   */
  expectedRevision: number;
}

export type ValidateSafetyDecisionResult =
  | { valid: true; value: SafetyDecisionInput }
  | { valid: false; errors: string[] };

/**
 * AC2: Reject and Request Changes need a reason; Request Changes also names
 * the arrangements to change. Approve may carry an optional note and never
 * arrangements. Every decision carries the revision of the review it was made
 * on. The database function repeats these checks.
 */
export function validateSafetyDecision(body: unknown): ValidateSafetyDecisionResult {
  const input = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors: string[] = [];

  const decision = input.decision;
  if (!isSafetyDecision(decision)) {
    return { valid: false, errors: [`decision must be one of ${SAFETY_DECISIONS.join(', ')}.`] };
  }

  let reason: string | null = null;
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== 'string') {
      errors.push('reason must be text.');
    } else {
      reason = input.reason.trim() || null;
      if (reason !== null && Array.from(reason).length > MAX_SAFETY_REASON_LENGTH) {
        errors.push(`reason must be at most ${MAX_SAFETY_REASON_LENGTH} characters.`);
      }
    }
  }
  if (decision !== 'approve' && reason === null && errors.length === 0) {
    errors.push(`A reason is required to ${decision === 'reject' ? 'reject' : 'request changes'}.`);
  }

  const raw = input.arrangements;
  const arrangements: SafetyArrangement[] = [];
  if (decision === 'request_changes') {
    if (!Array.isArray(raw) || raw.length === 0) {
      errors.push('Name at least one arrangement to change.');
    } else if (!raw.every(isSafetyArrangement)) {
      errors.push(`arrangements must be drawn from ${SAFETY_ARRANGEMENTS.join(', ')}.`);
    } else if (new Set(raw).size !== raw.length) {
      errors.push('Each arrangement may be named only once.');
    } else {
      arrangements.push(...raw);
    }
  } else if (raw !== undefined && raw !== null && !(Array.isArray(raw) && raw.length === 0)) {
    errors.push('Arrangements are named only when requesting changes.');
  }

  // Bounded like events.safety_check_revision (0 to Number.MAX_SAFE_INTEGER).
  const revision = input.safety_check_revision;
  const expectedRevision = typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
  if (expectedRevision === null) {
    errors.push('safety_check_revision must be the whole-number revision shown with the event.');
  }

  return errors.length > 0 || expectedRevision === null
    ? { valid: false, errors }
    : { valid: true, value: { decision, reason, arrangements, expectedRevision } };
}

/** "Venue, Equipment and technical", in the order the decision named them. */
export function safetyArrangementList(arrangements: readonly SafetyArrangement[]): string {
  return arrangements.map(arrangement => SAFETY_ARRANGEMENT_LABELS[arrangement]).join(', ');
}
