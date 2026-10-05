/** Longest setup or turnaround period a venue can record: one day. */
export const MAX_MINUTES = 1440;
/** Longest safety note, matching the venue_operations length checks. */
export const MAX_SAFETY_TEXT = 2000;

export interface VenueOperationValues {
  setup_minutes: number;
  turnaround_minutes: number;
  emergency_access: string | null;
  known_restrictions: string | null;
}
export type VenueOperationRecord = VenueOperationValues & { updated_at: string | null };

/** What a venue without a saved row means (SG2-77 AC3): no setup or
 * turnaround time and no safety details recorded. */
export const DEFAULT_OPERATIONS: VenueOperationRecord = {
  setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: null, updated_at: null
};

function minutes(value: unknown): number | null {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_MINUTES) return null;
  return value as number;
}

/** A blank note is stored as "not recorded" rather than as an empty string;
 * undefined marks an invalid note. */
function note(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Array.from(trimmed).length > MAX_SAFETY_TEXT ? undefined : trimmed;
}

/** The complete set submitted for a venue (SG2-77). Unknown fields never reach storage. */
export function validateVenueOperations(input: unknown): VenueOperationValues | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const setup = minutes(body.setup_minutes);
  const turnaround = minutes(body.turnaround_minutes);
  const emergency = note(body.emergency_access);
  const restrictions = note(body.known_restrictions);
  if (setup === null || turnaround === null || emergency === undefined || restrictions === undefined) return null;
  return { setup_minutes: setup, turnaround_minutes: turnaround, emergency_access: emergency, known_restrictions: restrictions };
}
