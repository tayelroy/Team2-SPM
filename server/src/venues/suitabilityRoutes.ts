import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type createAuthorization, AccessError, type Principal } from '../auth';
import { getSupabaseAdminClient } from '../db';
import {
  createVenueSuitabilityStore,
  type BookingRequestRow,
  type SuitabilityEventRow,
  type SuitabilityVenueRow,
  type VenueSuitabilityStore
} from '../db/venueSuitability';
import { CHANGEABLE_STATUSES } from '../events/changeImpact';
import { assessSuitability, bookingReadiness } from './suitability';

export interface VenueSuitabilityDependencies {
  getAdminClient?: () => SupabaseClient | null;
  store?: (admin: SupabaseClient) => VenueSuitabilityStore;
}

export function parseId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || Number(raw) > 2147483647) return null;
  return Number(raw);
}

/** Venue Staff and Technical Support Staff work across every event; a
 * coordinator sees only events assigned to them and an organiser only their
 * own. The route permission has already excluded every other role. */
export function canSeeEvent(principal: Principal, event: SuitabilityEventRow): boolean {
  if (principal.role === 'event_coordinator') return event.coordinator_id === principal.userId;
  if (principal.role === 'event_organiser') return event.organiser_id === principal.userId;
  return true;
}

function eventSummary(event: SuitabilityEventRow) {
  const { event_id, name, expected_attendance, venue_requirements, accessibility_needs } = event;
  return { event_id, name, expected_attendance, venue_requirements, accessibility_needs };
}

function withSuitability(event: SuitabilityEventRow, venue: SuitabilityVenueRow) {
  return { ...venue, suitability: assessSuitability(event, venue) };
}

type Respond = (status: number, body?: unknown) => void;

