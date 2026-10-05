/** Longest setup or turnaround period the server accepts: one day (SG2-77). */
export const MAX_MINUTES = 1440;
/** Longest safety note the server accepts. */
export const MAX_SAFETY_TEXT = 2000;

export interface VenueOperationValues {
  setup_minutes: number;
  turnaround_minutes: number;
  emergency_access: string | null;
  known_restrictions: string | null;
}
export type VenueOperations = VenueOperationValues & { updated_at: string | null };

/** What a venue shows before its details load or when none are saved. */
export const NO_OPERATIONS: VenueOperations = {
  setup_minutes: 0, turnaround_minutes: 0, emergency_access: null, known_restrictions: null, updated_at: null
};

/** "30 min setup · 45 min turnaround" for the venue card. */
export function describeTimes(operations: VenueOperations): string {
  return `${operations.setup_minutes} min setup · ${operations.turnaround_minutes} min turnaround`;
}

export class VenueOperationsError extends Error {
  constructor(public status: number) {
    super(status === 401 ? 'Your session has expired. Sign in again.'
      : status === 403 ? 'You no longer have permission to do this.'
      : status === 400 ? `Enter setup and turnaround times as whole minutes from 0 to ${MAX_MINUTES}, and keep each safety note within ${MAX_SAFETY_TEXT} characters.`
      : status === 404 ? 'This venue is no longer available. Reload the catalogue.'
      : 'Unable to reach the venue service. Please try again.');
  }
}

export async function fetchVenueOperations(token: string, signal: AbortSignal, venueId: number): Promise<VenueOperations> {
  const response = await fetch(`/api/venues/${venueId}/operations`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (!response.ok) throw new VenueOperationsError(response.status);
  return (await response.json()).operations;
}

export async function saveVenueOperations(token: string, signal: AbortSignal, venueId: number, values: VenueOperationValues): Promise<VenueOperations> {
  const response = await fetch(`/api/venues/${venueId}/operations`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store', signal,
    body: JSON.stringify(values)
  });
  if (!response.ok) throw new VenueOperationsError(response.status);
  return (await response.json()).operations;
}
