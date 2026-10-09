import { AccessError } from '../../server/src/auth/policy';
import type { ArrangementValues, EquipmentRequirement, EquipmentRequirementsStore, RequirementValues, RequirementsView } from '../../server/src/db/equipmentRequirements';
import type { MemoryDatabase } from './memory-database';

/** Browser storage fixture only. PostgreSQL policy/race suites separately
 * verify the actual guarded RPC, locks and constraints. */
export function createMemoryRequirementsStore(database: MemoryDatabase, token: string): EquipmentRequirementsStore {
  return {
    async run(action, eventId, requestId, version, values) {
      const principal = await database.principal(token);
      const event = database.tables.events.find(row => row.event_id === eventId);
      const coordinator = principal.role === 'event_coordinator';
      const support = principal.role === 'technical_support_staff';
      if (!coordinator && !support && principal.role !== 'safety_officer') throw new AccessError(403);
      if (!event || (coordinator && event.coordinator_id !== principal.userId)) return { outcome: 'missing' };
      const editable = ['approved', 'planning'].includes(String(event.status));
      if (action !== 'read') {
        if ((action === 'arrange' && !support) || (action !== 'arrange' && !coordinator)) throw new AccessError(403);
        if (!editable) return { outcome: 'closed' };
        let record = database.tables.equipment_requests.find(row => row.request_id === requestId && row.event_id === eventId);
        if (action !== 'create') {
          if (!record) return { outcome: 'missing' };
          if (record.status !== 'pending') return { outcome: 'closed' };
          if (record.version !== version) return { outcome: 'conflict' };
        }
        if (action === 'arrange') {
          const arrangement = values as ArrangementValues;
          if (arrangement.shortfall > Number(record!.quantity)) return { outcome: 'invalid' };
          if (arrangement.placement_venue_id !== null && !database.tables.venues.some(venue => venue.venue_id === arrangement.placement_venue_id)) return { outcome: 'invalid' };
          Object.assign(record!, arrangement, { version: Number(record!.version) + 1 });
        } else {
          const requirement = values as RequirementValues;
          if (!database.tables.equipment.some(item => item.equipment_id === requirement.equipment_id)) return { outcome: 'invalid' };
          if (database.tables.equipment_requests.some(row => row.event_id === eventId && row.equipment_id === requirement.equipment_id
            && row.status === 'pending' && row.request_id !== requestId)) return { outcome: 'duplicate' };
          const reset = { arrangement_notes: null, shortfall: null, placement_venue_id: null, placement_position: null };
          if (action === 'create') {
            record = { ...requirement, ...reset, request_id: Math.max(0, ...database.tables.equipment_requests.map(row => Number(row.request_id))) + 1,
              event_id: eventId, status: 'pending', starts_at: null, ends_at: null, version: 1 };
            database.tables.equipment_requests.push(record);
          } else Object.assign(record!, requirement, reset, { version: Number(record!.version) + 1 });
        }
      }
      const requests: EquipmentRequirement[] = database.tables.equipment_requests.filter(row => row.event_id === eventId)
        .sort((left, right) => Number(left.request_id) - Number(right.request_id)).map(row => ({
          request_id: Number(row.request_id), event_id: eventId, equipment_id: Number(row.equipment_id),
          equipment_type: String(database.tables.equipment.find(item => item.equipment_id === row.equipment_id)!.name),
          quantity: Number(row.quantity), notes: row.notes as string | null, status: String(row.status),
          arrangement_notes: (row.arrangement_notes ?? null) as string | null, shortfall: (row.shortfall ?? null) as number | null,
          placement_venue_id: (row.placement_venue_id ?? null) as number | null,
          placement_venue_name: database.tables.venues.find(venue => venue.venue_id === row.placement_venue_id)?.name as string | undefined ?? null,
          placement_position: (row.placement_position ?? null) as string | null, version: Number(row.version ?? 1),
        }));
      const view: RequirementsView = {
        event: { event_id: eventId, name: event.name as string | null, status: String(event.status) }, requests,
        equipment: database.tables.equipment.map(row => ({ equipment_id: Number(row.equipment_id), type: String(row.name) })),
        venues: database.tables.venues.map(row => ({ venue_id: Number(row.venue_id), name: String(row.name) })),
        can_request: coordinator && editable, can_arrange: support && editable,
      };
      return { outcome: 'ok', ...view };
    },
  };
}
