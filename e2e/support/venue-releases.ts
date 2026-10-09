import { AccessError } from '../../server/src/auth/policy';
import type { ReleaseResult, VenueBookingReleaseStore } from '../../server/src/db/venueBookings';
import type { MemoryDatabase } from './memory-database';

const nextId = (rows: Record<string, unknown>[], key: string) => Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
const sgt = (iso: unknown) => new Date(Date.parse(String(iso)) + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

/**
 * SG2-51: test equivalent of release_venue_booking() for the browser suite,
 * answering as the signed-in person. The SQL suite carries the locking and
 * constraint evidence.
 */
export function createMemoryReleaseStore(database: MemoryDatabase) {
  return (token: string): VenueBookingReleaseStore => ({
    async release(bookingId, reason): Promise<ReleaseResult> {
      const userId = database.sessions.get(token);
      const role = database.tables.account_roles.find(row => row.user_id === userId)?.role;
      if (role !== 'venue_staff' && role !== 'event_coordinator') throw new AccessError(403);
      const trimmed = reason.trim();
      if (!trimmed || Array.from(trimmed).length > 500) return { outcome: 'invalid' };
      const booking = database.tables.venue_bookings.find(row => row.booking_id === bookingId);
      if (!booking) return { outcome: 'missing' };
      const event = database.tables.events.find(row => row.event_id === booking.event_id);
      if (role === 'event_coordinator' && (!event || event.coordinator_id !== userId)) return { outcome: 'missing' };
      if (booking.status !== 'confirmed') return { outcome: 'inactive', status: String(booking.status) };
      const now = new Date().toISOString();
      if (String(booking.ends_at) <= now) return { outcome: 'past' };
      Object.assign(booking, { status: 'cancelled', cancelled_by: userId, cancelled_at: now, cancellation_reason: trimmed });
      for (const request of database.tables.venue_booking_requests) {
        if (request.venue_booking_id === bookingId && request.status === 'approved') request.status = 'cancelled';
      }
      if (event) {
        const venue = database.tables.venues.find(row => row.venue_id === booking.venue_id)!;
        if (event.venue_booking_id === bookingId) {
          event.venue_booking_id = database.tables.venue_bookings
            .filter(row => row.event_id === event.event_id && row.status === 'confirmed' && String(row.ends_at) > now)
            .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0]?.booking_id ?? null;
        }
        database.tables.event_audit_logs.push({ log_id: nextId(database.tables.event_audit_logs, 'log_id'), event_id: event.event_id,
          actor_id: userId, field_name: 'venue_booking', old_value: `Confirmed: ${venue.name} (booking ${bookingId})`,
          new_value: `Released: ${venue.name} (booking ${bookingId}) — ${trimmed}`, created_at: now });
        for (const recipient of new Set([event.coordinator_id, event.organiser_id].filter(Boolean))) {
          database.tables.notifications.push({ notification_id: nextId(database.tables.notifications, 'notification_id'),
            recipient_id: recipient, event_id: event.event_id, request_id: null, kind: 'venue_booking_released',
            message: `${venue.name} was released for ${event.name || 'Untitled event'} (${sgt(booking.starts_at)} – ${sgt(booking.ends_at)} SGT): ${trimmed}`,
            created_at: now });
        }
      }
      return { outcome: 'released', booking_id: bookingId, cancelled_at: now };
    }
  });
}
