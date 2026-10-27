/**
 * SG2-62: an attendee's own registrations, and withdrawing one.
 * Mirrors server/src/myRegistrations and server/src/db/myRegistrations.ts.
 */
import type { RegistrableVenue } from './registrableEvents';

/** Where a registration stands (AC1). */
export type RegistrationStanding = 'registered' | 'withdrawn' | 'event_cancelled' | 'event_started' | 'event_completed';
const STANDINGS: readonly string[] = ['registered', 'withdrawn', 'event_cancelled', 'event_started', 'event_completed'];

/** One of the attendee's registrations with the event's attendee-facing details (AC1). */
export interface MyRegistration {
  registrationId: number;
  eventId: number;
  standing: RegistrationStanding;
  /** Only an active registration for an event yet to start (AC2, AC4). */
  canWithdraw: boolean;
  registeredAt: string | null;
  withdrawnAt: string | null;
  contactPhone: string | null;
  needs: string | null;
  event: {
    name: string;
    organisation: string | null;
    category: string | null;
    description: string | null;
    proposedDate: string | null;
    registrationClosesAt: string | null;
    venues: RegistrableVenue[];
  };
}

export type FetchMyRegistrationsResult =
  | { ok: true; registrations: MyRegistration[] }
  | { ok: false; kind: 'unauthorized' | 'unavailable' };

export type WithdrawResult =
  | { ok: true; withdrawnAt: string }
  /** AC2, AC4: refused for a reason the attendee is told; `message` says why. */
  | { ok: false; kind: 'started' | 'withdrawn' | 'cancelled'; message: string }
  | { ok: false; kind: 'unauthorized' | 'unavailable' | 'not_found' };

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

function toRegistration(raw: Raw): MyRegistration | null {
  const event = isObject(raw.event) ? raw.event : null;
  if (typeof raw.registration_id !== 'number' || typeof raw.event_id !== 'number' || !event || !STANDINGS.includes(raw.standing as string)) {
    return null;
  }
  return {
    registrationId: raw.registration_id,
    eventId: raw.event_id,
    standing: raw.standing as RegistrationStanding,
    canWithdraw: raw.can_withdraw === true,
    registeredAt: text(raw.registered_at),
    withdrawnAt: text(raw.withdrawn_at),
    contactPhone: text(raw.contact_phone),
    needs: text(raw.needs),
    event: {
      name: text(event.name) ?? '',
      organisation: text(event.organisation),
      category: text(event.category),
      description: text(event.description),
      proposedDate: text(event.proposed_date),
      registrationClosesAt: text(event.registration_closes_at),
      venues: Array.isArray(event.venues)
        ? event.venues.filter(isObject).map((venue) => ({ name: text(venue.name) ?? 'Unnamed venue', location: text(venue.location) }))
        : [],
    },
  };
}

/** GET /api/my-registrations — attendees only. */
export async function fetchMyRegistrations(token: string): Promise<FetchMyRegistrationsResult> {
  let response: Response;
  try {
    response = await fetch('/api/my-registrations', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  if (!response.ok || !Array.isArray(data.registrations)) return { ok: false, kind: 'unavailable' };
  return {
    ok: true,
    registrations: data.registrations.filter(isObject).map(toRegistration).filter((row): row is MyRegistration => row !== null),
  };
}

const REFUSALS = ['started', 'withdrawn', 'cancelled'] as const;

/** POST /api/my-registrations/:registrationId/withdrawal (AC2). */
export async function withdrawRegistration(registrationId: number, token: string): Promise<WithdrawResult> {
  let response: Response;
  try {
    response = await fetch(`/api/my-registrations/${registrationId}/withdrawal`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, kind: 'unavailable' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  if (response.status === 404) return { ok: false, kind: 'not_found' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  const message = text(data.error);
  if (response.status === 200 && isObject(data.withdrawal) && typeof data.withdrawal.withdrawn_at === 'string') {
    return { ok: true, withdrawnAt: data.withdrawal.withdrawn_at };
  }
  if (response.status === 409 && message && (REFUSALS as readonly unknown[]).includes(data.reason)) {
    return { ok: false, kind: data.reason as (typeof REFUSALS)[number], message };
  }
  return { ok: false, kind: 'unavailable' };
}
