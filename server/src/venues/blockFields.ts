export const MAX_REASON_LENGTH = 500;

export interface VenueBlockValues { starts_at: string; ends_at: string; reason: string }
export type VenueBlockRecord = { unavailability_id: number; starts_at: string; ends_at: string; reason: string };
/** The confirmed booking that stops a period from being blocked. */
export type BookingConflict = { booking_id: number; event_id: number | null; starts_at: string; ends_at: string };

function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** A block request (SG2-45): a period that has not yet ended, start before
 * end, and a reason. Matches venue_unavailability's own time-order check. */
export function validateVenueBlock(input: unknown, now = Date.now()): VenueBlockValues | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const starts = parseInstant(body.starts_at);
  const ends = parseInstant(body.ends_at);
  if (starts === null || ends === null || starts >= ends || ends <= now) return null;
  if (typeof body.reason !== 'string' || !body.reason.trim()) return null;
  const reason = body.reason.trim();
  if (Array.from(reason).length > MAX_REASON_LENGTH) return null;
  return { starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(), reason };
}
