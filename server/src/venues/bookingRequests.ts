import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type createAuthorization, AccessError, type Principal } from '../auth';
import { getSupabaseAdminClient } from '../db';
import {
  createVenueBookingRequestStore,
  type VenueBookingRequestRecord,
  type VenueBookingRequestStore
} from '../db/venueBookingRequests';
import {
  createVenueBookingDecisionStore,
  type Decision,
  type DecisionResult,
  type VenueBookingDecisionStore
} from '../db/venueBookingDecisions';
import { validateVenueBookingRequest } from './bookingRequestFields';
import { assessSuitability, bookingReadiness } from './suitability';
import { canSeeEvent, parseId } from './suitabilityRoutes';
import { conflictsFor } from './conflicts';

export interface VenueBookingRequestDependencies {
  getAdminClient?: () => SupabaseClient | null;
  store?: (admin: SupabaseClient) => VenueBookingRequestStore;
  now?: () => number;
  /** SG2-49: decisions run with the caller's own token. */
  decisions?: (token: string) => VenueBookingDecisionStore;
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

/** The longest decision reason, matching venue_booking_requests_reason_length. */
export const MAX_DECISION_REASON = 500;

/** SG2-49: a decision and its reason. A rejection must say why (AC2). */
export function validateDecision(input: unknown): { decision: Decision; reason: string | null } | string {
  const body = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  if (body.decision !== 'approve' && body.decision !== 'reject') return 'Choose approve or reject.';
  if (body.reason !== undefined && body.reason !== null && typeof body.reason !== 'string') return 'The reason must be text.';
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
  if (body.decision === 'reject' && reason === null) return 'Give a reason for rejecting this request.';
  if (reason !== null && Array.from(reason).length > MAX_DECISION_REASON) return `Keep the reason to ${MAX_DECISION_REASON} characters or fewer.`;
  return { decision: body.decision, reason };
}

const HOLD_MESSAGE = (hold: number) => `This request belongs to tentative hold #${hold}. Convert or release it from Venue holds.`;
const CAPACITY_MESSAGE = 'Approve a capacity exception for this request before approving the booking.';

/** Why an approval was refused at the moment of committing (AC1). */
function refusal(result: Exclude<DecisionResult, { outcome: 'updated' }>, venue: string): [number, string] {
  switch (result.outcome) {
    case 'conflict': return [409, result.kind === 'booking' ? `${venue} is already booked for ${result.label} during this period.`
      : result.kind === 'block' ? `${venue} is blocked during this period: ${result.label}.`
        : `${venue} is on a tentative hold for ${result.label} during this period.`];
    case 'decided': return [409, `This request has already been ${result.status}.`];
    case 'hold': return [409, HOLD_MESSAGE(result.hold_id)];
    case 'closed': return [409, 'This request can no longer be approved: the event is not approved or the requested period has passed.'];
    case 'capacity': return [409, CAPACITY_MESSAGE];
    case 'missing': return [404, 'Booking request not found.'];
    default: return [400, 'Choose approve or reject, and give a reason for rejecting.'];
  }
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
 * the same venue twice over an overlapping period (AC4). Anything already
 * committing the venue over the period is reported with the new request, by
 * booking or hold number (SG2-50 AC1); the request is still made, but it
 * cannot be approved while the conflict stands (SG2-50 AC2).
 *
 * GET /?event_id= — the event's requests and where each stands (AC3).
 */
export function createVenueBookingRequestsRouter(access: ReturnType<typeof createAuthorization>, dependencies: VenueBookingRequestDependencies = {}) {
  const router = access.protectedRouter();
  const now = dependencies.now ?? Date.now;
  const decisions = dependencies.decisions ?? createVenueBookingDecisionStore;

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
    const conflicts = await conflictsFor(database, request, principal, now(), request.request_id);
    respond(201, { request, booking, conflicts });
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

  /**
   * POST /:requestId/decision — Venue Staff approve or reject a pending
   * request. Approval commits the venue and notifies the coordinator (AC1);
   * rejection needs a reason the coordinator sees (AC2); both record who
   * decided and when (AC3). A missing facility or an uncovered capacity
   * shortfall (SG2-47) refuses approval before anything is written.
   */
  router.post('/:requestId/decision', access.requirePermission('venue_booking.decide'), handler(access, dependencies, async (database, _principal, req, respond) => {
    const requestId = parseId(req.params.requestId);
    if (requestId === null) {
      respond(400, { error: 'Invalid booking request ID.' });
      return;
    }
    const values = validateDecision(req.body);
    if (typeof values === 'string') {
      respond(400, { error: values });
      return;
    }
    const request = await database.request(requestId);
    if (!request) {
      respond(404, { error: 'Booking request not found.' });
      return;
    }
    if (request.status !== 'pending') {
      respond(409, { error: `This request has already been ${request.status}.` });
      return;
    }
    const hold = await database.hold(requestId);
    if (hold !== null) {
      respond(409, { error: HOLD_MESSAGE(hold) });
      return;
    }
    if (values.decision === 'approve') {
      const [event, venue, exceptions] = await Promise.all([
        database.event(request.event_id), database.venue(request.venue_id), database.exceptions(requestId)
      ]);
      const suitability = assessSuitability(event!, venue!);
      const booking = bookingReadiness(suitability, exceptions);
      if (booking === 'blocked') {
        const missing = suitability.issues.find(issue => issue.kind === 'facility')!;
        respond(409, { error: `${venue!.name} cannot be booked for this event. ${missing.message}` });
        return;
      }
      if (booking === 'needs_capacity_exception') {
        respond(409, { error: CAPACITY_MESSAGE });
        return;
      }
    }
    const result = await decisions(req.get('authorization')!.slice(7)).decide(requestId, values.decision, values.reason);
    if (result.outcome !== 'updated') {
      const [status, error] = refusal(result, request.venue_name ?? 'This venue');
      respond(status, result.outcome === 'conflict' ? { error, conflict: { kind: result.kind, starts_at: result.starts_at, ends_at: result.ends_at, label: result.label } } : { error });
      return;
    }
    respond(200, { request: await database.request(requestId) });
  }));

  return router;
}
