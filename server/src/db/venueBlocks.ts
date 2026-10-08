import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig } from './config';
import { AccessError } from '../auth/policy';
import type { VenueBlockRecord, VenueBlockValues } from '../venues/blockFields';

export type CreateBlockResult =
  | { outcome: 'created'; block: VenueBlockRecord }
  | { outcome: 'missing' };

export interface VenueBlockStore {
  /** Blocks that have not yet ended, earliest first, with their affected bookings. */
  list(venueId: number, now: string): Promise<VenueBlockRecord[]>;
  /** SG2-80 AC2: allowed over confirmed bookings, which the database flags. */
  create(venueId: number, values: VenueBlockValues): Promise<CreateBlockResult>;
  /** Returns false when no such block exists for the venue. */
  remove(venueId: number, blockId: number): Promise<boolean>;
}

/** Use the caller's own token, so row level security policies on
 * venue_unavailability (see the SG2-45 migration) enforce the same write
 * restriction as the route permission check, rather than relying on the
 * route alone. */
export function createVenueBlockStore(token: string): VenueBlockStore {
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
  // SG2-80 AC1/AC3/AC6: the reason, note, recorder and affected events come
  // from one definer function, since Venue Staff do not read events or users.
  async function list(venueId: number, after: string) {
    const { data, error, status } = await client.rpc('list_venue_unavailability', { p_venue_id: venueId, p_after: after });
    check(error, status);
    return data as VenueBlockRecord[];
  }
  return {
    list,
    async create(venueId, values) {
      const { data: venue, error: venueError, status: venueStatus } = await client.from('venues')
        .select('venue_id').eq('venue_id', venueId).maybeSingle();
      check(venueError, venueStatus);
      if (!venue) return { outcome: 'missing' };

      const { data, error, status } = await client.from('venue_unavailability')
        .insert({ venue_id: venueId, ...values }).select('unavailability_id').single();
      check(error, status);
      // Read the new period back with what the database stamped and flagged.
      const id = (data as { unavailability_id: number }).unavailability_id;
      const block = (await list(venueId, values.starts_at)).find(item => item.unavailability_id === id);
      if (!block) throw new AccessError(503);
      return { outcome: 'created', block };
    },
    async remove(venueId, blockId) {
      const { data, error, status } = await client.from('venue_unavailability').delete()
        .eq('venue_id', venueId).eq('unavailability_id', blockId).select('unavailability_id');
      check(error, status);
      return (data as unknown[]).length > 0;
    }
  };
}
