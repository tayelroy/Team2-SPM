import { AccessError } from '../../server/src/auth/policy';
import type { DecisionResult, VenueBookingDecisionStore } from '../../server/src/db/venueBookingDecisions';
import type { NotificationRecord } from '../../server/src/db/notifications';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const overlaps = (row: Row, request: Row) => row.venue_id === request.venue_id
  && String(row.starts_at) < String(request.ends_at) && String(row.ends_at) > String(request.starts_at);
const nextId = (rows: Row[], key: string) => Math.max(0, ...rows.map(row => Number(row[key]))) + 1;

/**
 * SG2-49: test equivalent of decide_venue_booking_request() for the browser
 * suite, answering as the signed-in Venue Staff member. The SQL suite and its
 * concurrency script carry the transaction and locking evidence.
 */
export function createMemoryDecisionStore(database: MemoryDatabase) {
  return (token: string): VenueBookingDecisionStore => ({
    async decide(requestId, decision, reason): Promise<DecisionResult> {
      const userId = database.sessions.get(token);
      if (database.tables.account_roles.find(row => row.user_id === userId)?.role !== 'venue_staff') throw new AccessError(403);
      const request = database.tables.venue_booking_requests.find(row => row.request_id === requestId);
      if (!request) return { outcome: 'missing' };
      if (request.status !== 'pending') return { outcome: 'decided', status: String(request.status) };
      const hold = database.tables.venue_holds.find(row => row.request_id === requestId);
      if (hold) return { outcome: 'hold', hold_id: Number(hold.hold_id) };
      const event = database.tables.events.find(row => row.event_id === request.event_id)!;
      const venue = database.tables.venues.find(row => row.venue_id === request.venue_id)!;
      const now = new Date().toISOString();
      let booking: number | null = null;
      if (decision === 'approve') {
        if (!['approved', 'planning'].includes(String(event.status)) || String(request.ends_at) <= now) return { outcome: 'closed' };
        const name = (eventId: unknown) => String(database.tables.events.find(row => row.event_id === eventId)?.name || 'Untitled event');
        const confirmed = database.tables.venue_bookings.find(row => row.status === 'confirmed' && overlaps(row, request));
        if (confirmed) return { outcome: 'conflict', kind: 'booking', starts_at: String(confirmed.starts_at), ends_at: String(confirmed.ends_at), label: name(confirmed.event_id) };
        const block = database.tables.venue_unavailability.find(row => overlaps(row, request));
        if (block) return { outcome: 'conflict', kind: 'block', starts_at: String(block.starts_at), ends_at: String(block.ends_at), label: String(block.reason) };
        const held = database.tables.venue_holds.find(row => row.status === 'tentative' && Date.parse(String(row.expires_at)) > database.venueHoldNow() && overlaps(row, request));
        if (held) return { outcome: 'conflict', kind: 'hold', starts_at: String(held.starts_at), ends_at: String(held.ends_at), label: name(held.event_id) };
        const attendance = event.expected_attendance as number | null;
        if (attendance !== null && (venue.capacity === null || attendance > Number(venue.capacity))
            && !database.tables.venue_capacity_exceptions.some(row => row.request_id === requestId && Number(row.expected_attendance) >= attendance)) {
          return { outcome: 'capacity' };
        }
        booking = nextId(database.tables.venue_bookings, 'booking_id');
        database.tables.venue_bookings.push({ booking_id: booking, venue_id: request.venue_id, event_id: request.event_id,
          starts_at: request.starts_at, ends_at: request.ends_at, status: 'confirmed' });
        event.venue_booking_id ??= booking;
      }
      const status = decision === 'approve' ? 'approved' : 'rejected';
      Object.assign(request, { status, decided_by: userId, decided_at: now, decision_reason: reason, venue_booking_id: booking });
      database.tables.event_audit_logs.push({ log_id: nextId(database.tables.event_audit_logs, 'log_id'), event_id: request.event_id,
        actor_id: userId, field_name: 'venue_booking_request', old_value: `Pending: ${venue.name} (request ${requestId})`,
        new_value: `${status[0].toUpperCase()}${status.slice(1)}: ${venue.name} (request ${requestId})${reason ? ` — ${reason}` : ''}`, created_at: now });
      if (event.coordinator_id) {
        database.tables.notifications.push({ notification_id: nextId(database.tables.notifications, 'notification_id'),
          recipient_id: event.coordinator_id, event_id: request.event_id, request_id: requestId, kind: `venue_request_${status}`,
          message: `${venue.name} was ${status} for ${event.name || 'Untitled event'}${status === 'rejected' ? `: ${reason}` : '.'}`, created_at: now });
      }
      return { outcome: 'updated', request_id: requestId, status, venue_booking_id: booking, decided_at: now };
    }
  });
}

/** The signed-in person's notices, newest first, as row level security allows. */
export function memoryNotifications(database: MemoryDatabase) {
  return async (_token: string, userId: string): Promise<NotificationRecord[]> =>
    database.tables.notifications.filter(row => row.recipient_id === userId)
      .sort((a, b) => Number(b.notification_id) - Number(a.notification_id))
      .map(({ recipient_id: _recipient, ...row }) => row as unknown as NotificationRecord);
}
