import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';
import type { HoldNotification, VenueHoldRecord, VenueHoldValues } from '../venues/holdFields';

export interface HoldOptions {
  events: { event_id: number; name: string }[];
  venues: { venue_id: number; name: string }[];
}
export type HoldMutationResult = { outcome: 'created' | 'updated'; hold: VenueHoldRecord }
  | { outcome: 'missing' | 'invalid' | 'conflict' | 'inactive' | 'capacity' | 'suitability' };
export interface VenueHoldStore {
  list(): Promise<VenueHoldRecord[]>;
  options(): Promise<HoldOptions>;
  notifications(): Promise<HoldNotification[]>;
  create(values: VenueHoldValues): Promise<HoldMutationResult>;
  change(id: number, action: 'release' | 'convert'): Promise<HoldMutationResult>;
}
/** Every mutation is one database transaction under the venue lock, with the caller's token. */
export function createVenueHoldStore(token: string, makeClient = createUserScopedClient): VenueHoldStore {
  const client: SupabaseClient | null = makeClient(token);
  if (!client) throw new AccessError(503);
  async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error, status } = await client!.rpc(name, args);
    if (error || data === null) throw new AccessError(status === 401 ? 401 : status === 403 || error?.code === '42501' ? 403 : 503);
    return data as T;
  }
  return {
    list: () => rpc('list_venue_holds'),
    options: () => rpc('venue_hold_options'),
    notifications: () => rpc('list_venue_hold_notifications'),
    create: values => rpc('create_venue_hold', { p_event_id: values.event_id, p_venue_id: values.venue_id,
      p_starts_at: values.starts_at, p_ends_at: values.ends_at, p_expires_at: values.expires_at }),
    change: (id, action) => rpc('change_venue_hold', { p_hold_id: id, p_action: action })
  };
}
