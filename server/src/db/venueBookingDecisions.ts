import type { SupabaseClient } from '@supabase/supabase-js';
import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

export type Decision = 'approve' | 'reject';

/** What decide_venue_booking_request() reports (SG2-49). */
export type DecisionResult =
  | { outcome: 'updated'; request_id: number; status: 'approved' | 'rejected'; venue_booking_id: number | null; decided_at: string }
  | { outcome: 'conflict'; kind: 'booking' | 'block' | 'hold'; starts_at: string; ends_at: string; label: string }
  | { outcome: 'decided'; status: string }
  | { outcome: 'hold'; hold_id: number }
  | { outcome: 'missing' | 'invalid' | 'closed' | 'capacity' };

export interface VenueBookingDecisionStore {
  decide(requestId: number, decision: Decision, reason: string | null): Promise<DecisionResult>;
}

/**
 * Decides with the caller's own token, so the database records the Venue
 * Staff member who decided. The decision, the booking it creates, the
 * history entry and the notification commit together under the venue lock.
 */
export function createVenueBookingDecisionStore(token: string, makeClient = createUserScopedClient): VenueBookingDecisionStore {
  const client: SupabaseClient | null = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async decide(requestId, decision, reason) {
      const { data, error, status } = await client.rpc('decide_venue_booking_request',
        { p_request_id: requestId, p_decision: decision, p_reason: reason });
      if (error || data === null) throw new AccessError(status === 401 ? 401 : status === 403 || error?.code === '42501' ? 403 : 503);
      return data as DecisionResult;
    }
  };
}
