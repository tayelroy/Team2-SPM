import { LAYOUTS, type Layout } from './layoutFields';

export interface VenueBookingRequestValues {
  event_id: number;
  venue_id: number;
  starts_at: string;
  ends_at: string;
  layout: Layout;
  /** SG2-81: the affected booking this request replaces, when it is one. */
  replaces_booking_id?: number;
}

function parseId(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 2147483647 ? value as number : null;
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A venue request (SG2-48 AC1): which event and venue, a period that starts
 * before it ends and has not already started, and one of the venue layouts.
 * The venue requirements are not taken from the caller: the request carries
 * the event's own. A request may also name the booking it replaces (SG2-81
 * AC4); whether that booking is affected is checked by the route.
 */
export function validateVenueBookingRequest(input: unknown, now = Date.now()): VenueBookingRequestValues | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const eventId = parseId(body.event_id);
  const venueId = parseId(body.venue_id);
  const starts = parseInstant(body.starts_at);
  const ends = parseInstant(body.ends_at);
  if (eventId === null || venueId === null || starts === null || ends === null) return null;
  if (starts >= ends || starts <= now) return null;
  if (typeof body.layout !== 'string' || !(LAYOUTS as readonly string[]).includes(body.layout)) return null;
  const replaces = body.replaces_booking_id === undefined || body.replaces_booking_id === null ? undefined : parseId(body.replaces_booking_id);
  if (replaces === null) return null;
  return {
    event_id: eventId, venue_id: venueId, layout: body.layout as Layout,
    starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(),
    ...(replaces === undefined ? {} : { replaces_booking_id: replaces })
  };
}
