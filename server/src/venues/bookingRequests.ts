import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type createAuthorization, AccessError, type Principal } from '../auth';
import { getSupabaseAdminClient } from '../db';
import {
  createVenueBookingRequestStore,
  type VenueBookingRequestRecord,
  type VenueBookingRequestStore
} from '../db/venueBookingRequests';
import { validateVenueBookingRequest } from './bookingRequestFields';
import { assessSuitability, bookingReadiness } from './suitability';
import { canSeeEvent, parseId } from './suitabilityRoutes';

export interface VenueBookingRequestDependencies {
  getAdminClient?: () => SupabaseClient | null;
  store?: (admin: SupabaseClient) => VenueBookingRequestStore;
  now?: () => number;
}

/** Venues are requested once the event has been approved and before it is
 * confirmed (SG2-48 AC1). */
const REQUESTABLE_EVENT_STATUSES = ['approved', 'planning'];

const INVALID_REQUEST = 'Choose an event, a venue, a layout and a future period that starts before it ends.';

function duplicateMessage(existing: VenueBookingRequestRecord | null) {
  return existing
    ? `This event already requested ${existing.venue_name ?? 'this venue'} for an overlapping period (request #${existing.request_id}, ${existing.status}).`
    : 'This event already requested this venue for an overlapping period.';
}

type Respond = (status: number, body?: unknown) => void;

function handler(
  access: ReturnType<typeof createAuthorization>,
  { getAdminClient = getSupabaseAdminClient, store = createVenueBookingRequestStore }: VenueBookingRequestDependencies,
  run: (database: VenueBookingRequestStore, principal: Principal, req: Parameters<RequestHandler>[0], respond: Respond) => Promise<void>
): RequestHandler {
  return async (req, res) => {
    const respond: Respond = (status, body) => { res.status(status).json(body); };
    try {
      const admin = getAdminClient();
      if (!admin) throw new AccessError(503);
      await run(store(admin), access.getPrincipal(req)!, req, respond);
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };
}

/**
 * Venue requests for an event, mounted at /api/venue-booking-requests:
 *
 * POST / — the event's assigned coordinator requests a venue for a period and
 * layout; the request carries the event's venue requirements (AC1). It starts
 * pending and reaches Venue Staff through the work queue (AC2). Nothing is
 * written to venue_bookings, so the venue is neither held nor shown as
 * unavailable (AC3). Several venues may be requested for one event, but not
 * the same venue twice over an overlapping period (AC4).
 *
 * GET /?event_id= — the event's requests and where each stands (AC3).
 */
export function createVenueBookingRequestsRouter(access: ReturnType<typeof createAuthorization>, dependencies: VenueBookingRequestDependencies = {}) {
  const router = access.protectedRouter();
  const now = dependencies.now ?? Date.now;

  router.post('/', access.requirePermission('venue_booking.request'), handler(access, dependencies, async (database, principal, req, respond) => {
    const values = validateVenueBookingRequest(req.body, now());
    if (!values) {
      respond(400, { error: INVALID_REQUEST });
      return;
    }
    const event = await database.event(values.event_id);
    // Only the event's own coordinator may request for it; any other event is
    // reported as missing so its existence is not revealed.
    if (!event || !canSeeEvent(principal, event)) {
      respond(404, { error: 'Event not found.' });
      return;
    }
    if (!REQUESTABLE_EVENT_STATUSES.includes(event.status)) {
      respond(409, { error: `A venue can be requested only for an approved event. This event is ${event.status.replace('_', ' ')}.` });
      return;
    }
    const venue = await database.venue(values.venue_id);
    if (!venue) {
      respond(404, { error: 'Venue not found.' });
      return;
    }
    const layouts = await database.layouts(venue.venue_id);
    if (!layouts.includes(values.layout)) {
      respond(409, { error: layouts.length === 0
        ? `${venue.name} has no layouts recorded, so it cannot be requested yet.`
        : `${venue.name} does not offer the ${values.layout} layout. It offers: ${layouts.join(', ')}.` });
      return;
    }
    // SG2-47 AC2: a missing required facility blocks booking outright, so
    // there is nothing for Venue Staff to decide.
    const suitability = assessSuitability(event, venue);
    const booking = bookingReadiness(suitability);
    if (booking === 'blocked') {
      const missing = suitability.issues.find(issue => issue.kind === 'facility')!;
      respond(409, { error: `${venue.name} cannot be booked for this event. ${missing.message}` });
      return;
    }
    const existing = await database.duplicate(values);
    if (existing) {
      respond(409, { error: duplicateMessage(existing) });
      return;
    }
    const request = await database.create({ ...values, venue_requirements: event.venue_requirements, requested_by: principal.userId });
    // Refused by the database: the same request was made at the same moment.
    if (!request) {
      respond(409, { error: duplicateMessage(null) });
      return;
    }
    respond(201, { request, booking });
  }));

  router.get('/', access.requirePermission('venue_booking.request.view'), handler(access, dependencies, async (database, principal, req, respond) => {
    const eventId = parseId(req.query.event_id);
    if (eventId === null) {
      respond(400, { error: 'event_id must be a positive whole number.' });
      return;
    }
    const event = await database.event(eventId);
    if (!event || !canSeeEvent(principal, event)) {
      respond(404, { error: 'Event not found.' });
      return;
    }
    respond(200, { requests: await database.list(eventId) });
  }));

  return router;
}
