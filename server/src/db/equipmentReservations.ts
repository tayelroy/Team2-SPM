import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';
import type { AvailabilityPeriod } from './equipmentAvailability';

export interface EquipmentReservation {
  reservation_id: number; event_id: number; request_id: number | null;
  equipment_id: number; equipment_type: string; quantity_reserved: number;
  starts_at: string | null; ends_at: string | null; reserved_at: string | null;
}
export interface ReservationsView {
  reservations: EquipmentReservation[]; can_reserve: boolean; coordinator_notified?: boolean;
}
export type ReservationsAction = 'read' | 'reserve';
export type ReservationsResult = ({ outcome: 'ok' } & ReservationsView)
  | { outcome: 'missing' | 'invalid' | 'closed' | 'conflict' | 'insufficient' };
export interface EquipmentReservationsStore {
  run(action: ReservationsAction, eventId: number, requestId?: number, version?: number,
    period?: AvailabilityPeriod): Promise<ReservationsResult>;
}

/** The caller JWT reaches one transaction that locks stock and the request,
 * rechecks the stored role, and commits the receipt and notice together. */
export function createEquipmentReservationsStore(token: string, makeClient = createUserScopedClient): EquipmentReservationsStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async run(action, eventId, requestId, version, period) {
      const { data, error, status } = await client.rpc('manage_equipment_reservations', {
        p_action: action, p_event_id: eventId, p_request_id: requestId ?? null,
        p_version: version ?? null, p_starts_at: period?.starts_at ?? null, p_ends_at: period?.ends_at ?? null
      });
      if (error) throw new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
      if (!data || !['ok', 'missing', 'invalid', 'closed', 'conflict', 'insufficient'].includes(data.outcome)) throw new AccessError(503);
      return data as ReservationsResult;
    }
  };
}
