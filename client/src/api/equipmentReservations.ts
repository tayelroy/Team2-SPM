export interface EquipmentReservation {
  reservation_id: number; event_id: number; request_id: number | null; equipment_id: number; equipment_type: string;
  quantity_reserved: number; starts_at: string | null; ends_at: string | null; reserved_at: string | null;
}
export interface ReservationsView { reservations: EquipmentReservation[]; can_reserve: boolean; coordinator_notified?: boolean }
export interface ReservationValues { version: number; starts_at: string; ends_at: string }
export class EquipmentReservationsError extends Error {
  constructor(public status: number, code?: string) {
    const messages: Record<number, string> = {
      400: 'Choose a valid reservation period, with the end after the start.',
      401: 'Your session has expired. Sign in again.',
      403: 'You do not have permission to view or reserve equipment for this event.',
      404: 'This event or equipment request is no longer available to you.',
      409: code === 'insufficient'
        ? 'There is not enough available equipment for these dates. Refresh reservations and requirements before trying again.'
        : 'The request, event or reservation changed. Refresh reservations and requirements before trying again.',
    };
    super(messages[status] ?? 'Equipment reservations are unavailable. Please try again.');
  }
}
async function request(path: string, token: string, signal: AbortSignal, values?: object): Promise<ReservationsView> {
  const response = await fetch(path, {
    cache: 'no-store', signal,
    headers: { Authorization: `Bearer ${token}`, ...(values ? { 'Content-Type': 'application/json' } : {}) },
    ...(values ? { method: 'POST', body: JSON.stringify(values) } : {}),
  });
  if (!response.ok) {
    // Only a known reason code affects public copy; server diagnostics are never displayed.
    const body = await response.json().catch(() => null);
    throw new EquipmentReservationsError(response.status, body?.code);
  }
  return response.json();
}
export function loadEquipmentReservations(eventId: number, token: string, signal: AbortSignal): Promise<ReservationsView> {
  return request(`/api/equipment-reservations?event_id=${eventId}`, token, signal);
}
export function reserveEquipment(eventId: number, requestId: number, token: string, signal: AbortSignal, values: ReservationValues): Promise<ReservationsView> {
  return request(`/api/equipment-requests/${requestId}/reservation`, token, signal, { event_id: eventId, ...values });
}
