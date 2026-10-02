/** How a venue fits an event (SG2-47). Mirrors server/src/venues/suitability.ts. */
export interface SuitabilityIssue {
  kind: 'capacity' | 'facility' | 'accessibility';
  message: string;
}

export interface Suitability {
  suitable: boolean;
  issues: SuitabilityIssue[];
}

export interface VenueFit {
  venue_id: number;
  name: string;
  location: string | null;
  capacity: number | null;
  suitability: Suitability;
}

export type BookingReadiness = 'allowed' | 'needs_capacity_exception' | 'blocked';

export interface CapacityException {
  exception_id: number;
  approver_name: string | null;
  approver_role: string;
  expected_attendance: number;
  approved_at: string;
}

export interface RequestFit {
  venue: VenueFit;
  exceptions: CapacityException[];
  booking: BookingReadiness;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };
type Body = Record<string, unknown> | null;

const UNAVAILABLE = 'Venue suitability is unavailable right now. Please try again.';

function isFit(value: unknown): value is VenueFit {
  const fit = value as VenueFit | null;
  return typeof fit?.venue_id === 'number' && Array.isArray(fit.suitability?.issues);
}

/** Sends the request and maps refusals to what the person can do about them;
 * a 409 carries the server's own explanation. */
async function call<T>(url: string, token: string | null | undefined, read: (body: Body) => T | null, init: RequestInit = {}): Promise<Result<T>> {
  if (!token) return { ok: false, error: 'Your session has expired. Sign in again.' };
  try {
    const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 401) return { ok: false, error: 'Your session has expired. Sign in again.' };
    if (response.status === 403) return { ok: false, error: 'Your account cannot do this.' };
    if (response.status === 404) return { ok: false, error: 'This event or booking request is no longer available to you.' };
    const body = await response.json().catch(() => null);
    if (response.status === 409 && typeof body?.error === 'string') return { ok: false, error: body.error };
    const value = response.ok ? read(body) : null;
    return value === null ? { ok: false, error: UNAVAILABLE } : { ok: true, ...value };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

/** Every venue against an event: GET /api/venues/suitability?event_id= */
export function fetchEventFit(token: string | null | undefined, eventId: number) {
  return call(`/api/venues/suitability?event_id=${eventId}`, token, body => {
    const venues = body?.venues;
    return Array.isArray(venues) && venues.every(isFit) ? { venues } : null;
  });
}

function readRequestFit(body: Body): RequestFit | null {
  if (!body || !isFit(body.venue) || !Array.isArray(body.exceptions) || typeof body.booking !== 'string') return null;
  return { venue: body.venue, exceptions: body.exceptions as CapacityException[], booking: body.booking as BookingReadiness };
}

/** The requested venue against its event: GET /api/venue-booking-requests/:id/suitability */
export function fetchRequestFit(token: string | null | undefined, requestId: number) {
  return call(`/api/venue-booking-requests/${requestId}/suitability`, token, readRequestFit);
}

/** Approves a capacity exception (AC3). The booking itself stays undecided. */
export function approveCapacityException(token: string | null | undefined, requestId: number) {
  return call(`/api/venue-booking-requests/${requestId}/capacity-exception`, token, body => {
    const exception = body?.exception as CapacityException | undefined;
    return typeof exception?.exception_id === 'number' && typeof body?.booking === 'string'
      ? { exception, booking: body.booking as BookingReadiness } : null;
  }, { method: 'POST' });
}
