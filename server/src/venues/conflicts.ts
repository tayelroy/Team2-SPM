import type { RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type createAuthorization, AccessError, type Principal } from '../auth';
import { getSupabaseAdminClient } from '../db';
import {
  createVenueConflictStore,
  type ConflictPeriod,
  type VenueConflict,
  type VenueConflictRow,
  type VenueConflictStore
} from '../db/venueConflicts';
import { canSeeEvent, parseId } from './suitabilityRoutes';

export interface VenueConflictDependencies {
  getAdminClient?: () => SupabaseClient | null;
  store?: (admin: SupabaseClient) => VenueConflictStore;
  now?: () => number;
}

/**
 * What a caller may see of each conflict. Venue Staff decide across every
 * event and see which event holds the venue; a coordinator sees the event
 * only when it is one they coordinate, otherwise just that the venue is
 * taken, when and how (the same limit SG2-84's occupancy view applies).
 */
export function forViewer(rows: VenueConflictRow[], principal: Principal): VenueConflict[] {
  return rows.map(({ coordinator_id, ...conflict }) =>
    principal.role === 'event_coordinator' && coordinator_id !== principal.userId
      ? { ...conflict, event_id: null, event_name: null }
      : conflict);
}

/**
 * Conflicts for a period, as the caller may see them (SG2-50 AC1). Approval
 * itself is refused by SG2-49's decide_venue_booking_request(), which checks
 * the same confirmed bookings and live holds under the venue lock (AC2), with
 * venue_bookings_no_double_booking as the backstop.
 */
export async function conflictsFor(store: Pick<VenueConflictStore, 'conflicts'>, period: ConflictPeriod, principal: Principal, now: number, excludeRequestId?: number) {
  return forViewer(await store.conflicts(period, { now: new Date(now).toISOString(), excludeRequestId }), principal);
}

type Respond = (status: number, body?: unknown) => void;

function handler(
  access: ReturnType<typeof createAuthorization>,
  { getAdminClient = getSupabaseAdminClient, store = createVenueConflictStore }: VenueConflictDependencies,
  run: (database: VenueConflictStore, principal: Principal, req: Parameters<RequestHandler>[0], respond: Respond) => Promise<void>
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
 * GET /api/venue-booking-requests/:requestId/conflicts — SG2-50 AC1: what a
 * pending request overlaps at its venue, so Venue Staff see the clash before
 * deciding. Only a pending request competes for the venue; once decided it
 * reports none. Venue Staff see any request, a coordinator only those for
 * events assigned to them.
 */
export function createVenueConflictsRouter(access: ReturnType<typeof createAuthorization>, dependencies: VenueConflictDependencies = {}) {
  const router = access.protectedRouter();
  const now = dependencies.now ?? Date.now;

  router.get('/:requestId/conflicts', access.requirePermission('venue_booking.conflicts.view'), handler(access, dependencies, async (database, principal, req, respond) => {
    const requestId = parseId(req.params.requestId);
    if (requestId === null) {
      respond(400, { error: 'Invalid booking request ID.' });
      return;
    }
    const request = await database.request(requestId);
    const event = request && await database.event(request.event_id);
    if (!request || !event || !canSeeEvent(principal, event)) {
      respond(404, { error: 'Booking request not found.' });
      return;
    }
    const conflicts = request.status === 'pending' ? await conflictsFor(database, request, principal, now(), request.request_id) : [];
    respond(200, { request_id: request.request_id, status: request.status, conflicts });
  }));

  return router;
}
