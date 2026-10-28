import { AccessError } from '../../server/src/auth/policy';
import type { ReleaseResult, VenueBookingReleaseStore } from '../../server/src/db/venueBookings';
import { announceAttendeeChange, attendeeDetails } from './attendee-change-notices';
import type { MemoryDatabase } from './memory-database';

const nextId = (rows: Record<string, unknown>[], key: string) => Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
const sgt = (iso: unknown) => new Date(Date.parse(String(iso)) + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

/**
 * SG2-51/SG2-83: test equivalent of release_venue_bookings() for the browser
 * suite, answering as the signed-in person. Only the event's coordinator
 * cancels (SG2-83 AC5), the others named go with it (AC2), Venue Staff are
 * told (AC4) and a Confirmed or Preparation event returns to Planning (AC7).
 * The SQL suite carries the locking and constraint evidence.
 */
export function createMemoryReleaseStore(database: MemoryDatabase) {
  return (token: string): VenueBookingReleaseStore => ({
    async release(bookingId, reason, also): Promise<ReleaseResult> {
      const userId = database.sessions.get(token);
      const role = database.tables.account_roles.find(row => row.user_id === userId)?.role;
      if (role !== 'event_coordinator') throw new AccessError(403);
      const trimmed = reason.trim();
      if (!trimmed || Array.from(trimmed).length > 500) return { outcome: 'invalid' };
      const booking = database.tables.venue_bookings.find(row => row.booking_id === bookingId);
      if (!booking) return { outcome: 'missing' };
      const event = database.tables.events.find(row => row.event_id === booking.event_id);
      if (!event || event.coordinator_id !== userId) return { outcome: 'missing' };
      if (booking.status !== 'confirmed') return { outcome: 'inactive', status: String(booking.status) };
      const now = new Date().toISOString();
      if (String(booking.ends_at) <= now) return { outcome: 'past' };
      const others = also.map(id => database.tables.venue_bookings.find(row => row.booking_id === id));
      if (others.some(other => !other || other.event_id !== event.event_id || other.status !== 'confirmed' || String(other.ends_at) <= now)) {
        return { outcome: 'others_invalid' };
      }
      const shown = attendeeDetails(database, Number(event.event_id));
      const actor = database.tables.users.find(row => row.user_id === userId)?.name ?? 'The coordinator';
      for (const cancelled of [booking, ...others as typeof booking[]]) {
        const id = cancelled.booking_id;
        Object.assign(cancelled, { status: 'cancelled', cancelled_by: userId, cancelled_at: now, cancellation_reason: trimmed });
        // SG2-79: releasing a booking resolves any clash it was part of.
        database.refreshVenueClashes(cancelled.venue_id);
        for (const request of database.tables.venue_booking_requests) {
          if (request.venue_booking_id === id && request.status === 'approved') request.status = 'cancelled';
        }
        const venue = database.tables.venues.find(row => row.venue_id === cancelled.venue_id)!;
        // SG2-83 AC1: a change still waiting to replace this booking is withdrawn.
        for (const change of database.tables.venue_booking_requests) {
          if (change.replaces_booking_id !== id || change.status !== 'pending') continue;
          Object.assign(change, { status: 'cancelled', withdrawn_by: userId, withdrawn_at: now });
          const target = database.tables.venues.find(row => row.venue_id === change.venue_id)?.name;
          database.tables.event_audit_logs.push({ log_id: nextId(database.tables.event_audit_logs, 'log_id'), event_id: event.event_id,
            actor_id: userId, field_name: 'venue_booking_request', old_value: `Pending: ${target} (request ${change.request_id})`,
            new_value: `Withdrawn: ${target} (request ${change.request_id}) — the booking it would replace, ${venue.name} (booking ${id}), was released`,
            created_at: now });
        }
        const period = `${sgt(cancelled.starts_at)} – ${sgt(cancelled.ends_at)} SGT`;
        database.tables.event_audit_logs.push({ log_id: nextId(database.tables.event_audit_logs, 'log_id'), event_id: event.event_id,
          actor_id: userId, field_name: 'venue_booking', old_value: `Confirmed: ${venue.name} (booking ${id})`,
          new_value: `Released: ${venue.name} (booking ${id}) — ${trimmed}`, created_at: now });
        const notify = (recipient: unknown, kind: string, message: string) => database.tables.notifications.push({
          notification_id: nextId(database.tables.notifications, 'notification_id'), recipient_id: recipient,
          event_id: event.event_id, request_id: null, kind, message, created_at: now });
        for (const recipient of new Set([event.coordinator_id, event.organiser_id].filter(Boolean))) {
          notify(recipient, 'venue_booking_released', `${venue.name} was released for ${event.name || 'Untitled event'} (${period}): ${trimmed}`);
        }
        for (const staff of database.tables.account_roles.filter(row => row.role === 'venue_staff' && row.user_id !== userId)) {
          notify(staff.user_id, 'venue_booking_cancelled', `${actor} cancelled the booking of ${venue.name} for ${event.name || 'Untitled event'}`
            + ` (${period}): ${trimmed}. The venue is available again for that period.`);
        }
      }
      if ([bookingId, ...also].includes(Number(event.venue_booking_id))) {
        event.venue_booking_id = database.tables.venue_bookings
          .filter(row => row.event_id === event.event_id && row.status === 'confirmed' && String(row.ends_at) > now)
          .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0]?.booking_id ?? null;
      }
      const returned = event.status === 'confirmed' || event.status === 'preparation';
      if (returned) {
        database.tables.event_audit_logs.push({ log_id: nextId(database.tables.event_audit_logs, 'log_id'), event_id: event.event_id,
          actor_id: userId, field_name: 'status', old_value: event.status, new_value: 'planning', created_at: now });
        const outstanding = Array.isArray(event.outstanding_arrangements) ? event.outstanding_arrangements as string[] : [];
        Object.assign(event, { status: 'planning', confirmed_by: null, confirmed_at: null, arrangements_recheck_needed: true,
          outstanding_arrangements: outstanding.includes('venue_recheck') ? outstanding : [...outstanding, 'venue_recheck'] });
      }
      // SG2-102: a cancelled venue reaches registered attendees at commit.
      announceAttendeeChange(database, Number(event.event_id), shown);
      return { outcome: 'released', booking_id: bookingId, cancelled_at: now, also_released: also, returned_to_planning: returned };
    }
  });
}
