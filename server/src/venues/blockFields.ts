export const MAX_REASON_LENGTH = 500;

/** SG2-80 AC1: why a venue is unavailable, chosen from a fixed list. */
export const UNAVAILABILITY_CATEGORIES = ['maintenance', 'equipment_failure', 'renovation', 'safety_concern', 'other'] as const;
export type UnavailabilityCategory = typeof UNAVAILABILITY_CATEGORIES[number];

/** `reason` is the note that goes with the chosen category. */
export interface VenueBlockValues { starts_at: string; ends_at: string; category: UnavailabilityCategory; reason: string }
/** SG2-80 AC3/AC4: a confirmed booking inside the period, flagged but kept as it was. */
export type AffectedBooking = {
  booking_id: number; event_id: number | null; event_name: string | null; event_status: string | null;
  starts_at: string; ends_at: string;
};
/** SG2-80 AC6: who recorded the period and when (null for periods recorded before SG2-80). */
export type VenueBlockRecord = {
  unavailability_id: number; starts_at: string; ends_at: string; category: UnavailabilityCategory; reason: string;
  created_at: string | null; created_by_name: string | null; affected: AffectedBooking[];
};

function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** A block request (SG2-45, SG2-80): a period that has not yet ended, start
 * before end, a listed reason and a note. Matches venue_unavailability's own
 * time-order and category checks. */
export function validateVenueBlock(input: unknown, now = Date.now()): VenueBlockValues | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const starts = parseInstant(body.starts_at);
  const ends = parseInstant(body.ends_at);
  if (starts === null || ends === null || starts >= ends || ends <= now) return null;
  if (!UNAVAILABILITY_CATEGORIES.includes(body.category as UnavailabilityCategory)) return null;
  if (typeof body.reason !== 'string' || !body.reason.trim()) return null;
  const reason = body.reason.trim();
  if (Array.from(reason).length > MAX_REASON_LENGTH) return null;
  return {
    starts_at: new Date(starts).toISOString(), ends_at: new Date(ends).toISOString(),
    category: body.category as UnavailabilityCategory, reason
  };
}
