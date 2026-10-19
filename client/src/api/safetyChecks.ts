/**
 * SG2-92: the Safety Officer's operational safety check decision, the event's
 * decision history, and the coordinator's rework after a rejection.
 *
 * The list of events awaiting a check is a stand-in served by the server for
 * SG2-91 (the Safety Officer's queue) until that ships. The decision itself,
 * the history and the rework are real. Mirrors server/src/events/safetyDecisions.ts.
 */

export const SAFETY_DECISIONS = ['approve', 'reject', 'request_changes'] as const;
export type SafetyDecisionKind = typeof SAFETY_DECISIONS[number];

export const SAFETY_DECISION_LABELS: Readonly<Record<SafetyDecisionKind, string>> = {
  approve: 'Approve',
  reject: 'Reject',
  request_changes: 'Request changes',
};

/** How a recorded decision reads afterwards, matching the event history's wording. */
export const SAFETY_DECISION_OUTCOMES: Readonly<Record<SafetyDecisionKind, string>> = {
  approve: 'Approved',
  reject: 'Rejected',
  request_changes: 'Changes requested',
};

export const SAFETY_ARRANGEMENTS = ['venue', 'equipment', 'other'] as const;
export type SafetyArrangement = typeof SAFETY_ARRANGEMENTS[number];

export const SAFETY_ARRANGEMENT_LABELS: Readonly<Record<SafetyArrangement, string>> = {
  venue: 'Venue',
  equipment: 'Equipment and technical',
  other: 'Other',
};

/** Matches the server's limit on a decision's reason, counted in characters. */
export const MAX_SAFETY_REASON_LENGTH = 2000;

export interface SafetyCheckVenue {
  name: string;
  capacity: number | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface SafetyCheckEquipment {
  name: string;
  quantity: number;
  placement_position: string | null;
}

/** What the Safety Officer reviews for one event awaiting a check. */
export interface SafetyCheckEvent {
  event_id: number;
  name: string | null;
  proposed_date: string | null;
  expected_attendance: number | null;
  accessibility_needs: string | null;
  coordinator_name: string | null;
  venues: SafetyCheckVenue[];
  equipment: SafetyCheckEquipment[];
}

export interface SafetyCheckQueue {
  /** `stand-in` until SG2-91 replaces the queue source. */
  source: string;
  events: SafetyCheckEvent[];
}

export interface SafetyDecision {
  decision_id: number;
  event_id: number;
  decision: SafetyDecisionKind;
  reason: string | null;
  arrangements: SafetyArrangement[];
  decided_by: string;
  decided_by_name: string | null;
  decided_at: string;
}

export interface RecordedSafetyDecision {
  decision: SafetyDecision;
  status: string;
  previous_status: string;
}

export interface SafetyDecisionDraft {
  decision: SafetyDecisionKind;
  reason: string;
  arrangements: SafetyArrangement[];
}

export type SafetyCheckFailureKind =
  | 'validation'
  | 'conflict'
  | 'unauthorized'
  | 'not_found'
  | 'unavailable'
  | 'error';

export type SafetyCheckFailure = {
  ok: false;
  kind: SafetyCheckFailureKind;
  message: string;
  details?: string[];
  /** The event's current status, when the server refused because it moved on (409). */
  status?: string;
};

export type FetchSafetyCheckQueueResult = { ok: true; queue: SafetyCheckQueue } | SafetyCheckFailure;
export type RecordSafetyDecisionResult = { ok: true; recorded: RecordedSafetyDecision } | SafetyCheckFailure;
export type FetchSafetyDecisionsResult = { ok: true; decisions: SafetyDecision[] } | SafetyCheckFailure;
export type ReworkSafetyRejectedResult = { ok: true; status: string } | SafetyCheckFailure;

const UNAVAILABLE = 'Could not reach the server. Please try again.';

const KIND_BY_STATUS: Record<number, SafetyCheckFailureKind> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'unauthorized',
  404: 'not_found',
  409: 'conflict',
  503: 'unavailable',
};

const DEFAULT_MESSAGE: Partial<Record<SafetyCheckFailureKind, string>> = {
  unauthorized: 'You do not have access to this. Sign in again if your session has expired.',
  not_found: 'This event could not be found. Refresh and try again.',
  unavailable: UNAVAILABLE,
};

type Body = Record<string, unknown> | null;

const NETWORK_FAILURE: SafetyCheckFailure = { ok: false, kind: 'unavailable', message: UNAVAILABLE };

