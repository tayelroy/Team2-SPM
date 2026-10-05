import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig } from './config';
import { AccessError } from '../auth/policy';
import { DEFAULT_OPERATIONS, type VenueOperationRecord, type VenueOperationValues } from '../venues/operationFields';

const COLUMNS = 'setup_minutes,turnaround_minutes,emergency_access,known_restrictions,updated_at';

export interface VenueOperationStore {
  /** The venue's saved values, the defaults when none are saved, or null
   * when the venue itself does not exist. */
  get(venueId: number): Promise<VenueOperationRecord | null>;
  /** Saves the complete set. Returns null when the venue does not exist. */
  save(venueId: number, values: VenueOperationValues): Promise<VenueOperationRecord | null>;
}

/** Use the caller's own token, so the row level security policies on
 * venue_operations (SG2-77 migration) enforce the same read/write split as the
 * route permissions, and the change-history trigger records the real caller. */
export function createVenueOperationStore(token: string): VenueOperationStore {
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
  async function venueExists(venueId: number) {
    const { data, error, status } = await client.from('venues').select('venue_id').eq('venue_id', venueId).maybeSingle();
    check(error, status);
    return data !== null;
  }
  return {
    async get(venueId) {
      if (!(await venueExists(venueId))) return null;
      const { data, error, status } = await client.from('venue_operations').select(COLUMNS)
        .eq('venue_id', venueId).maybeSingle();
      check(error, status);
      return (data as VenueOperationRecord | null) ?? { ...DEFAULT_OPERATIONS };
    },
    async save(venueId, values) {
      if (!(await venueExists(venueId))) return null;
      const { data, error, status } = await client.from('venue_operations')
        .upsert({ venue_id: venueId, ...values }, { onConflict: 'venue_id' })
        .select(COLUMNS).maybeSingle();
      check(error, status);
      return data as VenueOperationRecord;
    }
  };
}
