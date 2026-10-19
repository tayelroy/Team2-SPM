export interface VenueValues {
  name: string;
  location: string;
  capacity: number;
  facilities: string;
  accessibility_features: string;
  operating_information: string;
}
export type Venue = { venue_id: number; name: string } & {
  [Field in Exclude<keyof VenueValues, 'name'>]: VenueValues[Field] | null
};

export class VenueError extends Error {
  constructor(public status: number) {
    super(status === 401 ? 'Your session has expired. Sign in again.'
      : status === 403 ? 'You no longer have permission to do this.'
      : status === 400 ? 'Check the venue details and capacity, then try again.'
      : status === 404 ? 'This venue is no longer available. Reload the catalogue.'
      : 'Unable to reach the venue service. Please try again.');
  }
}

export async function venueRequest(token: string, signal: AbortSignal, values?: VenueValues, id?: number) {
  const response = await fetch(`/api/venues${id === undefined ? '' : `/${id}`}`, {
    method: values ? id === undefined ? 'POST' : 'PUT' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store', signal,
    body: values ? JSON.stringify(values) : undefined
  });
  if (!response.ok) throw new VenueError(response.status);
  return response.json();
}

/** SG2-106: live work that stops a venue being deleted. */
export interface VenueBlocker {
  kind: 'booking' | 'hold' | 'request';
  id: number;
  event_id: number | null;
  event_name: string | null;
  starts_at: string;
  ends_at: string;
}
export class VenueDeleteBlocked extends Error {
  constructor(public blockers: VenueBlocker[]) {
    super('This venue still has current or future bookings, holds or pending requests.');
  }
}

export async function deleteVenue(token: string, signal: AbortSignal, id: number): Promise<void> {
  const response = await fetch(`/api/venues/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    throw new VenueDeleteBlocked(Array.isArray(body?.blockers) ? body.blockers : []);
  }
  if (!response.ok) throw new VenueError(response.status);
}