function handler(
  access: ReturnType<typeof createAuthorization>,
  { getAdminClient = getSupabaseAdminClient, store = createVenueSuitabilityStore }: VenueSuitabilityDependencies,
  run: (database: VenueSuitabilityStore, principal: Principal, req: Parameters<RequestHandler>[0], respond: Respond) => Promise<void>
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

/** SG2-66 AC2: an approved request still holding its confirmed booking, for
 * an event that is going ahead, needs a new capacity check once attendance
 * rises above the venue's capacity. */
function isBooked(request: BookingRequestRow, event: SuitabilityEventRow) {
  return request.status === 'approved' && request.venue_booking?.status === 'confirmed'
    && (CHANGEABLE_STATUSES as readonly string[]).includes(event.status);
}

/**
 * GET /api/venues/suitability?event_id=&venue_id= — how each venue (or the
 * one given) fits an event (SG2-47 AC1, AC2, AC4). Shown to coordinators
 * alongside venue search; every reason a venue does not fit is listed.
 */
export function createVenueSuitabilityRouter(access: ReturnType<typeof createAuthorization>, dependencies: VenueSuitabilityDependencies = {}) {
  const router = access.protectedRouter();
  router.get('/suitability', access.requirePermission('venues.suitability.view'), handler(access, dependencies, async (database, principal, req, respond) => {
    const eventId = parseId(req.query.event_id);
    const venueId = req.query.venue_id === undefined ? undefined : parseId(req.query.venue_id);
    if (eventId === null || venueId === null) {
      respond(400, { error: 'event_id, and venue_id when given, must be positive whole numbers.' });
      return;
    }
    const event = await database.event(eventId);
    // An event the caller may not see is reported as missing, not forbidden,
    // so its existence is not revealed.
    if (!event || !canSeeEvent(principal, event)) {
      respond(404, { error: 'Event not found.' });
      return;
    }
    const venues = await database.venues(venueId);
    if (venueId !== undefined && venues.length === 0) {
      respond(404, { error: 'Venue not found.' });
      return;
    }
    respond(200, { event: eventSummary(event), venues: venues.map(venue => withSuitability(event, venue)) });
  }));
  return router;
}

/**
 * Routes on one venue booking request, mounted at /api/venue-booking-requests:
 *
 * GET /:requestId/suitability — how the requested venue fits the event, the
 * capacity exceptions approved so far, and whether the booking may go ahead.
 *
 * POST /:requestId/capacity-exception — Venue Staff approve booking a venue
 * too small for the expected attendance (SG2-47 AC3; only Venue Staff since
 * SG2-66 AC5). Coordinators hold no grant, so acknowledging a warning never
 * approves one. The request's own status is not changed: Venue Staff still
 * decide on a pending booking (AC5). A request already booked for a live
 * event is covered too, once its attendance rises above the capacity (SG2-66
 * AC2): the new exception is for the revised attendance.
 */
export function createBookingRequestSuitabilityRouter(access: ReturnType<typeof createAuthorization>, dependencies: VenueSuitabilityDependencies = {}) {
  const router = access.protectedRouter();

  // Discovery uses the approval grant itself, not broader event or venue
  // listing permissions. Venue Staff work across every event.
  router.get('/capacity-exceptions', access.requirePermission('venue_booking.capacity_exception.approve'), handler(access, dependencies, async (database, _principal, _req, respond) => {
    const candidates = await database.capacityCandidates();
    const requests = candidates.flatMap(row => {
      const booked = isBooked(row, row.event);
      return (row.status === 'pending' || booked)
        && row.event.expected_attendance !== null && row.event.expected_attendance > 0
        && bookingReadiness(assessSuitability(row.event, row.venue), row.exceptions) === 'needs_capacity_exception'
        ? [{
          request_id: row.request_id, event_id: row.event_id,
          event_name: row.event.name?.trim() || 'Untitled event',
          venue_name: row.venue.name.trim() || 'Unnamed venue',
          starts_at: row.starts_at, ends_at: row.ends_at,
          expected_attendance: row.event.expected_attendance, venue_capacity: row.venue.capacity,
          booked
        }] : [];
    });
    respond(200, { requests });
  }));

  async function load(database: VenueSuitabilityStore, principal: Principal, rawId: string, respond: Respond) {
    const requestId = parseId(rawId);
    if (requestId === null) {
      respond(400, { error: 'Invalid booking request ID.' });
      return null;
    }
    const request = await database.request(requestId);
    const event = request && await database.event(request.event_id);
    if (!request || !event || !canSeeEvent(principal, event)) {
      respond(404, { error: 'Booking request not found.' });
      return null;
    }
    const [venue] = await database.venues(request.venue_id, true);
    const suitability = assessSuitability(event, venue);
    const exceptions = await database.exceptions(requestId);
    return { request, event, venue, suitability, exceptions, booking: bookingReadiness(suitability, exceptions) };
  }

  router.get('/:requestId/suitability', access.requirePermission('venues.suitability.view'), handler(access, dependencies, async (database, principal, req, respond) => {
    const loaded = await load(database, principal, req.params.requestId, respond);
    if (!loaded) return;
    const { request, event, venue, suitability, exceptions, booking } = loaded;
    respond(200, { request, event: eventSummary(event), venue: withSuitability(event, venue), suitability, exceptions, booking });
  }));

  router.post('/:requestId/capacity-exception', access.requirePermission('venue_booking.capacity_exception.approve'), handler(access, dependencies, async (database, principal, req, respond) => {
    const loaded = await load(database, principal, req.params.requestId, respond);
    if (!loaded) return;
    const { request, event, venue, suitability, booking } = loaded;
    if (request.status !== 'pending' && !isBooked(request, event)) {
      respond(409, { error: 'Only a booking request awaiting a decision, or a booked venue for an event still going ahead, can be given a capacity exception.' });
      return;
    }
    if (booking === 'blocked') {
      const missing = suitability.issues.find(issue => issue.kind === 'facility')!;
      respond(409, { error: `This venue cannot be booked for the event. ${missing.message} No exception is permitted for a missing facility.` });
      return;
    }
    const capacity = suitability.issues.find(issue => issue.kind === 'capacity');
    if (!capacity) {
      respond(409, { error: "The event's expected attendance fits this venue, so no capacity exception is needed." });
      return;
    }
    const exception = booking === 'allowed' ? null : await database.recordException({
      request_id: request.request_id, approved_by: principal.userId, approver_role: principal.role,
      expected_attendance: capacity.expected_attendance, venue_capacity: venue.capacity
    });
    // Already covered, either before this request or by a concurrent approval.
    if (!exception) {
      respond(409, { error: 'A capacity exception covering this attendance has already been approved.' });
      return;
    }
    respond(201, { exception, booking: bookingReadiness(suitability, [exception]) });
  }));

  return router;
}
