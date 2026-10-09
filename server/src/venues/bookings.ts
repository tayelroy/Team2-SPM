import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type createAuthorization, AccessError, type Principal } from '../auth';
import { PERMISSIONS } from '../auth/policy';
import { getSupabaseAdminClient } from '../db';
import {
  createVenueBookingReleaseStore,
  createVenueBookingStore,
  type ReleaseResult,
  type VenueBookingReleaseStore,
  type VenueBookingStore
} from '../db/venueBookings';
import { canSeeEvent, parseId } from './suitabilityRoutes';

export interface VenueBookingDependencies {
  getAdminClient?: () => SupabaseClient | null;
  store?: (admin: SupabaseClient) => VenueBookingStore;
  /** Releases run with the caller's own token. */
  releases?: (token: string) => VenueBookingReleaseStore;
  now?: () => number;
}

/** The longest release reason, matching venue_bookings_cancellation_reason_length. */
export const MAX_RELEASE_REASON = 500;

/** SG2-51 AC1: a release always gives a reason. */
export function validateReleaseReason(input: unknown): string | null {
  const reason = (input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>).reason : undefined);
  if (typeof reason !== 'string' || !reason.trim()) return null;
  const trimmed = reason.trim();
  return Array.from(trimmed).length > MAX_RELEASE_REASON ? null : trimmed;
}

const INVALID_REASON = `Give a reason for releasing this booking, in ${MAX_RELEASE_REASON} characters or fewer.`;

/** Why a release was refused at the moment of committing. */
function refusal(result: Exclude<ReleaseResult, { outcome: 'released' }>): [number, string] {
  switch (result.outcome) {
    case 'inactive': return [409, result.status === 'cancelled'
      ? 'This booking has already been released.'
      : 'Only a confirmed booking can be released.'];
    case 'past': return [409, 'This booking has already ended, so there is nothing to release.'];
    case 'missing': return [404, 'Booking not found.'];
    default: return [400, INVALID_REASON];
  }
}

type Respond = (status: number, body?: unknown) => void;

function handler(
  access: ReturnType<typeof createAuthorization>,
  { getAdminClient = getSupabaseAdminClient, store = createVenueBookingStore }: VenueBookingDependencies,
  run: (database: VenueBookingStore, principal: Principal, req: Parameters<RequestHandler>[0], respond: Respond) => Promise<void>
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
 * Venue bookings, mounted at /api/venue-bookings (SG2-51):
 *
 * GET /?event_id= — the event's confirmed and released bookings, for Venue
 * Staff or the event's assigned coordinator. An event with several venues
 * lists each (AC3).
 *
 * GET /?venue_id= — a venue's upcoming confirmed and released bookings, for
 * Venue Staff only.
 *
 * POST /:bookingId/release — Venue Staff, or the event's assigned
 * coordinator, release a confirmed booking with a reason (AC1). The period is
 * free again (AC2), the event's other bookings are untouched (AC3), the
 * coordinator and Event Organiser are notified (AC4) and the release is
 * recorded with who, when and why (AC5), all by release_venue_booking().
 */
export function createVenueBookingsRouter(access: ReturnType<typeof createAuthorization>, dependencies: VenueBookingDependencies = {}) {
  const router = access.protectedRouter();
  const now = dependencies.now ?? Date.now;
  const releases = dependencies.releases ?? createVenueBookingReleaseStore;

  router.get('/', access.requirePermission('venue_bookings.view'), handler(access, dependencies, async (database, principal, req, respond) => {
    const byEvent = req.query.event_id !== undefined;
    if (byEvent === (req.query.venue_id !== undefined)) {
      respond(400, { error: 'Give either event_id or venue_id.' });
      return;
    }
    const id = parseId(byEvent ? req.query.event_id : req.query.venue_id);
    if (id === null) {
      respond(400, { error: `${byEvent ? 'event_id' : 'venue_id'} must be a positive whole number.` });
      return;
    }
    if (byEvent) {
      const event = await database.event(id);
      // An event the caller may not see is reported as missing.
      if (!event || !canSeeEvent(principal, event)) {
        respond(404, { error: 'Event not found.' });
        return;
      }
      respond(200, { bookings: await database.forEvent(id) });
      return;
    }
    // A whole venue's bookings span every event: Venue Staff only.
    if (!PERMISSIONS['venue_bookings.by_venue'].includes(principal.role)) {
      respond(403, { error: new AccessError(403).message });
      return;
    }
    if (!await database.venueExists(id)) {
      respond(404, { error: 'Venue not found.' });
      return;
    }
    respond(200, { bookings: await database.forVenue(id, new Date(now()).toISOString()) });
  }));

  router.post('/:bookingId/release', access.requirePermission('venue_bookings.release'), handler(access, dependencies, async (_database, _principal, req, respond) => {
    const bookingId = parseId(req.params.bookingId);
    if (bookingId === null) {
      respond(400, { error: 'Invalid booking ID.' });
      return;
    }
    const reason = validateReleaseReason(req.body);
    if (reason === null) {
      respond(400, { error: INVALID_REASON });
      return;
    }
    const result = await releases(req.get('authorization')!.slice(7)).release(bookingId, reason);
    if (result.outcome !== 'released') {
      const [status, error] = refusal(result);
      respond(status, { error });
      return;
    }
    respond(200, { booking_id: result.booking_id, status: 'cancelled', cancelled_at: result.cancelled_at, cancellation_reason: reason });
  }));

  return router;
}
