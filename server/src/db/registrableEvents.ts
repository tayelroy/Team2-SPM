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
  /** Whether the caller already holds an active registration (SG2-60 AC2). */
  registered: boolean;
}

/** What an attendee gives when registering (SG2-60 AC4), already validated. */
export interface RegistrationInput {
  contact_phone: string;
  needs: string | null;
}

/** The place an attendee now holds (SG2-60 AC1). */
export interface Registration {
  registration_id: number;
  event_id: number;
  registered_at: string;
  contact_phone: string;
  needs: string | null;
}

/** What `public.register_for_event` did (SG2-60 AC1-AC4). */
export type RegisterResult =
  | { outcome: 'ok'; registration: Registration }
  | { outcome: 'not_open'; registration_opens_at: string }
  | { outcome: 'closed'; registration_closes_at: string }
  /** missing: not an event an attendee may find; invalid: the database refused the details. */
  | { outcome: 'duplicate' | 'full' | 'missing' | 'invalid' };

export interface RegistrableEventsStore {
  list(): Promise<RegistrableEvent[]>;
  /** Null when the event is not one an attendee may find. */
  get(eventId: number): Promise<RegistrableEvent | null>;
  register(eventId: number, input: RegistrationInput): Promise<RegisterResult>;
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
      : [],
    registered: row.registered === true
  };
}

function registration(row: unknown): Registration | null {
  if (!isObject(row) || typeof row.registration_id !== 'number' || typeof row.event_id !== 'number'
    || typeof row.registered_at !== 'string' || typeof row.contact_phone !== 'string') return null;
  return { registration_id: row.registration_id, event_id: row.event_id, registered_at: row.registered_at,
    contact_phone: row.contact_phone, needs: text(row.needs) };
}

function registerResult(data: unknown): RegisterResult {
  if (!isObject(data)) throw new AccessError(503);
  switch (data.outcome) {
    case 'ok': {
      const created = registration(data.registration);
      if (created) return { outcome: 'ok', registration: created };
      break;
    }
    case 'not_open':
      if (typeof data.registration_opens_at === 'string') return { outcome: 'not_open', registration_opens_at: data.registration_opens_at };
      break;
    case 'closed':
      if (typeof data.registration_closes_at === 'string') return { outcome: 'closed', registration_closes_at: data.registration_closes_at };
      break;
    case 'duplicate':
    case 'full':
    case 'missing':
    case 'invalid':
      return { outcome: data.outcome };
  }
  throw new AccessError(503);
}

function failure(error: { code?: string }, status: number): AccessError {
  return new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
}

/**
 * Reads through `public.registrable_events` and `public.registrable_event`
 * with the caller's JWT and acting role (SG2-104), so the database checks the
 * caller acts as an attendee as well as the route does, and returns only the
 * events and fields an attendee may see (SG2-59 AC1-AC3). Registers through
 * `public.register_for_event` the same way (SG2-60), which decides the
 * window, duplicate and capacity under the event row lock.
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
    },
    async register(eventId, input) {
      const { data, error, status } = await client.rpc('register_for_event',
        { p_event_id: eventId, p_contact_phone: input.contact_phone, p_needs: input.needs });
      if (error) throw failure(error, status);
      return registerResult(data);
    }
  };
}
