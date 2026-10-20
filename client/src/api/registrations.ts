/** SG2-63: the registration picture for an event and its organiser's settings. */
import type { RegistrationWindow } from './eventConfirmation';

export interface RegisteredAttendee {
  registration_id: number;
  name: string;
  organisation: string | null;
  registered_at: string;
  /** Only for the creating organiser and the assigned coordinator (AC4). */
  email?: string | null;
  phone?: string | null;
}

export interface RegistrationView {
  event_id: number;
  status: string;
  registration_needed: boolean;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  window: RegistrationWindow;
  registered_count: number;
  places_remaining: number | null;
  contact_details_visible: boolean;
  attendees: RegisteredAttendee[];
  venues: { venue_id: number; name: string; capacity: number | null }[];
  capacity_warnings: string[];
  can_edit: boolean;
}

export interface RegistrationSettingsInput {
  registration_capacity?: number | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
}

export type RegistrationResult =
  | { ok: true; view: RegistrationView }
  | { ok: false; status: number; message: string; details: string[] };

const WINDOWS: readonly RegistrationWindow[] = ['not_required', 'not_confirmed', 'not_yet_open', 'open', 'closed'];
const UNREADABLE = 'Registrations could not be loaded. Please try again.';
const UNSAVED = 'Registration settings could not be saved. Please try again.';

const isText = (value: unknown): value is string => typeof value === 'string';
const isTextOrNull = (value: unknown) => value === null || isText(value);
const isCountOrNull = (value: unknown) => value === null || typeof value === 'number';

function isAttendee(value: unknown): value is RegisteredAttendee {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.registration_id === 'number' && isText(row.name) && isTextOrNull(row.organisation)
    && isText(row.registered_at) && (row.email === undefined || isTextOrNull(row.email))
    && (row.phone === undefined || isTextOrNull(row.phone));
}

/** The server's answer, checked field by field; null when it is not one. */
export function readRegistrationView(body: unknown): RegistrationView | null {
  if (typeof body !== 'object' || body === null) return null;
  const view = body as Record<string, unknown>;
  const valid = typeof view.event_id === 'number' && isText(view.status) && typeof view.registration_needed === 'boolean'
    && isCountOrNull(view.registration_capacity) && isTextOrNull(view.registration_opens_at)
    && isTextOrNull(view.registration_closes_at) && WINDOWS.includes(view.window as RegistrationWindow)
    && typeof view.registered_count === 'number' && isCountOrNull(view.places_remaining)
    && typeof view.contact_details_visible === 'boolean' && Array.isArray(view.attendees) && view.attendees.every(isAttendee)
    && Array.isArray(view.venues) && Array.isArray(view.capacity_warnings) && view.capacity_warnings.every(isText)
    && typeof view.can_edit === 'boolean';
  return valid ? view as unknown as RegistrationView : null;
}

async function send(url: string, init: RequestInit, fallback: string): Promise<RegistrationResult> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, message: fallback, details: [] };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const view = readRegistrationView(body);
    return view ? { ok: true, view } : { ok: false, status: response.status, message: fallback, details: [] };
  }
  const refusal = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {};
  return {
    ok: false,
    status: response.status,
    message: isText(refusal.error) ? refusal.error : fallback,
    details: Array.isArray(refusal.details) ? refusal.details.filter(isText) : []
  };
}

/** `GET /api/event-requests/:eventId/registrations` (AC1–AC4, AC7). */
export function fetchRegistrations(eventId: number, token: string, signal?: AbortSignal): Promise<RegistrationResult> {
  return send(`/api/event-requests/${eventId}/registrations`, { headers: { Authorization: `Bearer ${token}` }, signal }, UNREADABLE);
}

/** `PATCH /api/event-requests/:eventId/registration-settings` (AC5, AC6). */
export function saveRegistrationSettings(eventId: number, token: string, values: RegistrationSettingsInput): Promise<RegistrationResult> {
  return send(`/api/event-requests/${eventId}/registration-settings`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(values)
  }, UNSAVED);
}

/** `POST /api/event-requests/:eventId/registration-settings/close` (AC6). */
export function closeRegistrationNow(eventId: number, token: string): Promise<RegistrationResult> {
  return send(`/api/event-requests/${eventId}/registration-settings/close`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }
  }, UNSAVED);
}
