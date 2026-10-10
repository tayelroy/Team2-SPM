import type { Venue } from './api';
import type { Layout, VenueLayout } from './layoutsApi';

/** The search form's values. Times are `YYYY-MM-DDTHH:mm` in Singapore time,
 * matching how every other screen shows dates. */
export interface VenueSearchValues {
  from: string;
  until: string;
  attendance: string;
  location: string;
  layout: Layout | '';
  facilities: string;
  accessibility: string;
}

export type HeldPeriod = { starts_at: string; ends_at: string };
export type VenueMatch = Venue & { layouts: VenueLayout[]; held: HeldPeriod[] };

export const EMPTY_SEARCH: VenueSearchValues = {
  from: '', until: '', attendance: '', location: '', layout: '', facilities: '', accessibility: ''
};

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
const sgt = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' });

/** A datetime-local value read as Singapore time, in epoch ms; NaN when empty or invalid. */
export function sgtToMs(local: string): number {
  return Date.parse(`${local}:00+08:00`);
}

export function sgtToIso(local: string): string {
  return new Date(`${local}:00+08:00`).toISOString();
}

export function isoToSgtLocal(iso: string): string {
  return new Date(Date.parse(iso) + SGT_OFFSET_MS).toISOString().slice(0, 16);
}

export function formatSgt(iso: string): string {
  return sgt.format(new Date(iso));
}

export class VenueSearchError extends Error {
  constructor(public status: number, detail?: string) {
    super(status === 401 ? 'Your session has expired. Sign in again.'
      : status === 403 ? 'Only Event Coordinators can search venues.'
      : status === 400 ? detail ?? 'Check the search criteria and try again.'
      : 'Venue search is unavailable right now. Please try again.');
  }
}

export async function searchVenues(token: string, signal: AbortSignal, values: VenueSearchValues): Promise<VenueMatch[]> {
  const query = new URLSearchParams({ from: sgtToIso(values.from), to: sgtToIso(values.until) });
  for (const key of ['attendance', 'location', 'layout', 'facilities', 'accessibility'] as const) {
    if (values[key].trim()) query.set(key, values[key].trim());
  }
  const response = await fetch(`/api/venues/search?${query}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal
  });
  if (!response.ok) {
    const body = response.status === 400 ? await response.json().catch(() => null) : null;
    throw new VenueSearchError(response.status, typeof body?.error === 'string' ? body.error : undefined);
  }
  return (await response.json()).venues;
}
