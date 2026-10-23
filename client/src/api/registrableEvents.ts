/**
 * SG2-59: the events an attendee can register for. Mirrors
 * server/src/registrableEvents and server/src/db/registrableEvents.ts.
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
}

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
