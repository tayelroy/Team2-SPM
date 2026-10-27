import { AccessError } from '../auth/policy';
import type { RegistrableVenue } from './registrableEvents';
import { createUserScopedClient } from './user-client';

/** Where a registration stands (SG2-62 AC1). */
export type RegistrationStanding = 'registered' | 'withdrawn' | 'event_cancelled' | 'event_started' | 'event_completed';
const STANDINGS = new Set<RegistrationStanding>(['registered', 'withdrawn', 'event_cancelled', 'event_started', 'event_completed']);

/** The attendee-facing details of the event a registration is for (SG2-59 AC3's fields). */
export interface MyRegistrationEvent {
  name: string;
  organisation: string | null;
  category: string | null;
  description: string | null;
  proposed_date: string | null;
  registration_closes_at: string | null;
  venues: RegistrableVenue[];
}

/** One of the caller's registrations (SG2-62 AC1). */
export interface MyRegistration {
  registration_id: number;
  event_id: number;
  standing: RegistrationStanding;
  /** Only an active registration for an event yet to start (AC2, AC4). */
  can_withdraw: boolean;
  registered_at: string | null;
  withdrawn_at: string | null;
  contact_phone: string | null;
  needs: string | null;
  event: MyRegistrationEvent;
}

/** The registration an attendee withdrew (SG2-62 AC2). */
export interface Withdrawal {
  registration_id: number;
  event_id: number;
  withdrawn_at: string;
}

/** What `public.withdraw_registration` did (SG2-62 AC2-AC4). */
export type WithdrawResult =
  | { outcome: 'ok'; withdrawal: Withdrawal }
  | { outcome: 'started'; proposed_date: string | null }
  /** missing: not the caller's; withdrawn: already; cancelled: the event was cancelled. */
  | { outcome: 'missing' | 'withdrawn' | 'cancelled' };

export interface MyRegistrationsStore {
  list(): Promise<MyRegistration[]>;
  withdraw(registrationId: number): Promise<WithdrawResult>;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

function registration(row: Row): MyRegistration | null {
  const event = isObject(row.event) ? row.event : null;
  if (typeof row.registration_id !== 'number' || typeof row.event_id !== 'number' || !event
    || !STANDINGS.has(row.standing as RegistrationStanding)) return null;
  return {
    registration_id: row.registration_id,
    event_id: row.event_id,
    standing: row.standing as RegistrationStanding,
    can_withdraw: row.can_withdraw === true,
    registered_at: text(row.registered_at),
    withdrawn_at: text(row.withdrawn_at),
    contact_phone: text(row.contact_phone),
    needs: text(row.needs),
    event: {
      name: text(event.name) ?? '',
      organisation: text(event.organisation),
      category: text(event.category),
      description: text(event.description),
      proposed_date: text(event.proposed_date),
      registration_closes_at: text(event.registration_closes_at),
      venues: Array.isArray(event.venues)
        ? event.venues.filter(isObject).map(venue => ({ name: text(venue.name) ?? 'Unnamed venue', location: text(venue.location) }))
        : []
    }
  };
}

function withdrawResult(data: unknown): WithdrawResult {
  if (!isObject(data)) throw new AccessError(503);
  switch (data.outcome) {
    case 'ok': {
      const row = isObject(data.registration) ? data.registration : null;
      if (row && typeof row.registration_id === 'number' && typeof row.event_id === 'number' && typeof row.withdrawn_at === 'string') {
        return { outcome: 'ok', withdrawal: { registration_id: row.registration_id, event_id: row.event_id, withdrawn_at: row.withdrawn_at } };
      }
      break;
    }
    case 'started':
      return { outcome: 'started', proposed_date: text(data.proposed_date) };
    case 'missing':
    case 'withdrawn':
    case 'cancelled':
      return { outcome: data.outcome };
  }
  throw new AccessError(503);
}

function failure(error: { code?: string }, status: number): AccessError {
  return new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
}

/**
 * Lists through `public.my_registrations` and withdraws through
 * `public.withdraw_registration` with the caller's JWT and acting role
 * (SG2-104), so the database checks the caller acts as an attendee and only
 * ever reads or changes their own registrations (SG2-62). The withdrawal
 * takes the event row lock that registering takes.
 */
export function createMyRegistrationsStore(token: string, makeClient = createUserScopedClient): MyRegistrationsStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async list() {
      const { data, error, status } = await client.rpc('my_registrations');
      if (error) throw failure(error, status);
      if (!Array.isArray(data)) throw new AccessError(503);
      return data.filter(isObject).map(registration).filter((row): row is MyRegistration => row !== null);
    },
    async withdraw(registrationId) {
      const { data, error, status } = await client.rpc('withdraw_registration', { p_registration_id: registrationId });
      if (error) throw failure(error, status);
      return withdrawResult(data);
    }
  };
}
