import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorization } from '../auth';
import { createUserScopedClient } from '../db/user-client';
import type { VenueRecord } from './fields';
import type { VenueLayoutRecord } from './layoutFields';
import { parseVenueSearch, type VenueSearchCriteria } from './searchFields';

const VENUE_COLUMNS = 'venue_id,name,location,capacity,facilities,accessibility_features,operating_information';

/** A held booking does not stop a venue matching, but the coordinator should
 * know it is pencilled in, since it may still be confirmed. */
export type HeldPeriod = { starts_at: string; ends_at: string };
export type VenueMatch = VenueRecord & { layouts: VenueLayoutRecord[]; held: HeldPeriod[] };

type SearchResult = { outcome: 'ok'; venues: VenueMatch[] } | { outcome: 'unavailable' };

interface LayoutRow extends VenueLayoutRecord { venue_id: number }
interface OccupancyRow { venue_id: number; starts_at: string; ends_at: string; status?: string }

function includesAll(text: string | null, keywords: string[]): boolean {
  const haystack = (text ?? '').toLowerCase();
  return keywords.every(keyword => haystack.includes(keyword));
}

/**
 * Venues that meet every applied criterion and are free for the whole period
 * (SG2-46): no block (SG2-45) and no confirmed booking overlaps it. Reads with
 * the caller's own token, so RLS limits the occupancy tables to internal roles.
 */
export async function searchVenues(criteria: VenueSearchCriteria, client: SupabaseClient): Promise<SearchResult> {
  const { starts_at: from, ends_at: to } = criteria;
  const [venues, layouts, blocks, bookings] = await Promise.all([
    client.from('venues').select(VENUE_COLUMNS).order('name', { ascending: true }),
    client.from('venue_layouts').select('venue_id,layout,other_description'),
    client.from('venue_unavailability').select('venue_id,starts_at,ends_at').lt('starts_at', to).gt('ends_at', from),
    client.from('venue_bookings').select('venue_id,starts_at,ends_at,status').lt('starts_at', to).gt('ends_at', from)
  ]);
  if (venues.error || layouts.error || blocks.error || bookings.error) return { outcome: 'unavailable' };

  const occupied = new Set<number>();
  const held = new Map<number, HeldPeriod[]>();
  for (const row of blocks.data as OccupancyRow[]) occupied.add(row.venue_id);
  for (const row of bookings.data as OccupancyRow[]) {
    if (row.status === 'confirmed') occupied.add(row.venue_id);
    else held.set(row.venue_id, [...(held.get(row.venue_id) ?? []), { starts_at: row.starts_at, ends_at: row.ends_at }]);
  }
  const layoutsByVenue = new Map<number, VenueLayoutRecord[]>();
  for (const { venue_id, ...layout } of layouts.data as LayoutRow[]) {
    layoutsByVenue.set(venue_id, [...(layoutsByVenue.get(venue_id) ?? []), layout]);
  }

  const matches = (venues.data as VenueRecord[]).filter(venue => {
    const venueLayouts = layoutsByVenue.get(venue.venue_id) ?? [];
    return !occupied.has(venue.venue_id)
      && (criteria.attendance === null || (venue.capacity ?? 0) >= criteria.attendance)
      && (criteria.location === null || includesAll(venue.location, [criteria.location]))
      && (criteria.layout === null || venueLayouts.some(item => item.layout === criteria.layout))
      && includesAll(venue.facilities, criteria.facilities)
      && includesAll(venue.accessibility_features, criteria.accessibility);
  }).map(venue => ({
    ...venue,
    layouts: layoutsByVenue.get(venue.venue_id) ?? [],
    held: (held.get(venue.venue_id) ?? []).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  }));

  return { outcome: 'ok', venues: matches };
}

/**
 * GET /search?from=&to=&attendance=&location=&layout=&facilities=&accessibility=
 * Runs behind requireAuth + requirePermission('venues.search').
 */
export function createVenueSearchHandler(
  search: typeof searchVenues = searchVenues,
  makeClient: (token: string) => SupabaseClient | null = createUserScopedClient
): RequestHandler {
  return async (req, res) => {
    const parsed = parseVenueSearch(req.query as Record<string, unknown>);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.message });
      return;
    }
    // requireAuth has already verified the single, well-formed bearer header.
    const client = makeClient(req.get('authorization')!.slice(7));
    const result = client ? await search(parsed.criteria, client).catch(() => ({ outcome: 'unavailable' as const })) : { outcome: 'unavailable' as const };
    if (result.outcome === 'unavailable') {
      res.status(503).json({ error: 'Venue search is temporarily unavailable.' });
      return;
    }
    res.status(200).json({ venues: result.venues });
  };
}

/** Router for venue search (SG2-46), mounted at /api/venues alongside the other
 * venue routers; /search does not overlap their route patterns. */
export function createVenueSearchRouter(access = authorization, handler: RequestHandler = createVenueSearchHandler()) {
  const router = access.protectedRouter();
  router.get('/search', access.requirePermission('venues.search'), handler);
  return router;
}
