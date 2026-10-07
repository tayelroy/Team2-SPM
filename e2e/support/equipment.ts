import type { EquipmentStore } from '../../server/src/db/equipment';
import type { EquipmentRecord, EquipmentValues } from '../../server/src/equipment/fields';
import type { MemoryDatabase } from './memory-database';

/** Disposable storage boundary for browser journeys. SQL tests separately
 * establish generated availability, RLS and atomic version updates in Postgres. */
export function createMemoryEquipmentStore(database: MemoryDatabase): EquipmentStore {
  const record = (row: Record<string, unknown>): EquipmentRecord => ({
    equipment_id: row.equipment_id as number, type: row.name as string,
    description: row.description as string, quantity_held: row.quantity_total as number,
    location: row.location as string, operational_status: row.operational_status as EquipmentRecord['operational_status'],
    available_quantity: row.operational_status === 'operational' ? row.quantity_total as number : 0,
    version: row.version as number,
  });
  const stored = (values: EquipmentValues) => ({ name: values.type, description: values.description,
    quantity_total: values.quantity_held, location: values.location, operational_status: values.operational_status });
  return {
    async list() {
      return database.tables.equipment.map(record).sort((left, right) =>
        left.type.localeCompare(right.type) || left.equipment_id - right.equipment_id);
    },
    async create(values) {
      const equipment_id = Math.max(0, ...database.tables.equipment.map(row => row.equipment_id as number)) + 1;
      const row = { equipment_id, ...stored(values), version: 1 };
      database.tables.equipment.push(row);
      return record(row);
    },
    async update(id, version, values) {
      const row = database.tables.equipment.find(row => row.equipment_id === id && row.version === version);
      if (!row) return null;
      Object.assign(row, stored(values), { version: version + 1 });
      return record(row);
    },
  };
}
