/**
 * Fetches every venue's occupied periods for one date range. Mirrors
 * ../auth/access.ts's contract: null on a denied session, throw on any other
 * failure, and never trust the response shape without checking it first.
 */

export type AvailabilityKind = 'booking' | 'unavailable';

export interface AvailabilityEntry {
  start: string;
  end: string;
  kind: AvailabilityKind;
  label: string;
}

export interface VenueAvailabilitySummary {
  venueId: number;
  name: string;
  entries: AvailabilityEntry[];
}

export interface AllVenuesAvailability {
  from: string;
  to: string;
  venues: VenueAvailabilitySummary[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEntry(value: unknown): value is AvailabilityEntry {
  return (
    isRecord(value) &&
    typeof value.start === 'string' &&
    typeof value.end === 'string' &&
    (value.kind === 'booking' || value.kind === 'unavailable') &&
    typeof value.label === 'string'
  );
}

function isVenue(value: unknown): value is VenueAvailabilitySummary {
  return (
    isRecord(value) &&
    typeof value.venueId === 'number' &&
    typeof value.name === 'string' &&
    Array.isArray(value.entries) &&
    value.entries.every(isEntry)
  );
}

function isAllVenuesAvailability(value: unknown): value is AllVenuesAvailability {
  return (
    isRecord(value) &&
    typeof value.from === 'string' &&
    typeof value.to === 'string' &&
    Array.isArray(value.venues) &&
    value.venues.every(isVenue)
  );
}

export async function loadAllVenuesAvailability(
  accessToken: string | null,
  from: string,
  to: string,
  signal?: AbortSignal
): Promise<AllVenuesAvailability | null> {
  if (!accessToken) return null;
  const query = new URLSearchParams({ from, to });
  const response = await fetch(`/api/venues/availability?${query.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
    signal
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Unable to load venue availability');
  const data: unknown = await response.json();
  if (!isAllVenuesAvailability(data)) throw new Error('Invalid venue availability response');
  return {
    from: data.from,
    to: data.to,
    venues: data.venues.map((v) => ({
      venueId: v.venueId,
      name: v.name,
      entries: v.entries.map((e) => ({ start: e.start, end: e.end, kind: e.kind, label: e.label }))
    }))
  };
}
