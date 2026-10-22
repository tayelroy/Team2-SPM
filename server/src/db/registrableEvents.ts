import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

/** A venue an event is confirmed at, as an attendee sees it (SG2-59 AC1). */
export interface RegistrableVenue {
  name: string;
  location: string | null;
}

/**
 * A confirmed event an attendee can register for now or later (SG2-59 AC1),
 * with only its attendee-facing details (AC3).
 */
export interface RegistrableEvent {
  event_id: number;
  name: string;
  organisation: string | null;
  category: string | null;
  description: string | null;
  proposed_date: string | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  venues: RegistrableVenue[];
}

export interface RegistrableEventsStore {
  list(): Promise<RegistrableEvent[]>;
  /** Null when the event is not one an attendee may find. */
  get(eventId: number): Promise<RegistrableEvent | null>;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

function event(row: Row): RegistrableEvent {
  return {
    event_id: Number(row.event_id),
    name: text(row.name) ?? '',
    organisation: text(row.organisation),
    category: text(row.category),
    description: text(row.description),
    proposed_date: text(row.proposed_date),
    registration_opens_at: text(row.registration_opens_at),
    registration_closes_at: text(row.registration_closes_at),
    venues: Array.isArray(row.venues)
      ? row.venues.filter(isObject).map(venue => ({ name: text(venue.name) ?? 'Unnamed venue', location: text(venue.location) }))
      : []
  };
}

function failure(error: { code?: string }, status: number): AccessError {
  return new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
}

/**
 * Reads through `public.registrable_events` and `public.registrable_event`
 * with the caller's JWT and acting role (SG2-104), so the database checks the
 * caller acts as an attendee as well as the route does, and returns only the
 * events and fields an attendee may see (SG2-59 AC1-AC3).
 */
export function createRegistrableEventsStore(token: string, makeClient = createUserScopedClient): RegistrableEventsStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async list() {
      const { data, error, status } = await client.rpc('registrable_events');
      if (error) throw failure(error, status);
      if (!Array.isArray(data)) throw new AccessError(503);
      return data.filter(isObject).map(event);
    },
    async get(eventId) {
      const { data, error, status } = await client.rpc('registrable_event', { p_event_id: eventId });
      if (error) throw failure(error, status);
      if (data === null) return null;
      if (!isObject(data)) throw new AccessError(503);
      return event(data);
    }
  };
}
