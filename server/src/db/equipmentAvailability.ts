import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

export interface AvailabilityPeriod { starts_at: string; ends_at: string }
export interface EquipmentAvailabilityReady extends AvailabilityPeriod {
  status: 'ready'; event_id: number; request_id: number; equipment_id: number; equipment_type: string;
  quantity_requested: number; quantity_held: number; quantity_committed: number; quantity_remaining: number;
  shortfall: number; undated_commitments: number; operational_status: 'operational' | 'damaged' | 'maintenance';
  period_source: 'request' | 'event_bookings' | 'chosen'; checked_at: string;
}
export interface EquipmentAvailabilityDatesRequired { status: 'dates_required'; proposed_start: string | null }
export type EquipmentAvailability = EquipmentAvailabilityReady | EquipmentAvailabilityDatesRequired;
export type EquipmentAvailabilityResult = ({ outcome: 'ok' } & Omit<EquipmentAvailabilityReady, 'status'>)
  | { outcome: 'dates_required'; proposed_start: string | null } | { outcome: 'missing' | 'invalid' };
export interface EquipmentAvailabilityStore {
  run(eventId: number, requestId: number, period?: AvailabilityPeriod): Promise<EquipmentAvailabilityResult>;
}

/** Read with the caller JWT. The RPC independently checks the current stored
 * role and computes one database snapshot without reserving any stock. */
export function createEquipmentAvailabilityStore(token: string, makeClient = createUserScopedClient): EquipmentAvailabilityStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async run(eventId, requestId, period) {
      const { data, error, status } = await client.rpc('check_equipment_availability', {
        p_event_id: eventId, p_request_id: requestId,
        p_starts_at: period?.starts_at ?? null, p_ends_at: period?.ends_at ?? null
      });
      if (error) throw new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
      if (!data || !['ok', 'dates_required', 'missing', 'invalid'].includes(data.outcome)) throw new AccessError(503);
      return data as EquipmentAvailabilityResult;
    }
  };
}
