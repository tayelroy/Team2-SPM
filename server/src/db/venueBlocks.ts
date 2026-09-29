import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig } from './config';
import { AccessError } from '../auth/policy';
import type { BookingConflict, VenueBlockRecord, VenueBlockValues } from '../venues/blockFields';

const COLUMNS = 'unavailability_id,starts_at,ends_at,reason';
const CONFLICT_COLUMNS = 'booking_id,event_id,starts_at,ends_at';

export type CreateBlockResult =
  | { outcome: 'created'; block: VenueBlockRecord }
  | { outcome: 'conflict'; booking: BookingConflict }
  | { outcome: 'missing' };

export interface VenueBlockStore {
  /** Blocks that have not yet ended, earliest first. */
  list(venueId: number, now: string): Promise<VenueBlockRecord[]>;
  /** Refuses the block when a confirmed booking overlaps the period. */
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
  async function findConflict(venueId: number, values: VenueBlockValues) {
    const { data, error, status } = await client.from('venue_bookings').select(CONFLICT_COLUMNS)
      .eq('venue_id', venueId).eq('status', 'confirmed')
      .lt('starts_at', values.ends_at).gt('ends_at', values.starts_at)
      .order('starts_at').range(0, 0);
    check(error, status);
    return (data as BookingConflict[])[0];
  }
  return {
    async list(venueId, now) {
      const { data, error, status } = await client.from('venue_unavailability').select(COLUMNS)
        .eq('venue_id', venueId).gt('ends_at', now).order('starts_at');
      check(error, status);
      return data as VenueBlockRecord[];
    },
    async create(venueId, values) {
      const { data: venue, error: venueError, status: venueStatus } = await client.from('venues')
        .select('venue_id').eq('venue_id', venueId).maybeSingle();
      check(venueError, venueStatus);
      if (!venue) return { outcome: 'missing' };

      const existing = await findConflict(venueId, values);
      if (existing) return { outcome: 'conflict', booking: existing };

      const { data, error, status } = await client.from('venue_unavailability')
        .insert({ venue_id: venueId, ...values }).select(COLUMNS).maybeSingle();
      // A booking confirmed between the check and the insert trips the
      // database's own overlap trigger; name that booking instead of failing.
      if ((error as { code?: string } | null)?.code === '23P01') {
        const raced = await findConflict(venueId, values);
        if (raced) return { outcome: 'conflict', booking: raced };
      }
      check(error, status);
      return { outcome: 'created', block: data as VenueBlockRecord };
    },
    async remove(venueId, blockId) {
      const { data, error, status } = await client.from('venue_unavailability').delete()
        .eq('venue_id', venueId).eq('unavailability_id', blockId).select('unavailability_id');
      check(error, status);
      return (data as unknown[]).length > 0;
    }
  };
}
