/**
 * SG2-66: what a change to an event would break, accepting it, and settling
 * the rechecks it leaves outstanding.
 *
 * The change requests themselves are sample data served by the server as a
 * stand-in for SG2-64 (submitting a change request) and SG2-65 (deciding on
 * one) until those ship. The impact, acceptance and recheck settling are real.
 */

/** SG2-93 adds the arrangements a Safety Officer's Request changes left outstanding. */
export type RecheckKey =
  | 'venue_recheck'
  | 'equipment_recheck'
  | 'registration_recheck'
  | 'safety_venue_recheck'
  | 'safety_equipment_recheck'
  | 'safety_other_recheck';

/** AC1 revalidate, AC2 capacity_check, AC3 period_recheck. */
export type ImpactReasonCode = 'revalidate' | 'capacity_check' | 'period_recheck';

export type AffectedArrangementKind =
  | 'venue_booking'
  | 'venue_request'
  | 'equipment_reservation'
  | 'equipment_request'
  | 'registrations';

export interface ImpactReason {
  code: ImpactReasonCode;
  message: string;
}

export interface AffectedArrangement {
  kind: AffectedArrangementKind;
  id?: number | string | null;
  label: string;
  /** Present (nullable) for venue and equipment items; absent for registrations. */
  starts_at?: string | null;
  ends_at?: string | null;
  reasons: ImpactReason[];
}

export type ChangeValue = string | number | null;

export interface RequestedChange {
  field: string;
  label: string;
  from: ChangeValue;
  to: ChangeValue;
}

export interface ChangeRequest {
  id: string;
  requested_at: string;
  reason: string;
  status: string;
  changes: RequestedChange[];
  significant: boolean;
  impact: {
    requires_revalidation: boolean;
    outstanding_arrangements: RecheckKey[];
    arrangements: AffectedArrangement[];
  };
}

export interface ChangeRequestList {
  source: string;
  event: { event_id: number; status: string };
  can_accept: boolean;
  change_requests: ChangeRequest[];
}

export interface AcceptedChange {
  event_id: number;
  previous_status: string;
  status: string;
  returned_to_planning: boolean;
  arrangements_recheck_needed: boolean;
  outstanding_arrangements: RecheckKey[];
}

export interface SettledRecheck {
  event_id: number;
  arrangements_recheck_needed: boolean;
  outstanding_arrangements: RecheckKey[];
}

export type ChangeRequestFailureKind =
  | 'validation'
  | 'conflict'
  | 'unauthorized'
  | 'not_found'
  | 'unavailable'
  | 'error';

export type ChangeRequestFailure = {
  ok: false;
  kind: ChangeRequestFailureKind;
  message: string;
  details?: string[];
};

export type FetchChangeRequestsResult = { ok: true; list: ChangeRequestList } | ChangeRequestFailure;

export type AcceptChangeRequestResult = { ok: true; change: AcceptedChange } | ChangeRequestFailure;

export type SettleRecheckResult =
  | { ok: true; settled: SettledRecheck }
  | { ok: false; kind: 'blocked'; message: string; blockers: string[] }
  | ChangeRequestFailure;

const UNAVAILABLE = 'Could not reach the server. Please try again.';

const KIND_BY_STATUS: Record<number, ChangeRequestFailureKind> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'unauthorized',
  404: 'not_found',
  409: 'conflict',
  503: 'unavailable',
};

const DEFAULT_MESSAGE: Partial<Record<ChangeRequestFailureKind, string>> = {
  unauthorized: 'Only the assigned Event Coordinator can do this. Sign in again if your session has expired.',
  not_found: 'This event or change request could not be found. Refresh and try again.',
  unavailable: UNAVAILABLE,
};

type Body = Record<string, unknown> | null;

const NETWORK_FAILURE: ChangeRequestFailure = { ok: false, kind: 'unavailable', message: UNAVAILABLE };

async function send(url: string, method: 'GET' | 'POST', token: string): Promise<{ response: Response; body: Body } | null> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return null;
  }
  const body: unknown = await response.json().catch(() => null);
  return { response, body: body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null };
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** Maps a non-2xx reply onto the shared failure shape; the server's own words win. */
function failure(status: number, body: Body, fallback: string): ChangeRequestFailure {
  const kind = KIND_BY_STATUS[status] ?? 'error';
  const message = typeof body?.error === 'string'
    ? body.error
    : DEFAULT_MESSAGE[kind] ?? `${fallback} (HTTP ${status}).`;
  const details = Array.isArray(body?.details) ? body.details.filter(isText) : undefined;
  return details ? { ok: false, kind, message, details } : { ok: false, kind, message };
}

/**
 * Lists the change requests waiting on the assigned coordinator, each with
 * its impact on the event's arrangements (SG2-66 AC1–AC3). Maps to
 * `GET /api/event-requests/:eventId/change-requests`.
 */
export async function fetchChangeRequests(eventId: number | string, token: string): Promise<FetchChangeRequestsResult> {
  const reply = await send(`/api/event-requests/${eventId}/change-requests`, 'GET', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not load change requests');
  if (!body || !Array.isArray(body.change_requests)) return NETWORK_FAILURE;
  return { ok: true, list: body as unknown as ChangeRequestList };
}

/**
 * Accepts one change request (SG2-66 AC4). The server recomputes the impact
 * from fresh facts and decides whether the event returns to Planning. Maps to
 * `POST /api/event-requests/:eventId/change-requests/:changeRequestId/accept`.
 */
export async function acceptChangeRequest(
  eventId: number | string,
  changeRequestId: string,
  token: string,
): Promise<AcceptChangeRequestResult> {
  const reply = await send(
    `/api/event-requests/${eventId}/change-requests/${encodeURIComponent(changeRequestId)}/accept`,
    'POST',
    token,
  );
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) return failure(response.status, body, 'Could not accept the change');
  if (!body || typeof body.status !== 'string') return NETWORK_FAILURE;
  return { ok: true, change: body as unknown as AcceptedChange };
}

/**
 * Marks one outstanding arrangement recheck as settled (SG2-66 AC4). A 409
 * with `blockers` lists what still needs attention first. Maps to
 * `POST /api/event-requests/:eventId/rechecks/:key/settle`.
 */
export async function settleRecheck(eventId: number | string, key: RecheckKey, token: string): Promise<SettleRecheckResult> {
  const reply = await send(`/api/event-requests/${eventId}/rechecks/${encodeURIComponent(key)}/settle`, 'POST', token);
  if (!reply) return NETWORK_FAILURE;
  const { response, body } = reply;
  if (!response.ok) {
    const result = failure(response.status, body, 'Could not mark the arrangement rechecked');
    return response.status === 409 && Array.isArray(body?.blockers)
      ? { ok: false, kind: 'blocked', message: result.message, blockers: body.blockers.filter(isText) }
      : result;
  }
  if (!body || !Array.isArray(body.outstanding_arrangements)) return NETWORK_FAILURE;
  return { ok: true, settled: body as unknown as SettledRecheck };
}
