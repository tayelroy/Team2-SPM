export interface AvailabilityPeriod { starts_at: string; ends_at: string }
export interface AvailabilityReady extends AvailabilityPeriod {
  status: 'ready'; event_id: number; request_id: number; equipment_id: number; equipment_type: string;
  quantity_requested: number; quantity_held: number; quantity_committed: number; quantity_remaining: number;
  shortfall: number; undated_commitments: number; operational_status: 'operational' | 'damaged' | 'maintenance';
  period_source: 'request' | 'event_bookings' | 'chosen'; checked_at: string;
}
export type EquipmentAvailability = AvailabilityReady | { status: 'dates_required'; proposed_start: string | null };
export class EquipmentAvailabilityError extends Error {
  constructor(public status: number) {
    const messages: Record<number, string> = {
      400: 'Choose a valid start and end, with the end after the start.',
      401: 'Your session has expired. Sign in again.',
      403: 'Only Technical Support Staff can check equipment availability.',
      404: 'This event or equipment request is no longer available.',
    };
    super(messages[status] ?? 'Equipment availability is unavailable. Please try again.');
  }
}
export async function loadEquipmentAvailability(eventId: number, requestId: number, token: string, signal: AbortSignal, period?: AvailabilityPeriod): Promise<EquipmentAvailability> {
  const query = new URLSearchParams({ event_id: String(eventId) });
  if (period) { query.set('starts_at', period.starts_at); query.set('ends_at', period.ends_at); }
  const response = await fetch(`/api/equipment-requests/${requestId}/availability?${query}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal,
  });
  if (!response.ok) throw new EquipmentAvailabilityError(response.status);
  return response.json();
}
