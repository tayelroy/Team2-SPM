/** Venue bookings and releasing one (SG2-51). Mirrors server/src/venues/bookings.ts. */

export interface VenueBooking {
  booking_id: number;
  venue_id: number;
  venue_name: string | null;
  event_id: number | null;
  event_name: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  canceller_name: string | null;
}

export interface Released {
  booking_id: number;
  status: 'cancelled';
  cancelled_at: string;
  cancellation_reason: string;
}

/** The longest release reason the server accepts. */
export const MAX_RELEASE_REASON = 500;

export type BookingsResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const UNAVAILABLE = 'Venue bookings are unavailable right now. Please try again.';
const EXPIRED = 'Your session has expired. Sign in again.';

function isBooking(value: unknown): value is VenueBooking {
  const booking = value as VenueBooking | null;
  return typeof booking?.booking_id === 'number' && typeof booking.status === 'string'
    && typeof booking.starts_at === 'string' && typeof booking.ends_at === 'string';
}

/** A 400, 404 or 409 carries the server's own explanation. */
async function call<T>(url: string, token: string | null | undefined, read: (body: Record<string, unknown> | null) => T | null, init: RequestInit = {}): Promise<BookingsResult<T>> {
  if (!token) return { ok: false, error: EXPIRED };
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (init.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, { ...init, headers, cache: 'no-store' });
    if (response.status === 401) return { ok: false, error: EXPIRED };
    if (response.status === 403) return { ok: false, error: 'Your account cannot manage these venue bookings.' };
    const body = await response.json().catch(() => null);
    if ([400, 404, 409].includes(response.status) && typeof body?.error === 'string') return { ok: false, error: body.error };
    const value = response.ok ? read(body) : null;
    return value === null ? { ok: false, error: UNAVAILABLE } : { ok: true, ...value };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

const readBookings = (body: Record<string, unknown> | null) => {
  const bookings = body?.bookings;
  return Array.isArray(bookings) && bookings.every(isBooking) ? { bookings } : null;
};

/** An event's confirmed and released bookings, one per venue (AC3). */
export function fetchEventBookings(token: string | null | undefined, eventId: number) {
  return call(`/api/venue-bookings?event_id=${eventId}`, token, readBookings);
}

/** A venue's confirmed and released bookings not yet over (Venue Staff). */
export function fetchVenueBookings(token: string | null | undefined, venueId: number) {
  return call(`/api/venue-bookings?venue_id=${venueId}`, token, readBookings);
}

/** Releases a booking with a reason (AC1). */
export function releaseBooking(token: string | null | undefined, bookingId: number, reason: string) {
  return call(`/api/venue-bookings/${bookingId}/release`, token, body =>
    typeof body?.booking_id === 'number' && body.status === 'cancelled' && typeof body.cancelled_at === 'string'
      ? { released: body as unknown as Released } : null,
  { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
}
