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
import type { BookingRequestRow } from '../db/venueSuitability';
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

// 24-hour clock, as the client shows times.
const sgt = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23', timeZone: 'Asia/Singapore' });

/** "confirmed booking #12 for Gala Night (6 Oct 2026, 09:00 – 6 Oct 2026, 17:00)". */
export function describeConflict(conflict: VenueConflict): string {
  const what = conflict.kind === 'hold' ? `tentative hold #${conflict.reference_id}` : `${conflict.status} booking #${conflict.reference_id}`;
  const event = conflict.event_name ?? (conflict.event_id === null ? 'another event' : `event #${conflict.event_id}`);
  return `${what} for ${event} (${sgt.format(new Date(conflict.starts_at))} – ${sgt.format(new Date(conflict.ends_at))})`;
}

/**
 * SG2-50 AC2: approval of a request is refused while anything else commits
 * the venue over an overlapping period. The decision step (SG2-49) calls this
 * before committing the booking and answers 409 with the refusal; the
 * venue_bookings_no_double_booking constraint refuses the write regardless.
 */
export async function approvalRefusal(
  store: Pick<VenueConflictStore, 'conflicts'>,
  request: BookingRequestRow,
  principal: Principal,
  now: number
): Promise<{ error: string; conflicts: VenueConflict[] } | null> {
  const conflicts = await conflictsFor(store, request, principal, now, request.request_id);
  if (conflicts.length === 0) return null;
  return {
    error: `This request cannot be approved while it conflicts with ${conflicts.map(describeConflict).join('; ')}.`,
    conflicts
  };
}

/** Conflicts for a period about to be requested, as the caller may see them. */
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