async function send(
  url: string,
  method: 'GET' | 'POST',
  token: string,
  payload?: Record<string, unknown>,
): Promise<{ response: Response; body: Body } | null> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (payload) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(url, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  } catch {
    return null;
  }
  const body: unknown = await response.json().catch(() => null);
  return { response, body: body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null };
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** Maps a non-2xx reply onto the shared failure shape; the server's own words win. */
function failure(status: number, body: Body, fallback: string): SafetyCheckFailure {
  const kind = KIND_BY_STATUS[status] ?? 'error';
  const result: SafetyCheckFailure = {
    ok: false,
    kind,
    message: typeof body?.error === 'string' ? body.error : DEFAULT_MESSAGE[kind] ?? `${fallback} (HTTP ${status}).`,
  };
  if (Array.isArray(body?.details)) result.details = body.details.filter(isText);
  if (typeof body?.status === 'string') result.status = body.status;
  return result;
}

/**
 * AC2 before anything is sent: Reject and Request changes need a reason, and
 * Request changes names at least one arrangement. The server repeats every
 * check; this only spares the Safety Officer a round trip.
 */
export function safetyDecisionProblems(draft: SafetyDecisionDraft): string[] {
  const problems: string[] = [];
  const reason = draft.reason.trim();
  // Counted in characters as the server does, so an emoji is one, not two.
  if (Array.from(reason).length > MAX_SAFETY_REASON_LENGTH) {
    problems.push(`Keep the reason to ${MAX_SAFETY_REASON_LENGTH} characters or fewer.`);
  } else if (draft.decision !== 'approve' && reason === '') {
    problems.push(`Give a reason to ${draft.decision === 'reject' ? 'reject this event' : 'request changes'}.`);
  }
  if (draft.decision === 'request_changes' && draft.arrangements.length === 0) {
    problems.push('Name at least one arrangement to change.');
  }
  return problems;
}

/** "Venue, Equipment and technical", in the order the decision named them. */
export function safetyArrangementList(arrangements: readonly SafetyArrangement[]): string {
  return arrangements.map((arrangement) => SAFETY_ARRANGEMENT_LABELS[arrangement]).join(', ');
}

/**
 * The events awaiting a safety check, with what the Safety Officer needs to
 * review them. Maps to `GET /api/safety-checks` (a stand-in for SG2-91).
 */
export async function fetchSafetyCheckQueue(token: string): Promise<FetchSafetyCheckQueueResult> {
  const reply = await send('/api/safety-checks', 'GET', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not load the safety checks');
  if (!body || !Array.isArray(body.events)) return NETWORK_FAILURE;
  return { ok: true, queue: body as unknown as SafetyCheckQueue };
}

/**
 * Records the Safety Officer's decision (AC1–AC6). The reason is trimmed and
 * left out when blank; arrangements are sent only with Request changes. Maps
 * to `POST /api/event-requests/:eventId/safety-decision`.
 */
export async function recordSafetyDecision(
  eventId: number | string,
  draft: SafetyDecisionDraft,
  token: string,
): Promise<RecordSafetyDecisionResult> {
  const reason = draft.reason.trim();
  const reply = await send(`/api/event-requests/${eventId}/safety-decision`, 'POST', token, {
    decision: draft.decision,
    ...(reason ? { reason } : {}),
    ...(draft.decision === 'request_changes' ? { arrangements: draft.arrangements } : {}),
  });
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not record the decision');
  if (!body || typeof body.status !== 'string' || typeof body.decision !== 'object' || body.decision === null) {
    return NETWORK_FAILURE;
  }
  return { ok: true, recorded: body as unknown as RecordedSafetyDecision };
}

/**
 * Every safety decision recorded for an event, newest first (AC6). Maps to
 * `GET /api/event-requests/:eventId/safety-decisions`.
 */
export async function fetchSafetyDecisions(eventId: number | string, token: string): Promise<FetchSafetyDecisionsResult> {
  const reply = await send(`/api/event-requests/${eventId}/safety-decisions`, 'GET', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not load the safety decisions');
  if (!body || !Array.isArray(body.decisions)) return NETWORK_FAILURE;
  return { ok: true, decisions: body.decisions as SafetyDecision[] };
}

/**
 * The assigned coordinator takes a Safety Rejected event back to Planning to
 * rework its arrangements (AC4). Maps to `POST /api/event-requests/:eventId/rework`.
 */
export async function reworkSafetyRejectedEvent(eventId: number | string, token: string): Promise<ReworkSafetyRejectedResult> {
  const reply = await send(`/api/event-requests/${eventId}/rework`, 'POST', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not rework the event');
  if (!body || typeof body.status !== 'string') return NETWORK_FAILURE;
  return { ok: true, status: body.status };
}
