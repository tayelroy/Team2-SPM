/** SG2-80 AC1: the reasons a venue can be marked unavailable, as the server lists them. */
export const UNAVAILABILITY_CATEGORIES = {
  maintenance: 'Maintenance',
  equipment_failure: 'Equipment failure',
  renovation: 'Renovation',
  safety_concern: 'Safety concern',
  other: 'Other'
} as const;
export type UnavailabilityCategory = keyof typeof UNAVAILABILITY_CATEGORIES;

/** `reason` is the note that goes with the chosen category. */
export interface VenueBlockValues { starts_at: string; ends_at: string; category: UnavailabilityCategory; reason: string }
/** SG2-80 AC3/AC4: a confirmed booking inside the period, flagged but not cancelled. */
export type AffectedBooking = {
  booking_id: number; event_id: number | null; event_name: string | null; event_status: string | null;
  starts_at: string; ends_at: string;
};
export type VenueBlock = {
  unavailability_id: number; starts_at: string; ends_at: string; category: UnavailabilityCategory; reason: string;
  created_at: string | null; created_by_name: string | null; affected: AffectedBooking[];
};

const dateTime = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' });

/** A period as one readable line, e.g. "1 Oct 2026, 9:00 am – 1 Oct 2026, 5:00 pm". */
export function describePeriod(startsAt: string, endsAt: string): string {
  return `${dateTime.format(new Date(startsAt))} – ${dateTime.format(new Date(endsAt))}`;
}

/** SG2-80 AC6: who recorded a period and when, for periods recorded since SG2-80. */
export function describeRecorded(block: Pick<VenueBlock, 'created_at' | 'created_by_name'>): string {
  if (!block.created_at) return 'Recorded before who and when were kept';
  return `Recorded by ${block.created_by_name ?? 'a former user'} on ${dateTime.format(new Date(block.created_at))}`;
}

export class VenueBlockError extends Error {
  constructor(public status: number) {
    super(status === 401 ? 'Your session has expired. Sign in again.'
      : status === 403 ? 'You no longer have permission to do this.'
      : status === 400 ? 'Enter a start and an end, with the end after the start and not in the past, a reason and a note.'
      : status === 404 ? 'This venue or block no longer exists. Reload the catalogue.'
      : 'Unable to reach the venue service. Please try again.');
  }
}

export async function fetchVenueBlocks(token: string, signal: AbortSignal, venueId: number): Promise<VenueBlock[]> {
  const response = await fetch(`/api/venues/${venueId}/blocks`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (!response.ok) throw new VenueBlockError(response.status);
  return (await response.json()).blocks;
}

export async function createVenueBlock(token: string, signal: AbortSignal, venueId: number, values: VenueBlockValues): Promise<VenueBlock> {
  const response = await fetch(`/api/venues/${venueId}/blocks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store', signal,
    body: JSON.stringify(values)
  });
  if (!response.ok) throw new VenueBlockError(response.status);
  return (await response.json()).block;
}

export async function removeVenueBlock(token: string, signal: AbortSignal, venueId: number, blockId: number): Promise<void> {
  const response = await fetch(`/api/venues/${venueId}/blocks/${blockId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (!response.ok) throw new VenueBlockError(response.status);
}
