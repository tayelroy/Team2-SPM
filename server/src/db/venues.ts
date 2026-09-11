import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { dbConfig } from './config';
import { AccessError } from '../auth/policy';
import type { VenueRecord, VenueValues } from '../venues/fields';

const COLUMNS = 'venue_id,name,location,capacity,facilities,accessibility_features,operating_information';
export interface VenueStore {
  list(): Promise<VenueRecord[]>;
  save(values: VenueValues, id?: number): Promise<VenueRecord | null>;
}

/** Carry the verified caller's token so table RLS also enforces venue permissions. */
export function createVenueStore(token: string): VenueStore {
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
    async list() {
      const { data, error, status } = await client.from('venues').select(COLUMNS).order('name').order('venue_id');
      check(error, status);
      return data as VenueRecord[];
    },
    async save(values, id) {
      const table = client.from('venues');
      const query = id === undefined ? table.insert(values) : table.update(values).eq('venue_id', id);
      const { data, error, status } = await query.select(COLUMNS).maybeSingle();
      check(error, status);
      return data as VenueRecord | null;
    }
  };
}
