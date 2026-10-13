import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

/** What withdraw_venue_booking_request() reports (SG2-82). */
export type WithdrawalResult =
  | { outcome: 'withdrawn'; request_id: number; withdrawn_at: string }
  | { outcome: 'inactive'; status: string }
  | { outcome: 'hold'; hold_id: number }
  | { outcome: 'missing' };

export interface VenueBookingWithdrawalStore {
  withdraw(requestId: number): Promise<WithdrawalResult>;
}

/**
 * Withdraws with the caller's own token, so the database records the
 * coordinator who withdrew the request and checks the event is theirs. The
 * withdrawal and its history entry commit together under the request lock.
 */
export function createVenueBookingWithdrawalStore(token: string, makeClient = createUserScopedClient): VenueBookingWithdrawalStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async withdraw(requestId) {
      const { data, error, status } = await client.rpc('withdraw_venue_booking_request', { p_request_id: requestId });
      if (error || data === null) throw new AccessError(status === 401 ? 401 : status === 403 || error?.code === '42501' ? 403 : 503);
      return data as WithdrawalResult;
    }
  };
}
