/**
 * SG2-91: the Safety Officer's list of events awaiting a safety check.
 * SG2-92: the decision on each, the event's decision history, and the
 * coordinator's rework after a rejection. Mirrors server/src/events/safetyDecisions.ts.
 * SG2-93: the venue bookings and equipment a Request changes sent back to
 * Venue Staff and Technical Support. Mirrors server/src/events/safetyRereviewRoutes.ts.
 */

/** A venue an event awaiting its safety check is booked into (SG2-91 AC3). */
export interface SafetyCheckVenue {
  requestId: number;
  name: string;
  location: string | null;
  capacity: number | null;
  layout: string | null;
  startsAt: string | null;
  endsAt: string | null;
  accessibilityFeatures: string | null;
  emergencyAccess: string | null;
  knownRestrictions: string | null;
}

/** A piece of equipment and where it will be placed (SG2-91 AC3). */
export interface SafetyCheckEquipment {
  requestId: number;
  name: string;
  quantity: number;
  placementVenue: string | null;
  placementPosition: string | null;
  arrangementNotes: string | null;
}

/** One event on the Safety Officer's list (SG2-91 AC2/AC3). */
export interface SafetyCheckEvent {
  eventId: number;
  /** Sent back with SG2-92's decision so a review of since-changed details is refused. */
  revision: number;
  name: string;
  organisation: string | null;
  proposedDate: string | null;
  awaitingSince: string | null;
  expectedAttendance: number | null;
  accessibilityNeeds: string | null;
  expectedCrowdMovement: string | null;
  venues: SafetyCheckVenue[];
  equipment: SafetyCheckEquipment[];
}

export type FetchSafetyChecksResult =
  | { ok: true; events: SafetyCheckEvent[] }
  | { ok: false; kind: 'unauthorized' | 'unavailable' };

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const count = (value: unknown) => (typeof value === 'number' ? value : null);
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value as Raw[] : []);

