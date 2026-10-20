import type { Request, RequestHandler, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '../db';
import type { Principal } from '../auth/policy';
import { fetchOrganiserOrganisation, type OrganiserLookupResult } from '../db/eventRequests';
import {
  fetchRegistrationOverview,
  updateRegistrationSettings,
  type FetchRegistrationOverviewResult,
  type RegistrationOverview,
  type UpdateRegistrationSettingsInput,
  type UpdateRegistrationSettingsResult
} from '../db/registrations';
import {
  SETTLED_STATUSES,
  belowRegisteredMessage,
  capacityWarnings,
  clearedOnceConfirmed,
  placesRemaining,
  validateRegistrationSchedule,
  validateRegistrationSettings
} from './registrationSettings';
import { registrationWindow } from './registrationWindow';

const UNAVAILABLE_MESSAGE = 'Registrations are temporarily unavailable. Please try again later.';
const NOT_FOUND_MESSAGE = 'Event not found.';
const NOT_NEEDED_MESSAGE = 'This event does not take registrations.';
const STARTED_MESSAGE = 'The event has started, so its registration settings can no longer change.';
const NOT_OPEN_MESSAGE = 'Registration is not open, so it cannot be closed early.';
const SETTLED_MESSAGE = 'This event is closed, so its registration settings can no longer change.';

export interface RegistrationDependencies {
  getPrincipal: (req: Request) => Principal | undefined;
  getAdminClient?: () => SupabaseClient | null;
  fetchOverview?: (admin: SupabaseClient, eventId: number) => Promise<FetchRegistrationOverviewResult>;
  fetchOrganisation?: (admin: SupabaseClient, userId: string) => Promise<OrganiserLookupResult>;
  updateSettings?: (admin: SupabaseClient, input: UpdateRegistrationSettingsInput) => Promise<UpdateRegistrationSettingsResult>;
  /** Current time in epoch milliseconds. */
  now?: () => number;
}

type Access = { visible: false } | { visible: true; owner: boolean; contactDetails: boolean };

/**
 * AC3: an organiser sees the picture only for their own organisation's
 * events, and the assigned coordinator for the event they coordinate.
 * AC4: contact details are for the people running the event, the organiser
 * who created it and its assigned coordinator, not organisation colleagues.
 */
async function accessFor(
  principal: Principal,
  overview: RegistrationOverview,
  admin: SupabaseClient,
  fetchOrganisation: NonNullable<RegistrationDependencies['fetchOrganisation']>
): Promise<Access | 'unavailable'> {
  const { event } = overview;
  if (principal.role === 'event_coordinator') {
    return event.coordinator_id === principal.userId ? { visible: true, owner: false, contactDetails: true } : { visible: false };
  }
  const membership = await fetchOrganisation(admin, principal.userId);
  if (!membership.ok && membership.reason === 'unavailable') return 'unavailable';
  const organisation = membership.ok ? membership.organisation : null;
  if (!organisation || !organisation.trim() || organisation !== event.organisation) return { visible: false };
  const owner = event.organiser_id === principal.userId;
  return { visible: true, owner, contactDetails: owner };
}

/** The registration picture as one response (AC1, AC2, AC4, AC5, AC7, AC8). */
function view(overview: RegistrationOverview, access: { owner: boolean; contactDetails: boolean }, now: number) {
  const { event, attendees, venues } = overview;
  const capacity = event.registration_capacity;
  const started = event.proposed_date !== null && now >= Date.parse(event.proposed_date);
  return {
    event_id: event.event_id,
    name: event.name,
    status: event.status,
    registration_needed: event.registration_needed === true,
    registration_capacity: capacity,
    registration_opens_at: event.registration_opens_at,
    registration_closes_at: event.registration_closes_at,
    window: registrationWindow(event, new Date(now)),
    registered_count: attendees.length,
    places_remaining: placesRemaining(capacity, attendees.length),
    contact_details_visible: access.contactDetails,
    attendees: attendees.map(({ email, phone, ...attendee }) =>
      (access.contactDetails ? { ...attendee, email, phone } : attendee)),
    venues,
    capacity_warnings: capacityWarnings(capacity, venues),
    // AC5, AC8: only the organiser who created it, before it starts.
    can_edit: access.owner && event.registration_needed === true && !started
      && !(SETTLED_STATUSES as readonly string[]).includes(event.status)
  };
}

/**
 * SG2-63 routes:
 * - GET   /api/event-requests/:eventId/registrations — the registration picture
 *   for an organiser of the event's organisation or its assigned coordinator;
 * - PATCH /api/event-requests/:eventId/registration-settings — the creating
 *   organiser sets capacity and opening and closing times (AC5, AC6);
 * - POST  /api/event-requests/:eventId/registration-settings/close — the
 *   creating organiser closes open registration now (AC6).
 */
export function createRegistrationHandlers({
  getPrincipal,
  getAdminClient = getSupabaseAdminClient,
  fetchOverview = fetchRegistrationOverview,
  fetchOrganisation = fetchOrganiserOrganisation,
  updateSettings = updateRegistrationSettings,
  now = Date.now
}: RegistrationDependencies): { overview: RequestHandler; update: RequestHandler; close: RequestHandler } {
  /** The caller, the admin client, the event and what the caller may see; null once answered. */
  async function load(req: Request, res: Response) {
    const principal = getPrincipal(req);
    if (!principal) {
      // Defensive: these handlers are only mounted behind requireAuth.
      res.status(401).json({ error: 'Authentication required' });
      return null;
    }
    const raw = req.params.eventId;
    const eventId = Number(raw);
    if (!/^[1-9]\d*$/.test(raw) || eventId > 2147483647) {
      res.status(400).json({ error: 'eventId must be a positive integer.' });
      return null;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return null;
    }
    const fetched = await fetchOverview(admin, eventId);
    if (!fetched.ok && fetched.reason === 'unavailable') {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return null;
    }
    const access = fetched.ok ? await accessFor(principal, fetched.overview, admin, fetchOrganisation) : { visible: false as const };
    if (access === 'unavailable') {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return null;
    }
    // An event the caller may not see is reported missing, so its existence is not revealed.
    if (!fetched.ok || !access.visible) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return null;
    }
    return { principal, admin, eventId, overview: fetched.overview, access };
  }

  /** Writes a change, then answers with the picture as it now stands. */
  async function write(res: Response, loaded: NonNullable<Awaited<ReturnType<typeof load>>>, input: UpdateRegistrationSettingsInput) {
    const result = await updateSettings(loaded.admin, input);
    switch (result.outcome) {
      case 'ok': {
        const fresh = await fetchOverview(loaded.admin, loaded.eventId);
        // The change is saved; if it cannot be re-read, report what was asked for.
        const overview = fresh.ok ? fresh.overview
          : { ...loaded.overview, event: { ...loaded.overview.event, ...input.values } };
        res.status(200).json(view(overview, loaded.access, now()));
        return;
      }
      case 'missing':
        res.status(404).json({ error: NOT_FOUND_MESSAGE });
        return;
      case 'closed':
        res.status(409).json({ error: SETTLED_MESSAGE, status: result.status });
        return;
      case 'not_needed':
        res.status(409).json({ error: NOT_NEEDED_MESSAGE });
        return;
      case 'started':
        res.status(409).json({ error: STARTED_MESSAGE });
        return;
      case 'not_open':
        res.status(409).json({ error: NOT_OPEN_MESSAGE });
        return;
      case 'below_registered':
        res.status(409).json({ error: belowRegisteredMessage(result.registered), registered: result.registered });
        return;
      case 'invalid':
        // The server's checks and the database function apply the same rules.
        res.status(400).json({ error: 'Invalid registration settings', details: [] });
        return;
      case 'unavailable':
        res.status(503).json({ error: UNAVAILABLE_MESSAGE });
        return;
    }
  }

  const overview: RequestHandler = async (req, res) => {
    const loaded = await load(req, res);
    if (!loaded) return;
    res.status(200).json(view(loaded.overview, loaded.access, now()));
  };

  const update: RequestHandler = async (req, res) => {
    const validated = validateRegistrationSettings(req.body);
    const loaded = await load(req, res);
    if (!loaded) return;
    if (!loaded.access.owner) {
      // AC8: colleagues and the coordinator can see the settings but not change them.
      res.status(403).json({ error: 'Only the organiser who created this event can change its registration settings.' });
      return;
    }
    if (!validated.valid) {
      res.status(400).json({ error: 'Invalid registration settings', details: validated.errors });
      return;
    }
    const schedule = [...clearedOnceConfirmed(loaded.overview.event.status, validated.values),
      ...validateRegistrationSchedule(loaded.overview.event, validated.values, now())];
    const registered = loaded.overview.attendees.length;
    const capacity = validated.values.registration_capacity;
    if (typeof capacity === 'number' && capacity < registered) schedule.push(belowRegisteredMessage(registered));
    if (schedule.length > 0) {
      res.status(400).json({ error: 'Invalid registration settings', details: schedule });
      return;
    }
    await write(res, loaded, { eventId: loaded.eventId, actorId: loaded.principal.userId, values: validated.values, closeNow: false });
  };

  const close: RequestHandler = async (req, res) => {
    const loaded = await load(req, res);
    if (!loaded) return;
    if (!loaded.access.owner) {
      res.status(403).json({ error: 'Only the organiser who created this event can close its registration.' });
      return;
    }
    await write(res, loaded, { eventId: loaded.eventId, actorId: loaded.principal.userId, values: {}, closeNow: true });
  };

  return { overview, update, close };
}
