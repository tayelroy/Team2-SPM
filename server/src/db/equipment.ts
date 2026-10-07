import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';
import type { EquipmentRecord, EquipmentValues } from '../equipment/fields';

// Keep the original columns used by the internal equipment request queue.
const COLUMNS = 'equipment_id,type:name,description,quantity_held:quantity_total,location,operational_status,available_quantity,version';
export interface EquipmentStore {
  list(): Promise<EquipmentRecord[]>;
  create(values: EquipmentValues): Promise<EquipmentRecord | null>;
  update(id: number, version: number, values: EquipmentValues): Promise<EquipmentRecord | null>;
}

/** RLS and column grants protect the same writes as the route guards. The
 * version predicate is atomic: a stale editor never overwrites a newer save. */
export function createEquipmentStore(token: string, makeClient = createUserScopedClient): EquipmentStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  function check(error: { code?: string } | null, status: number) {
    if (error) throw new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
  }
  function stored(values: EquipmentValues) {
    return { name: values.type, description: values.description, quantity_total: values.quantity_held,
      location: values.location, operational_status: values.operational_status };
  }
  return {
    async list() {
      const equipment: EquipmentRecord[] = [];
      // Supabase caps each response at 1,000 rows; continue until the complete
      // catalogue is loaded, with a unique stable order between pages.
      let hasMore: boolean;
      do {
        const offset = equipment.length;
        const { data, error, status } = await client.from('equipment').select(COLUMNS)
          .order('name').order('equipment_id').range(offset, offset + 999);
        check(error, status);
        if (data === null) throw new AccessError(503);
        equipment.push(...(data as EquipmentRecord[]));
        hasMore = data.length === 1000;
      } while (hasMore);
      return equipment;
    },
    async create(values) {
      const { data, error, status } = await client.from('equipment').insert(stored(values)).select(COLUMNS).maybeSingle();
      check(error, status);
      return data as EquipmentRecord | null;
    },
    async update(id, version, values) {
      const { data, error, status } = await client.from('equipment').update(stored(values))
        .eq('equipment_id', id).eq('version', version).select(COLUMNS).maybeSingle();
      check(error, status);
      return data as EquipmentRecord | null;
    }
  };
}