/** GET /api/safety-checks — Safety Officers only (SG2-91 AC4). */
export async function fetchSafetyChecks(token: string): Promise<FetchSafetyChecksResult> {
  let response: Response;
  try {
    response = await fetch('/api/safety-checks', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  if (!response.ok) return { ok: false, kind: 'unavailable' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  if (!Array.isArray(data.events)) return { ok: false, kind: 'unavailable' };
  return {
    ok: true,
    events: (data.events as Raw[]).map((raw) => ({
      eventId: Number(raw.event_id) || 0,
      revision: Number(raw.safety_check_revision) || 0,
      name: text(raw.name) ?? '',
      organisation: text(raw.organisation),
      proposedDate: text(raw.proposed_date),
      awaitingSince: text(raw.awaiting_since),
      expectedAttendance: count(raw.expected_attendance),
      accessibilityNeeds: text(raw.accessibility_needs),
      expectedCrowdMovement: text(raw.expected_crowd_movement),
      venues: list(raw.venues).map((venue) => ({
        requestId: Number(venue.request_id) || 0,
        name: text(venue.venue_name) ?? '',
        location: text(venue.location),
        capacity: count(venue.capacity),
        layout: text(venue.layout),
        startsAt: text(venue.starts_at),
        endsAt: text(venue.ends_at),
        accessibilityFeatures: text(venue.accessibility_features),
        emergencyAccess: text(venue.emergency_access),
        knownRestrictions: text(venue.known_restrictions),
      })),
      equipment: list(raw.equipment).map((item) => ({
        requestId: Number(item.request_id) || 0,
        name: text(item.equipment_name) ?? '',
        quantity: Number(item.quantity) || 0,
        placementVenue: text(item.placement_venue_name),
        placementPosition: text(item.placement_position),
        arrangementNotes: text(item.arrangement_notes),
      })),
    })),
  };
}

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
  | 'stale'
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

/** Which staff confirm a flagged arrangement again (SG2-93 AC2). */
export type SafetyRereviewArrangement = 'venue' | 'equipment';

/** One venue booking or equipment request a Request changes sent back to staff (SG2-93 AC2/AC5). */
export interface SafetyRereview {
  review_id: number;
  decision_id: number;
  arrangement: SafetyRereviewArrangement;
  /** e.g. 'Regression Hall (10 Jul 2030 10:00 – 14:00 SGT)' or '4 × Wireless microphones'. */
  label: string;
  flagged_at: string;
  resolution: 'confirmed' | 'withdrawn' | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
}

/** An open flag on the acting staff member's list (SG2-93 AC2). */
export interface SafetyRereviewQueueItem {
  review_id: number;
  arrangement: SafetyRereviewArrangement;
  event_id: number;
  event_name: string | null;
  proposed_date: string | null;
  coordinator_name: string | null;
  flagged_at: string;
  label: string;
  reason: string | null;
  decided_by_name: string | null;
  layout: string | null;
  placement_venue_name: string | null;
  placement_position: string | null;
}

export interface ConfirmedSafetyRereview {
  review_id: number;
  event_id: number;
  /** The event's status afterwards: 'awaiting_safety_check' once nothing is outstanding (AC4). */
  status: string;
  outstanding_arrangements: string[];
}

export type RecordSafetyDecisionResult = { ok: true; recorded: RecordedSafetyDecision } | SafetyCheckFailure;
export type FetchSafetyDecisionsResult =
  | { ok: true; decisions: SafetyDecision[]; rereviews: SafetyRereview[] }
  | SafetyCheckFailure;
export type ReworkSafetyRejectedResult = { ok: true; status: string } | SafetyCheckFailure;
export type FetchSafetyRereviewsResult =
  | { ok: true; arrangement: SafetyRereviewArrangement; rereviews: SafetyRereviewQueueItem[] }
  | SafetyCheckFailure;
export type ConfirmSafetyRereviewResult = { ok: true; confirmed: ConfirmedSafetyRereview } | SafetyCheckFailure;

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
  // A 409 whose code is `stale` means the event changed after it was opened,
  // not that its check closed; the Safety Officer reviews it again.
  const kind = status === 409 && body?.code === 'stale' ? 'stale' : KIND_BY_STATUS[status] ?? 'error';
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
 * Records the Safety Officer's decision (AC1–AC6) on the revision of the event
 * they reviewed, as SG2-91's list showed it. The reason is trimmed and left out
 * when blank; arrangements are sent only with Request changes. Maps to
 * `POST /api/event-requests/:eventId/safety-decision`.
 */
export async function recordSafetyDecision(
  eventId: number | string,
  draft: SafetyDecisionDraft,
  revision: number,
  token: string,
): Promise<RecordSafetyDecisionResult> {
  const reason = draft.reason.trim();
  const reply = await send(`/api/event-requests/${eventId}/safety-decision`, 'POST', token, {
    decision: draft.decision,
    safety_check_revision: revision,
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
 * Every safety decision recorded for an event, newest first (SG2-92 AC6), and
 * the venue bookings and equipment each Request changes sent back to staff,
 * newest first (SG2-93 AC5). Maps to `GET /api/event-requests/:eventId/safety-decisions`.
 */
export async function fetchSafetyDecisions(eventId: number | string, token: string): Promise<FetchSafetyDecisionsResult> {
  const reply = await send(`/api/event-requests/${eventId}/safety-decisions`, 'GET', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not load the safety decisions');
  if (!body || !Array.isArray(body.decisions) || !Array.isArray(body.rereviews)) return NETWORK_FAILURE;
  return { ok: true, decisions: body.decisions as SafetyDecision[], rereviews: body.rereviews as SafetyRereview[] };
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

/**
 * The open flags Venue Staff (venue bookings) or Technical Support (equipment)
 * must confirm again after a Request changes (SG2-93 AC2). Maps to `GET /api/safety-rereviews`.
 */
export async function fetchSafetyRereviews(token: string): Promise<FetchSafetyRereviewsResult> {
  const reply = await send('/api/safety-rereviews', 'GET', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not load the safety changes to confirm');
  if (!body || (body.arrangement !== 'venue' && body.arrangement !== 'equipment') || !Array.isArray(body.rereviews)) {
    return NETWORK_FAILURE;
  }
  return { ok: true, arrangement: body.arrangement, rereviews: body.rereviews as SafetyRereviewQueueItem[] };
}

/**
 * Staff confirm a flagged booking or equipment request again (SG2-93 AC2/AC4);
 * the last one returns the event to Awaiting Safety Check. Maps to
 * `POST /api/safety-rereviews/:reviewId/confirm`.
 */
export async function confirmSafetyRereview(reviewId: number, token: string): Promise<ConfirmSafetyRereviewResult> {
  const reply = await send(`/api/safety-rereviews/${reviewId}/confirm`, 'POST', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not confirm the change');
  if (!body || typeof body.status !== 'string') return NETWORK_FAILURE;
  return { ok: true, confirmed: body as unknown as ConfirmedSafetyRereview };
}
