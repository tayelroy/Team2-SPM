export interface VenueBlockValues { starts_at: string; ends_at: string; reason: string }
export type VenueBlock = { unavailability_id: number; starts_at: string; ends_at: string; reason: string };
export type BookingConflict = { booking_id: number; event_id: number | null; starts_at: string; ends_at: string };

const dateTime = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short' });

/** A period as one readable line, e.g. "1 Oct 2026, 9:00 am – 1 Oct 2026, 5:00 pm". */
export function describePeriod(startsAt: string, endsAt: string): string {
  return `${dateTime.format(new Date(startsAt))} – ${dateTime.format(new Date(endsAt))}`;
}

export class VenueBlockError extends Error {
  constructor(public status: number, public booking: BookingConflict | null = null) {
    super(status === 401 ? 'Your session has expired. Sign in again.'
      : status === 403 ? 'You no longer have permission to do this.'
      : status === 400 ? 'Enter a start and an end, with the end after the start and not in the past, and a reason.'
      : status === 404 ? 'This venue or block no longer exists. Reload the catalogue.'
      : status === 409 ? booking
        ? `This period already holds a confirmed booking: booking #${booking.booking_id}${booking.event_id === null ? '' : ` for event ${booking.event_id}`}, ${describePeriod(booking.starts_at, booking.ends_at)}.`
        : 'This period already holds a confirmed booking.'
      : 'Unable to reach the venue service. Please try again.');
  }
}

async function failure(response: Response): Promise<VenueBlockError> {
  const body = response.status === 409 ? await response.json().catch(() => null) : null;
  return new VenueBlockError(response.status, body?.booking ?? null);
}

export async function fetchVenueBlocks(token: string, signal: AbortSignal, venueId: number): Promise<VenueBlock[]> {
  const response = await fetch(`/api/venues/${venueId}/blocks`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()).blocks;
}

export async function createVenueBlock(token: string, signal: AbortSignal, venueId: number, values: VenueBlockValues): Promise<VenueBlock> {
  const response = await fetch(`/api/venues/${venueId}/blocks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store', signal,
    body: JSON.stringify(values)
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()).block;
}

export async function removeVenueBlock(token: string, signal: AbortSignal, venueId: number, blockId: number): Promise<void> {
  const response = await fetch(`/api/venues/${venueId}/blocks/${blockId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (!response.ok) throw await failure(response);
}
