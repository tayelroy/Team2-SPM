/** Bookings that clash once setup and turnaround time apply (SG2-79).
 * Mirrors server/src/venues/clashes.ts. */
import { formatSgt } from './searchApi';

export interface ClashBooking {
  booking_id: number;
  venue_id: number;
  venue_name: string | null;
  /** Null when there is no event, or when it is another coordinator's. */
  event_id: number | null;
  event_name: string | null;
  starts_at: string;
  ends_at: string;
}

export interface VenueClash {
  booking: ClashBooking;
  clashes_with: ClashBooking;
  flagged_at: string;
}

export type ClashesResult = { ok: true; clashes: VenueClash[] } | { ok: false; error: string };

const UNAVAILABLE = 'Clashing bookings are unavailable right now. Please try again.';

function isBooking(value: unknown): value is ClashBooking {
  const booking = value as ClashBooking | null;
  return typeof booking?.booking_id === 'number' && typeof booking.starts_at === 'string' && typeof booking.ends_at === 'string';
}

function isClash(value: unknown): value is VenueClash {
  const clash = value as VenueClash | null;
  return isBooking(clash?.booking) && isBooking(clash?.clashes_with) && typeof clash?.flagged_at === 'string';
}

/** "Morning Summit" or, without a name, what can be said about the event. */
export function eventLabel(booking: ClashBooking): string {
  return booking.event_name ?? (booking.event_id === null ? 'another event' : `event #${booking.event_id}`);
}

export function describePeriod(booking: ClashBooking): string {
  return `${formatSgt(booking.starts_at)} – ${formatSgt(booking.ends_at)}`;
}

/** The flagged bookings the caller may see (AC3). */
export async function fetchVenueClashes(token: string | null | undefined): Promise<ClashesResult> {
  if (!token) return { ok: false, error: 'Your session has expired. Sign in again.' };
  try {
    const response = await fetch('/api/venue-clashes', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 401) return { ok: false, error: 'Your session has expired. Sign in again.' };
    if (response.status === 403) return { ok: false, error: 'Your account cannot see clashing bookings.' };
    if (!response.ok) return { ok: false, error: UNAVAILABLE };
    const body = await response.json().catch(() => null);
    return Array.isArray(body?.clashes) && body.clashes.every(isClash) ? { ok: true, clashes: body.clashes } : { ok: false, error: UNAVAILABLE };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}
