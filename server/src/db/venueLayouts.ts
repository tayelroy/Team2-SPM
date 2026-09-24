import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig } from './config';
import { AccessError } from '../auth/policy';
import type { VenueLayoutValues, VenueLayoutRecord } from '../venues/layoutFields';

const COLUMNS = 'layout,other_description';

export interface VenueLayoutStore {
  list(venueId: number): Promise<VenueLayoutRecord[]>;
  /** Replaces the venue's complete supported-layout set. Returns null when the
   * venue itself does not exist. */
  replace(venueId: number, layouts: VenueLayoutValues[]): Promise<VenueLayoutRecord[] | null>;
}

/** Use the caller's own token, so row level security policies on
 * venue_layouts (see the SG2-43 migration) enforce the same read/write split
 * as the route permission checks, rather than relying on the route alone. */
export function createVenueLayoutStore(token: string): VenueLayoutStore {
  const { supabaseUrl: url, supabaseAnonKey: key } = dbConfig;
  if (!url || !key || new URL(url).protocol !== 'https:') throw new AccessError(503);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket as any },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000), redirect: 'error' })
    }
  });
  function check(error: unknown, status: number) {
    if (error) throw new AccessError(status === 401 ? 401 : status === 403 ? 403 : 503);
  }
  return {
    async list(venueId) {
      const { data, error, status } = await client.from('venue_layouts').select(COLUMNS)
        .eq('venue_id', venueId).order('layout');
      check(error, status);
      return data as VenueLayoutRecord[];
    },
    async replace(venueId, layouts) {
      const { data: venue, error: venueError, status: venueStatus } = await client.from('venues')
        .select('venue_id').eq('venue_id', venueId).maybeSingle();
      check(venueError, venueStatus);
      if (!venue) return null;

      const table = client.from('venue_layouts');
      const { error: delError, status: delStatus } = await table.delete().eq('venue_id', venueId);
      check(delError, delStatus);
      if (layouts.length === 0) return [];

      const rows = layouts.map(item => ({ venue_id: venueId, layout: item.layout, other_description: item.other_description ?? null }));
      const { data, error, status } = await table.insert(rows).select(COLUMNS);
      check(error, status);
      return data as VenueLayoutRecord[];
    }
  };
}
