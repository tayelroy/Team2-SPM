import type { SupabaseClient } from '@supabase/supabase-js';
import { type createAuthorization, AccessError, type Principal } from '../auth';
import { getSupabaseAdminClient } from '../db';
import { createVenueClashStore, type ClashBookingRow, type ClashRow, type VenueClashStore } from '../db/venueClashes';

export interface VenueClashDependencies {
  getAdminClient?: () => SupabaseClient | null;
  store?: (admin: SupabaseClient) => VenueClashStore;
}

export type ClashBooking = Omit<ClashBookingRow, 'coordinator_id'>;
export interface VenueClash {
  booking: ClashBooking;
  clashes_with: ClashBooking;
  flagged_at: string;
}

function strip({ coordinator_id: _coordinator, ...booking }: ClashBookingRow): ClashBooking {
  return booking;
}

/**
 * What a caller may see (SG2-79 AC3). Venue Staff see every flagged booking
 * and what it clashes with. A coordinator sees only bookings for events
 * assigned to them, and the other side's event only when it is also theirs,
 * as SG2-50 shows conflicts.
 */
export function clashesFor(rows: ClashRow[], principal: Principal): VenueClash[] {
  if (principal.role !== 'event_coordinator') {
    return rows.map(row => ({ booking: strip(row.booking), clashes_with: strip(row.clashes_with), flagged_at: row.flagged_at }));
  }
  return rows.filter(row => row.booking.coordinator_id === principal.userId).map(row => ({
    booking: strip(row.booking),
    clashes_with: row.clashes_with.coordinator_id === principal.userId
      ? strip(row.clashes_with) : { ...strip(row.clashes_with), event_id: null, event_name: null },
    flagged_at: row.flagged_at
  }));
}

/**
 * GET /api/venue-clashes — SG2-79 AC3: bookings that clash once setup and
 * turnaround time apply, each with the booking it clashes with. Flags appear
 * and clear in the database as times, bookings and releases change (AC1,
 * AC5); nothing here changes a booking (AC2).
 */
export function createVenueClashesRouter(access: ReturnType<typeof createAuthorization>, {
  getAdminClient = getSupabaseAdminClient, store = createVenueClashStore
}: VenueClashDependencies = {}) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('venue_clashes.view'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const admin = getAdminClient();
      if (!admin) throw new AccessError(503);
      res.json({ clashes: clashesFor(await store(admin).list(), access.getPrincipal(req)!) });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  });
  return router;
}
