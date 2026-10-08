import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

export interface EquipmentRequirement {
  request_id: number; event_id: number; equipment_id: number; equipment_type: string;
  quantity: number; notes: string | null; status: string; arrangement_notes: string | null;
  shortfall: number | null; placement_venue_id: number | null; placement_venue_name: string | null;
  placement_position: string | null; version: number;
}
export interface RequirementValues { equipment_id: number; quantity: number; notes: string | null }
export interface ArrangementValues {
  arrangement_notes: string | null; shortfall: number;
  placement_venue_id: number | null; placement_position: string | null;
}
export interface RequirementsView {
  event: { event_id: number; name: string | null; status: string };
  requests: EquipmentRequirement[];
  equipment: { equipment_id: number; type: string }[];
  venues: { venue_id: number; name: string }[];
  can_request: boolean; can_arrange: boolean;
}
export type RequirementsAction = 'read' | 'create' | 'amend' | 'arrange';
export type RequirementsResult = ({ outcome: 'ok' } & RequirementsView)
  | { outcome: 'missing' | 'closed' | 'conflict' | 'duplicate' | 'invalid' };
export interface EquipmentRequirementsStore {
  run(action: RequirementsAction, eventId: number, requestId?: number, version?: number,
    values?: RequirementValues | ArrangementValues): Promise<RequirementsResult>;
}

/** The caller's JWT reaches the transactional RPC, which rechecks role,
 * event assignment and record version under database locks. */
export function createEquipmentRequirementsStore(token: string, makeClient = createUserScopedClient): EquipmentRequirementsStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async run(action, eventId, requestId, version, values) {
      const { data, error, status } = await client.rpc('manage_equipment_requirements', {
        p_action: action, p_event_id: eventId, p_request_id: requestId ?? null,
        p_version: version ?? null, p_values: values ?? null
      });
      if (error) throw new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
      if (!data || !['ok', 'missing', 'closed', 'conflict', 'duplicate', 'invalid'].includes(data.outcome)) throw new AccessError(503);
      return data as RequirementsResult;
    }
  };
}
