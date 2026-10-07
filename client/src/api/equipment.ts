export type OperationalStatus = 'operational' | 'damaged' | 'maintenance';
export interface EquipmentValues {
  type: string;
  description: string;
  quantity_held: number;
  location: string;
  operational_status: OperationalStatus;
}
export interface EquipmentRecord extends EquipmentValues {
  equipment_id: number;
  available_quantity: number;
  version: number;
}
export const STATUS_LABELS: Record<OperationalStatus, string> = {
  operational: 'Operational', damaged: 'Damaged', maintenance: 'Under maintenance',
};
export class EquipmentError extends Error {
  constructor(public status: number) {
    const messages: Record<number, string> = {
      400: 'Complete every field and enter a valid whole-number quantity.',
      401: 'Your session has expired. Sign in again.',
      403: 'Only Technical Support Staff can maintain equipment records.',
      409: 'This record changed while you were editing. Reload records before editing again.',
    };
    super(messages[status] ?? 'Unable to reach the equipment service. Please try again.');
  }
}
export async function listEquipment(token: string, signal: AbortSignal): Promise<EquipmentRecord[]> {
  const response = await fetch('/api/equipment', {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal,
  });
  if (!response.ok) throw new EquipmentError(response.status);
  return (await response.json()).equipment;
}
export async function saveEquipment(token: string, signal: AbortSignal, values: EquipmentValues, record: EquipmentRecord | null): Promise<EquipmentRecord> {
  const response = await fetch(record ? `/api/equipment/${record.equipment_id}` : '/api/equipment', {
    method: record ? 'PATCH' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store', signal,
    body: JSON.stringify(record ? { ...values, version: record.version } : values),
  });
  if (!response.ok) throw new EquipmentError(response.status);
  return (await response.json()).equipment;
}
