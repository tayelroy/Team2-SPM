/** Pending venue requests the signed-in account may approve a capacity exception for (SG2-47 AC3). */
export interface CapacityExceptionRequest {
  request_id: number;
  event_id: number;
  event_name: string;
  venue_name: string;
  starts_at: string;
  ends_at: string;
  expected_attendance: number;
  venue_capacity: number | null;
}

type Result = { ok: true; requests: CapacityExceptionRequest[] } | { ok: false; error: string };
const UNAVAILABLE = 'Capacity exception requests are unavailable right now. Please try again.';

function isRequest(value: unknown): value is CapacityExceptionRequest {
  if (!value || typeof value !== 'object') return false;
  const row = value as CapacityExceptionRequest;
  return Number.isInteger(row.request_id) && row.request_id > 0 &&
    Number.isInteger(row.event_id) && row.event_id > 0 &&
    typeof row.event_name === 'string' && row.event_name.trim().length > 0 &&
    typeof row.venue_name === 'string' && row.venue_name.trim().length > 0 &&
    typeof row.starts_at === 'string' && Number.isFinite(Date.parse(row.starts_at)) &&
    typeof row.ends_at === 'string' && Number.isFinite(Date.parse(row.ends_at)) &&
    Date.parse(row.ends_at) > Date.parse(row.starts_at) &&
    Number.isInteger(row.expected_attendance) && row.expected_attendance > 0 &&
    (row.venue_capacity === null || (Number.isInteger(row.venue_capacity) && row.venue_capacity >= 0));
}

/** Only the public scoped list is read; the server remains authoritative for eligibility and approval. */
export async function fetchCapacityExceptions(token: string | null | undefined): Promise<Result> {
  if (!token) return { ok: false, error: 'Your session has expired. Sign in again.' };
  try {
    const response = await fetch('/api/venue-booking-requests/capacity-exceptions', {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store'
    });
    if (response.status === 401) return { ok: false, error: 'Your session has expired. Sign in again.' };
    if (response.status === 403) return { ok: false, error: 'Your account cannot approve capacity exceptions.' };
    if (!response.ok) return { ok: false, error: UNAVAILABLE };
    const body = await response.json();
    if (!Array.isArray(body?.requests) || !body.requests.every(isRequest)) return { ok: false, error: UNAVAILABLE };
    return { ok: true, requests: body.requests };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}
