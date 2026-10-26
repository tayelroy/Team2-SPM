/**
 * SG2-59: the events an attendee can register for, and SG2-60: registering.
 * Mirrors server/src/registrableEvents and server/src/db/registrableEvents.ts.
 */

export interface RegistrableVenue {
  name: string;
  location: string | null;
}

/** A confirmed event open, or opening later, for registration (AC1), attendee-facing fields only (AC3). */
export interface RegistrableEvent {
  eventId: number;
  name: string;
  organisation: string | null;
  category: string | null;
  description: string | null;
  proposedDate: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  venues: RegistrableVenue[];
  /** The attendee already holds a place (SG2-60 AC2). */
  registered: boolean;
}

/** What the attendee gives when registering (SG2-60 AC4). */
export interface RegistrationDetails {
  contactPhone: string;
  needs: string;
}

/** The place the attendee now holds (SG2-60 AC1). */
export interface HeldRegistration {
  registrationId: number;
  registeredAt: string;
}

export type RegisterResult =
  | { ok: true; registration: HeldRegistration }
  /** AC1-AC3: refused for a reason the attendee is told; `message` says why. */
  | { ok: false; kind: 'duplicate' | 'full' | 'not_open' | 'closed'; message: string }
  /** AC4: the details need fixing; `errors` lists what the server found. */
  | { ok: false; kind: 'invalid'; message: string; errors: string[] }
  | { ok: false; kind: 'unauthorized' | 'unavailable' | 'not_found' };

export type FetchRegistrableEventsResult =
  | { ok: true; events: RegistrableEvent[] }
  | { ok: false; kind: 'unauthorized' | 'unavailable' };

export type FetchRegistrableEventResult =
  | { ok: true; event: RegistrableEvent }
  | { ok: false; kind: 'unauthorized' | 'unavailable' | 'not_found' };

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

function toEvent(raw: Raw): RegistrableEvent {
  return {
    eventId: Number(raw.event_id) || 0,
    name: text(raw.name) ?? '',
    organisation: text(raw.organisation),
    category: text(raw.category),
    description: text(raw.description),
    proposedDate: text(raw.proposed_date),
    registrationOpensAt: text(raw.registration_opens_at),
    registrationClosesAt: text(raw.registration_closes_at),
    venues: Array.isArray(raw.venues)
      ? raw.venues.filter(isObject).map((venue) => ({ name: text(venue.name) ?? 'Unnamed venue', location: text(venue.location) }))
      : [],
    registered: raw.registered === true,
  };
}

async function get(path: string, token: string): Promise<Response | null> {
  try {
    return await fetch(path, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return null;
  }
}

/** GET /api/registrable-events — attendees only. */
export async function fetchRegistrableEvents(token: string): Promise<FetchRegistrableEventsResult> {
  const response = await get('/api/registrable-events', token);
  if (!response) return { ok: false, kind: 'unavailable' };
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  if (!response.ok || !Array.isArray(data.events)) return { ok: false, kind: 'unavailable' };
  return { ok: true, events: data.events.filter(isObject).map(toEvent) };
}

/** GET /api/registrable-events/:eventId — 404 when the event is not one an attendee may open. */
export async function fetchRegistrableEvent(eventId: number, token: string): Promise<FetchRegistrableEventResult> {
  const response = await get(`/api/registrable-events/${eventId}`, token);
  if (!response) return { ok: false, kind: 'unavailable' };
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  if (response.status === 404) return { ok: false, kind: 'not_found' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  if (!response.ok || !isObject(data.event)) return { ok: false, kind: 'unavailable' };
  return { ok: true, event: toEvent(data.event) };
}

const REFUSALS = ['duplicate', 'full', 'not_open', 'closed'] as const;

/**
 * POST /api/registrable-events/:eventId/registrations (SG2-60). Blank needs
 * are sent as none; the server trims and validates both fields again.
 */
export async function registerForEvent(eventId: number, details: RegistrationDetails, token: string): Promise<RegisterResult> {
  let response: Response;
  try {
    response = await fetch(`/api/registrable-events/${eventId}/registrations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_phone: details.contactPhone, needs: details.needs.trim() === '' ? null : details.needs }),
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  if (response.status === 404) return { ok: false, kind: 'not_found' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  const message = text(data.error);
  if (response.status === 201 && isObject(data.registration) && typeof data.registration.registration_id === 'number'
    && typeof data.registration.registered_at === 'string') {
    return { ok: true, registration: { registrationId: data.registration.registration_id, registeredAt: data.registration.registered_at } };
  }
  if (response.status === 409 && message && (REFUSALS as readonly unknown[]).includes(data.reason)) {
    return { ok: false, kind: data.reason as (typeof REFUSALS)[number], message };
  }
  if (response.status === 400 && message) {
    return { ok: false, kind: 'invalid', message, errors: Array.isArray(data.errors) ? data.errors.filter((e): e is string => typeof e === 'string') : [] };
  }
  return { ok: false, kind: 'unavailable' };
}
