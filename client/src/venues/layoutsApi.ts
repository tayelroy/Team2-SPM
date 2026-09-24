export const LAYOUTS = ['classroom', 'theatre', 'boardroom', 'banquet', 'exhibition', 'other'] as const;
export type Layout = typeof LAYOUTS[number];
export interface VenueLayoutValues { layout: Layout; other_description?: string }
export type VenueLayout = { layout: Layout; other_description: string | null };

export const LAYOUT_LABELS: Record<Layout, string> = {
  classroom: 'Classroom', theatre: 'Theatre', boardroom: 'Boardroom',
  banquet: 'Banquet', exhibition: 'Exhibition', other: 'Other'
};

/** A venue's supported layouts as one readable line, or "NA" when none are recorded. */
export function describeLayouts(layouts: VenueLayout[]): string {
  if (layouts.length === 0) return 'NA';
  return layouts.map(item => item.layout === 'other' ? item.other_description ?? 'Other' : LAYOUT_LABELS[item.layout]).join(', ');
}

export class VenueLayoutError extends Error {
  constructor(public status: number) {
    super(status === 401 ? 'Your session has expired. Sign in again.'
      : status === 403 ? 'You no longer have permission to do this.'
      : status === 400 ? 'Choose a layout for each entry; "Other" needs a short description.'
      : status === 404 ? 'This venue is no longer available. Reload the catalogue.'
      : 'Unable to reach the venue service. Please try again.');
  }
}

export async function fetchVenueLayouts(token: string, signal: AbortSignal, venueId: number): Promise<VenueLayout[]> {
  const response = await fetch(`/api/venues/${venueId}/layouts`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (!response.ok) throw new VenueLayoutError(response.status);
  return (await response.json()).layouts;
}

export async function saveVenueLayouts(token: string, signal: AbortSignal, venueId: number, layouts: VenueLayoutValues[]): Promise<VenueLayout[]> {
  const response = await fetch(`/api/venues/${venueId}/layouts`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store', signal,
    body: JSON.stringify({ layouts })
  });
  if (!response.ok) throw new VenueLayoutError(response.status);
  return (await response.json()).layouts;
}
