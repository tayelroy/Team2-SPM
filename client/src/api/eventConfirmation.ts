/** SG2-58: confirming an event and reading its confirmed arrangements. */
export type ArrangementKey = 'venue' | 'equipment' | 'registration';

export const ARRANGEMENT_LABELS: Record<ArrangementKey, string> = {
  venue: 'Venue booking', equipment: 'Equipment', registration: 'Registration',
};

export type ConfirmEventOutcome =
  | { ok: true; confirmedAt: string; organiserNotified: boolean }
  | { ok: false; kind: 'outstanding'; message: string; outstanding: ArrangementKey[] }
  | { ok: false; kind: 'refused'; message: string }
  | { ok: false; kind: 'unauthorized'; message: 'Only the assigned Event Coordinator can confirm this event.' }
  | { ok: false; kind: 'unavailable'; message: 'Could not confirm the event. Please try again.' };

const UNAVAILABLE = { ok: false, kind: 'unavailable', message: 'Could not confirm the event. Please try again.' } as const;
const OUTSTANDING = 'Confirmation refused: arrangements are still outstanding.';
const isKey = (value: unknown): value is ArrangementKey => value === 'venue' || value === 'equipment' || value === 'registration';

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === 'object' && body !== null ? body as Record<string, unknown> : null;
}

/**
 * `PATCH /api/event-requests/:eventId/confirm`. The server re-checks status,
 * ownership and every arrangement under the event lock, so its refusal text
 * is shown verbatim and an outstanding list keeps the server's order.
 */
export async function confirmEvent(eventId: number, token: string): Promise<ConfirmEventOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/event-requests/${eventId}/confirm`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return UNAVAILABLE;
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: 'unauthorized', message: 'Only the assigned Event Coordinator can confirm this event.' };
  }
  const body = await readJson(response);
  if (response.ok) {
    return typeof body?.confirmed_at === 'string' && typeof body.organiser_notified === 'boolean'
      ? { ok: true, confirmedAt: body.confirmed_at, organiserNotified: body.organiser_notified }
      : UNAVAILABLE;
  }
  const message = typeof body?.error === 'string' ? body.error : null;
  if (response.status === 409 && body?.code === 'outstanding') {
    const listed = Array.isArray(body.outstanding) ? body.outstanding : [];
    return { ok: false, kind: 'outstanding', message: message ?? OUTSTANDING, outstanding: listed.filter(isKey) };
  }
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    return { ok: false, kind: 'refused', message: message ?? 'That change was not accepted.' };
  }
  return UNAVAILABLE;
}

export type RegistrationWindow = 'not_required' | 'not_confirmed' | 'not_yet_open' | 'open' | 'closed';
export interface ConfirmedVenue { venue_name: string; starts_at: string; ends_at: string }
export interface ConfirmedEquipment { equipment_type: string; quantity_reserved: number }
export interface ConfirmationView {
  event_id: number;
  status: 'confirmed' | 'completed';
  confirmed_at: string | null;
  venues: ConfirmedVenue[];
  equipment: ConfirmedEquipment[];
  registration: { needed: boolean; capacity: number | null; opens_at: string | null; closes_at: string | null; window: RegistrationWindow };
}

/** `status` is the HTTP status, or 0 when a 200 body was not a confirmation view. */
export class EventConfirmationError extends Error {
  constructor(public status: number) {
    super('Confirmed arrangements could not be loaded. Please try again.');
  }
}

const WINDOWS: readonly unknown[] = ['not_required', 'not_confirmed', 'not_yet_open', 'open', 'closed'];
const isText = (value: unknown): value is string => typeof value === 'string';
const isOptionalText = (value: unknown) => value === null || isText(value);
const isVenue = (value: unknown) => {
  const entry = value as ConfirmedVenue | null;
  return isText(entry?.venue_name) && isText(entry.starts_at) && isText(entry.ends_at);
};
const isEquipment = (value: unknown) => {
  const entry = value as ConfirmedEquipment | null;
  return isText(entry?.equipment_type) && Number.isInteger(entry.quantity_reserved);
};

function isView(value: Record<string, unknown> | null): value is Record<string, unknown> & ConfirmationView {
  const registration = value?.registration as ConfirmationView['registration'] | null | undefined;
  return typeof value?.event_id === 'number' && (value.status === 'confirmed' || value.status === 'completed')
    && isOptionalText(value.confirmed_at)
    && Array.isArray(value.venues) && value.venues.every(isVenue)
    && Array.isArray(value.equipment) && value.equipment.every(isEquipment)
    && typeof registration?.needed === 'boolean'
    && (registration.capacity === null || Number.isInteger(registration.capacity))
    && isOptionalText(registration.opens_at) && isOptionalText(registration.closes_at)
    && WINDOWS.includes(registration.window);
}

/** `GET /api/event-requests/:eventId/confirmation`; a 404 means there is nothing to show this caller. */
export async function loadEventConfirmation(eventId: number, token: string, signal?: AbortSignal): Promise<ConfirmationView> {
  const response = await fetch(`/api/event-requests/${eventId}/confirmation`, {
    cache: 'no-store', signal, headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new EventConfirmationError(response.status);
  const body = await readJson(response);
  if (!isView(body)) throw new EventConfirmationError(0);
  return body;
}
