/** SG2-67: the organiser asks for a cancellation; the assigned coordinator carries it out. */
export type CancellationOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

export interface CancellationRequested { requestedAt: string; coordinatorNotified: boolean }
export interface EventCancelled { cancelledAt: string; bookingsReleased: number; attendeesNotified: number }

const UNAVAILABLE = 'Cancellation is temporarily unavailable. Please try again.';

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

async function send<T>(url: string, init: RequestInit, refusedRole: string,
  parse: (body: Record<string, unknown>) => T | null): Promise<CancellationOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, message: refusedRole };
  const body = await readJson(response);
  if (response.ok) {
    const value = body ? parse(body) : null;
    return value ? { ok: true, value } : { ok: false, message: UNAVAILABLE };
  }
  if ([400, 404, 409].includes(response.status)) {
    return { ok: false, message: typeof body?.error === 'string' ? body.error : 'That cancellation was not accepted.' };
  }
  return { ok: false, message: UNAVAILABLE };
}

/** `POST /api/event-requests/:eventId/cancellation-request` (SG2-67 AC1). */
export function requestCancellation(eventId: number, reason: string, token: string): Promise<CancellationOutcome<CancellationRequested>> {
  return send(`/api/event-requests/${eventId}/cancellation-request`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  }, 'Only the organiser who created this event can ask to cancel it.', body =>
    typeof body.cancellation_requested_at === 'string' && typeof body.coordinator_notified === 'boolean'
      ? { requestedAt: body.cancellation_requested_at, coordinatorNotified: body.coordinator_notified }
      : null);
}

/** `PATCH /api/event-requests/:eventId/cancel` (SG2-67 AC1-AC4). */
export function cancelEvent(eventId: number, token: string): Promise<CancellationOutcome<EventCancelled>> {
  return send(`/api/event-requests/${eventId}/cancel`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` }
  }, 'Only the assigned Event Coordinator can cancel this event.', body =>
    typeof body.cancelled_at === 'string' && count(body.bookings_released) && count(body.attendees_notified)
      ? { cancelledAt: body.cancelled_at, bookingsReleased: body.bookings_released, attendeesNotified: body.attendees_notified }
      : null);
}
