/** Venue requests for an event (SG2-48). Mirrors server/src/venues/bookingRequests.ts. */
import type { Layout } from './layoutsApi';
import { formatSgt } from './searchApi';
import type { BookingReadiness } from './suitabilityApi';

export interface VenueRequest {
  request_id: number;
  event_id: number;
  venue_id: number;
  venue_name: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  layout: Layout | null;
  venue_requirements: string | null;
  requester_name: string | null;
  requested_at: string;
  /** SG2-49: who decided, when, and why (always given for a rejection). */
  decider_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  /** SG2-82: who withdrew the request and when, once the event no longer
   * needed that venue. */
  withdrawer_name: string | null;
  withdrawn_at: string | null;
}

/** SG2-82 AC5: whether every venue the event still needs is approved.
 * Mirrors VenueArrangement in server/src/venues/bookingRequests.ts. */
export interface VenueArrangement {
  state: 'none' | 'in_progress' | 'ready';
  needed: number;
  approved: number;
  pending: number;
  rejected: number;
}

function isArrangement(value: unknown): value is VenueArrangement {
  const arrangement = value as VenueArrangement | null;
  return ['none', 'in_progress', 'ready'].includes(arrangement?.state as string)
    && [arrangement!.needed, arrangement!.approved, arrangement!.pending, arrangement!.rejected].every(count => typeof count === 'number');
}

/** Something already committing the venue that a request overlaps (SG2-50).
 * Mirrors server/src/db/venueConflicts.ts. The event is left out when it is
 * another coordinator's. */
export interface VenueConflict {
  kind: 'booking' | 'hold';
  reference_id: number;
  event_id: number | null;
  event_name: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
}

/** "Confirmed booking #12 for Gala Night, 15 Jun 2030, 10:00 – 15 Jun 2030, 18:00". */
export function describeConflict(conflict: VenueConflict): string {
  const what = conflict.kind === 'hold' ? `Tentative hold #${conflict.reference_id}`
    : `${conflict.status.charAt(0).toUpperCase()}${conflict.status.slice(1)} booking #${conflict.reference_id}`;
  const event = conflict.event_name ?? (conflict.event_id === null ? 'another event' : `event #${conflict.event_id}`);
  return `${what} for ${event}, ${formatSgt(conflict.starts_at)} – ${formatSgt(conflict.ends_at)}`;
}

function isConflict(value: unknown): value is VenueConflict {
  const conflict = value as VenueConflict | null;
  return typeof conflict?.reference_id === 'number' && typeof conflict.starts_at === 'string' && typeof conflict.ends_at === 'string';
}

export interface NewVenueRequest {
  event_id: number;
  venue_id: number;
  starts_at: string;
  ends_at: string;
  layout: Layout;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Body = Record<string, unknown> | null;

const UNAVAILABLE = 'Venue requests are unavailable right now. Please try again.';
const EXPIRED = 'Your session has expired. Sign in again.';

function isRequest(value: unknown): value is VenueRequest {
  const request = value as VenueRequest | null;
  return typeof request?.request_id === 'number' && typeof request.status === 'string';
}

/** Sends the request and maps refusals to what the person can do about them;
 * a 400 or 409 carries the server's own explanation. */
async function call<T>(url: string, token: string | null | undefined, read: (body: Body) => T | null, init: RequestInit = {}): Promise<Result<T>> {
  if (!token) return { ok: false, error: EXPIRED };
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (init.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { ...init, headers, cache: 'no-store' });
    if (response.status === 401) return { ok: false, error: EXPIRED };
    if (response.status === 403) return { ok: false, error: 'Your account cannot do this.' };
    if (response.status === 404) return { ok: false, error: 'This event, venue or request is no longer available to you.' };
    const body = await response.json().catch(() => null);
    if ((response.status === 400 || response.status === 409) && typeof body?.error === 'string') return { ok: false, error: body.error };
    const value = response.ok ? read(body) : null;
    return value === null ? { ok: false, error: UNAVAILABLE } : { ok: true, ...value };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

/** Requests a venue for an event (AC1). The request starts pending (AC3),
 * with anything it already overlaps at the venue (SG2-50 AC1). */
export function requestVenue(token: string | null | undefined, values: NewVenueRequest) {
  return call('/api/venue-booking-requests', token, body => {
    const conflicts = body?.conflicts ?? [];
    return isRequest(body?.request) && typeof body?.booking === 'string' && Array.isArray(conflicts) && conflicts.every(isConflict)
      ? { request: body.request, booking: body.booking as BookingReadiness, conflicts } : null;
  }, { method: 'POST', body: JSON.stringify(values) });
}

/** What a pending request overlaps at its venue (SG2-50 AC1). */
export function fetchRequestConflicts(token: string | null | undefined, requestId: number) {
  return call(`/api/venue-booking-requests/${requestId}/conflicts`, token, body => {
    const conflicts = body?.conflicts;
    return Array.isArray(conflicts) && conflicts.every(isConflict) ? { conflicts } : null;
  });
}

/** The event's venue requests and where each stands (AC3), with whether its
 * venue arrangement is ready (SG2-82 AC5). */
export function fetchVenueRequests(token: string | null | undefined, eventId: number) {
  return call(`/api/venue-booking-requests?event_id=${eventId}`, token, body => {
    const requests = body?.requests;
    return Array.isArray(requests) && requests.every(isRequest) && isArrangement(body?.arrangement)
      ? { requests, arrangement: body.arrangement } : null;
  });
}

/** SG2-82 AC5: the coordinator withdraws a pending or rejected request the
 * event no longer needs; the server answers with the request as recorded. */
export function withdrawVenueRequest(token: string | null | undefined, requestId: number) {
  return call(`/api/venue-booking-requests/${requestId}/withdraw`, token, body => isRequest(body?.request) ? { request: body.request } : null,
    { method: 'POST' });
}

/** SG2-49: Venue Staff approve or reject a request. A rejection needs a
 * reason (AC2); the server answers with the request as now recorded (AC3). */
export function decideVenueRequest(token: string | null | undefined, requestId: number, decision: 'approve' | 'reject', reason: string) {
  return call(`/api/venue-booking-requests/${requestId}/decision`, token, body => isRequest(body?.request) ? { request: body.request } : null,
    { method: 'POST', body: JSON.stringify({ decision, reason: reason.trim() || null }) });
}
