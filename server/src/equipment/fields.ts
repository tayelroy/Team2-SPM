export const EQUIPMENT_STATUSES = ['operational', 'damaged', 'maintenance'] as const;
export type EquipmentStatus = typeof EQUIPMENT_STATUSES[number];
export interface EquipmentValues {
  type: string;
  description: string;
  quantity_held: number;
  location: string;
  operational_status: EquipmentStatus;
}
export interface EquipmentRecord extends EquipmentValues {
  equipment_id: number;
  available_quantity: number;
  version: number;
}

/** Create and edit send all five fields; only these fields reach storage. */
export function validateEquipment(input: unknown): EquipmentValues | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const text = ['type', 'description', 'location'] as const;
  if (!text.every(field => typeof body[field] === 'string' && (body[field] as string).trim())) return null;
  if (Array.from((body.type as string).trim()).length > 255
      || Array.from((body.description as string).trim()).length > 2000
      || Array.from((body.location as string).trim()).length > 2000) return null;
  if (!Number.isInteger(body.quantity_held) || (body.quantity_held as number) < 0
      || (body.quantity_held as number) > 2147483647) return null;
  if (!EQUIPMENT_STATUSES.includes(body.operational_status as EquipmentStatus)) return null;
  return {
    type: (body.type as string).trim(), description: (body.description as string).trim(),
    quantity_held: body.quantity_held as number, location: (body.location as string).trim(),
    operational_status: body.operational_status as EquipmentStatus
  };
}
