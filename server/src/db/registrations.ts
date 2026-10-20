import type { SupabaseClient } from '@supabase/supabase-js';
import type { BookedVenue, RegistrationSettingValues } from '../events/registrationSettings';

/** One active registration (SG2-63 AC2), contact details included. */
export interface RegisteredAttendee {
  registration_id: number;
  name: string;
  organisation: string | null;
  email: string | null;
  phone: string | null;
  registered_at: string;
}

/** The event facts the registration picture and its access checks need. */
export interface RegistrationEvent {
  event_id: number;
  name: string | null;
  status: string;
  organisation: string | null;
  organiser_id: string | null;
  coordinator_id: string | null;
  proposed_date: string | null;
  registration_needed: boolean | null;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
}

export interface RegistrationOverview {
  event: RegistrationEvent;
  attendees: RegisteredAttendee[];
  venues: BookedVenue[];
}

export type FetchRegistrationOverviewResult =
  | { ok: true; overview: RegistrationOverview }
  | { ok: false; reason: 'not_found' | 'unavailable' };

/** What `public.update_registration_settings` did (SG2-63 AC5, AC6). */
export type UpdateRegistrationSettingsResult =
  | { outcome: 'ok' }
  | { outcome: 'missing' | 'not_needed' | 'started' | 'not_open' | 'invalid' | 'unavailable' }
  | { outcome: 'closed'; status: string };

export interface UpdateRegistrationSettingsInput {
  eventId: number;
  actorId: string;
  values: RegistrationSettingValues;
  closeNow: boolean;
}

const text = (value: unknown) => (typeof value === 'string' ? value : null);
const count = (value: unknown) => (typeof value === 'number' ? value : null);

/**
 * Reads the event, its active registrations and its booked venues through
 * `public.event_registration_overview` (service role). The caller decides who
 * may see it and which contact details to keep.
 */
export async function fetchRegistrationOverview(
  admin: SupabaseClient,
  eventId: number
): Promise<FetchRegistrationOverviewResult> {
  const { data, error } = await admin.rpc('event_registration_overview', { p_event_id: eventId });
  if (error) return { ok: false, reason: 'unavailable' };
  if (data === null) return { ok: false, reason: 'not_found' };
  if (typeof data !== 'object' || !Array.isArray(data.attendees) || !Array.isArray(data.venues)
    || typeof data.event !== 'object' || data.event === null) {
    return { ok: false, reason: 'unavailable' };
  }
  const event = data.event as Record<string, unknown>;
  return {
    ok: true,
    overview: {
      event: {
        event_id: Number(event.event_id),
        name: text(event.name),
        status: String(event.status),
        organisation: text(event.organisation),
        organiser_id: text(event.organiser_id),
        coordinator_id: text(event.coordinator_id),
        proposed_date: text(event.proposed_date),
        registration_needed: typeof event.registration_needed === 'boolean' ? event.registration_needed : null,
        registration_capacity: count(event.registration_capacity),
        registration_opens_at: text(event.registration_opens_at),
        registration_closes_at: text(event.registration_closes_at)
      },
      attendees: (data.attendees as Record<string, unknown>[]).map(row => ({
        registration_id: Number(row.registration_id),
        name: String(row.name),
        organisation: text(row.organisation),
        email: text(row.email),
        phone: text(row.phone),
        registered_at: String(row.registered_at)
      })),
      venues: (data.venues as Record<string, unknown>[]).map(row => ({
        venue_id: Number(row.venue_id),
        name: String(row.name),
        capacity: count(row.capacity)
      }))
    }
  };
}

/**
 * Changes the settings, or closes registration now, through
 * `public.update_registration_settings` (service role): the change, its
 * history and any opened/closed notice are one transaction under the event
 * row lock. The function rechecks the caller created the event, the event can
 * still change and the values are valid.
 */
export async function updateRegistrationSettings(
  admin: SupabaseClient,
  input: UpdateRegistrationSettingsInput
): Promise<UpdateRegistrationSettingsResult> {
  const { data, error } = await admin.rpc('update_registration_settings', {
    p_event_id: input.eventId,
    p_actor_id: input.actorId,
    p_values: input.values,
    p_close_now: input.closeNow
  });
  if (error || typeof data !== 'object' || data === null) return { outcome: 'unavailable' };
  const row = data as Record<string, unknown>;
  switch (row.outcome) {
    case 'ok':
    case 'missing':
    case 'not_needed':
    case 'started':
    case 'not_open':
    case 'invalid':
      return { outcome: row.outcome };
    case 'closed':
      return typeof row.status === 'string' ? { outcome: 'closed', status: row.status } : { outcome: 'unavailable' };
    default:
      return { outcome: 'unavailable' };
  }
}
