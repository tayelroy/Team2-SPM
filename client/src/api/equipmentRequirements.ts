export interface EquipmentRequirement {
  request_id: number; event_id: number; equipment_id: number; equipment_type: string;
  quantity: number; notes: string | null; status: string; arrangement_notes: string | null;
  shortfall: number | null; placement_venue_id: number | null; placement_venue_name: string | null;
  placement_position: string | null; version: number;
}
export interface RequirementValues { equipment_id: number; quantity: number; notes: string | null }
export interface ArrangementValues {
  arrangement_notes: string | null; shortfall: number; placement_venue_id: number | null; placement_position: string | null;
}
export interface RequirementsView {
  event: { event_id: number; name: string | null; status: string };
  requests: EquipmentRequirement[];
  equipment: { equipment_id: number; type: string }[];
  venues: { venue_id: number; name: string }[];
  can_request: boolean; can_arrange: boolean;
}
export class EquipmentRequirementsError extends Error {
  constructor(public status: number) {
    const messages: Record<number, string> = {
      400: 'Check the equipment, quantities, notes and placement before saving.',
      401: 'Your session has expired. Sign in again.',
      403: 'You do not have permission to access or change these equipment requirements.',
      404: 'This event or equipment request is no longer available to you.',
      409: 'This request changed, is no longer editable, or duplicates existing equipment. Reload requirements before trying again.',
    };
    super(messages[status] ?? 'Unable to reach the equipment requirements service. Please try again.');
  }
}
async function request(path: string, token: string, signal: AbortSignal, mutation?: { method: string; body: object }): Promise<RequirementsView> {
  const response = await fetch(path, {
    cache: 'no-store', signal,
    headers: { Authorization: `Bearer ${token}`, ...(mutation ? { 'Content-Type': 'application/json' } : {}) },
    ...(mutation ? { method: mutation.method, body: JSON.stringify(mutation.body) } : {}),
  });
  if (!response.ok) throw new EquipmentRequirementsError(response.status);
  return response.json();
}
export function loadEquipmentRequirements(eventId: number, token: string, signal: AbortSignal): Promise<RequirementsView> {
  return request(`/api/equipment-requests?event_id=${eventId}`, token, signal);
}
export function saveEquipmentRequirement(eventId: number, token: string, signal: AbortSignal, values: RequirementValues, record: EquipmentRequirement | null): Promise<RequirementsView> {
  return request(record ? `/api/equipment-requests/${record.request_id}` : '/api/equipment-requests', token, signal, {
    method: record ? 'PATCH' : 'POST', body: { event_id: eventId, ...values, ...(record ? { version: record.version } : {}) },
  });
}
export function saveEquipmentArrangement(eventId: number, token: string, signal: AbortSignal, values: ArrangementValues, record: EquipmentRequirement): Promise<RequirementsView> {
  return request(`/api/equipment-requests/${record.request_id}/arrangement`, token, signal, {
    method: 'PATCH', body: { event_id: eventId, version: record.version, ...values },
  });
}
