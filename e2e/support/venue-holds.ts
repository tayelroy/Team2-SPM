import type { HoldMutationResult, VenueHoldStore } from '../../server/src/db/venueHolds';
import type { HoldNotification, VenueHoldRecord, VenueHoldValues } from '../../server/src/venues/holdFields';
import { assessSuitability, bookingReadiness } from '../../server/src/venues/suitability';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;
const INITIAL_TIME = Date.parse('2030-06-01T02:00:00.000Z');
const WARNING_LEAD = 86_400_000;
const overlaps = (row: Row, venue: number, start: string, end: string) =>
  row.venue_id === venue && Date.parse(String(row.starts_at)) < Date.parse(end) && Date.parse(String(row.ends_at)) > Date.parse(start);
const nextId = (rows: Row[], key: string) => Math.max(0, ...rows.map(row => Number(row[key]))) + 1;

/** Disposable provider state for browser tests, with a server clock independent
 * of the browser and wall clock. SQL transaction/RLS evidence comes from the
 * separate database suite; this fixture proves Express/React integration. */
export class VenueHoldFixture {
  now = INITIAL_TIME;
  constructor(private database: MemoryDatabase) { database.venueHoldNow = () => this.now; }
  reset() { this.now = INITIAL_TIME; }
  seed() {
    const base = this.database.tables.events[0];
    this.database.tables.events.push(
      { ...base, event_id: 81, name: 'Tentative Hold Forum', proposed_date: '2030-06-05T02:00:00.000Z', status: 'planning', coordinator_id: 'user-coordinator' },
      { ...base, event_id: 82, name: 'Other Coordinator Hold Forum', proposed_date: '2030-06-05T02:00:00.000Z', status: 'planning', coordinator_id: 'user-coordinator2' },
    );
  }

  advance(now: string): boolean {
    const instant = Date.parse(now);
    if (!Number.isFinite(instant) || instant < this.now) return false;
    this.now = instant;
    this.process(); // Test equivalent of an independent scheduler tick.
    return true;
  }

  private record(hold: Row): VenueHoldRecord {
    const event = this.database.tables.events.find(event => event.event_id === hold.event_id)!;
    const venue = this.database.tables.venues.find(venue => venue.venue_id === hold.venue_id)!;
    return { hold_id: Number(hold.hold_id), event_id: Number(hold.event_id), event_name: String(event.name),
      venue_id: Number(hold.venue_id), venue_name: String(venue.name), request_id: Number(hold.request_id),
      booking_id: hold.booking_id === null ? null : Number(hold.booking_id), status: hold.status as VenueHoldRecord['status'],
      starts_at: String(hold.starts_at), ends_at: String(hold.ends_at), expires_at: String(hold.expires_at), created_at: String(hold.created_at) };
  }

  private audit(hold: Row, actor: string | null, old: string | null, value: string) {
    const logs = this.database.tables.event_audit_logs;
    logs.push({ log_id: nextId(logs, 'log_id'), event_id: hold.event_id, actor_id: actor,
      field_name: 'venue_hold_status', old_value: old, new_value: value, created_at: new Date(this.now).toISOString() });
  }

  private notify(hold: Row, kind: HoldNotification['kind']) {
    const event = this.database.tables.events.find(event => event.event_id === hold.event_id)!;
    const notices = this.database.tables.venue_hold_notifications;
    if (!event.coordinator_id || notices.some(notice => notice.hold_id === hold.hold_id && notice.recipient_id === event.coordinator_id && notice.kind === kind)) return;
    const venue = this.database.tables.venues.find(venue => venue.venue_id === hold.venue_id)!;
    const prefix = { placed: 'Tentative hold placed on ', warning: 'Tentative hold expires soon on ', expired: 'Tentative hold expired on ' }[kind];
    notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: event.coordinator_id, event_id: hold.event_id,
      hold_id: hold.hold_id, kind, message: `${prefix}${venue.name}; expiry ${hold.expires_at}.`, created_at: new Date(this.now).toISOString() });
  }

  private process() {
    for (const hold of this.database.tables.venue_holds) {
      if (hold.status !== 'tentative') continue;
      if (Date.parse(String(hold.expires_at)) <= this.now) {
        hold.status = 'expired';
        const request = this.database.tables.venue_booking_requests.find(request => request.request_id === hold.request_id)!;
        if (request.status === 'pending') request.status = 'cancelled';
        this.audit(hold, null, `Tentative hold ${hold.hold_id}`, `Expired hold ${hold.hold_id}`);
        this.notify(hold, 'expired');
      } else if (hold.warning_sent_at === null && Date.parse(String(hold.expires_at)) <= this.now + WARNING_LEAD) {
        hold.warning_sent_at = new Date(this.now).toISOString();
        this.notify(hold, 'warning');
      }
    }
  }

  private conflict(values: VenueHoldValues, excludeHold?: number) {
    const active = this.database.tables.venue_holds.filter(hold => hold.status === 'tentative' && hold.hold_id !== excludeHold && Date.parse(String(hold.expires_at)) > this.now);
    return [...this.database.tables.venue_bookings, ...this.database.tables.venue_unavailability, ...active]
      .some(row => overlaps(row, values.venue_id, values.starts_at, values.ends_at));
  }

  store = (token: string): VenueHoldStore => ({
    list: async () => {
      const principal = await this.database.principal(token);
      this.process();
      return this.database.tables.venue_holds.filter(hold => principal.role !== 'event_coordinator' ||
        this.database.tables.events.find(event => event.event_id === hold.event_id)?.coordinator_id === principal.userId)
        .map(hold => this.record(hold)).sort((a, b) => b.hold_id - a.hold_id);
    },
    options: async () => ({ events: this.database.tables.events.filter(event => ['approved', 'planning'].includes(String(event.status)) && event.coordinator_id)
      .map(event => ({ event_id: Number(event.event_id), name: String(event.name) })),
    venues: this.database.tables.venues.map(venue => ({ venue_id: Number(venue.venue_id), name: String(venue.name) })) }),
    notifications: async () => {
      const principal = await this.database.principal(token);
      this.process();
      return this.database.tables.venue_hold_notifications.filter(notice => notice.recipient_id === principal.userId)
        .sort((a, b) => Number(b.notification_id) - Number(a.notification_id)).map(notice => ({
          notification_id: Number(notice.notification_id), event_id: Number(notice.event_id), hold_id: Number(notice.hold_id),
          kind: notice.kind as HoldNotification['kind'], message: String(notice.message), created_at: String(notice.created_at),
        }));
    },
    create: async (values): Promise<HoldMutationResult> => {
      const { userId } = await this.database.principal(token);
      const event = this.database.tables.events.find(event => event.event_id === values.event_id);
      const venue = this.database.tables.venues.find(venue => venue.venue_id === values.venue_id);
      if (!event || !venue) return { outcome: 'missing' };
      if (!['approved', 'planning'].includes(String(event.status)) || !event.coordinator_id || Date.parse(values.ends_at) <= this.now || Date.parse(values.expires_at) <= this.now) return { outcome: 'invalid' };
      if (this.conflict(values)) return { outcome: 'conflict' };
      const requests = this.database.tables.venue_booking_requests;
      const request = { request_id: nextId(requests, 'request_id'), event_id: values.event_id, venue_id: values.venue_id,
        starts_at: values.starts_at, ends_at: values.ends_at, status: 'pending', notes: 'Tentative hold — approval required' };
      requests.push(request);
      const hold: Row = { ...values, hold_id: nextId(this.database.tables.venue_holds, 'hold_id'), request_id: request.request_id,
        booking_id: null, status: 'tentative', created_by: userId, created_at: new Date(this.now).toISOString(), warning_sent_at: null };
      this.database.tables.venue_holds.push(hold);
      this.audit(hold, userId, null, `Tentative hold ${hold.hold_id}; expires ${hold.expires_at}`);
      this.notify(hold, 'placed');
      this.process();
      return { outcome: 'created', hold: this.record(hold) };
    },
    change: async (id, action): Promise<HoldMutationResult> => {
      const { userId } = await this.database.principal(token);
      this.process();
      const hold = this.database.tables.venue_holds.find(hold => hold.hold_id === id);
      if (!hold) return { outcome: 'missing' };
      if (hold.status !== 'tentative') return { outcome: 'inactive' };
      const request = this.database.tables.venue_booking_requests.find(request => request.request_id === hold.request_id)!;
      if (request.status !== 'pending') return { outcome: 'inactive' };
      if (action === 'convert') {
        const event = this.database.tables.events.find(event => event.event_id === hold.event_id)!;
        const venue = this.database.tables.venues.find(venue => venue.venue_id === hold.venue_id)!;
        if (!['approved', 'planning'].includes(String(event.status)) || Date.parse(String(hold.ends_at)) <= this.now) return { outcome: 'invalid' };
        if (this.conflict(this.record(hold), id)) return { outcome: 'conflict' };
        const suitability = assessSuitability({ expected_attendance: event.expected_attendance as number | null,
          venue_requirements: event.venue_requirements as string | null, accessibility_needs: event.accessibility_needs as string | null },
        { capacity: venue.capacity as number | null, facilities: venue.facilities as string | null, accessibility_features: venue.accessibility_features as string | null });
        const readiness = bookingReadiness(suitability, this.database.tables.venue_capacity_exceptions.filter(exception => exception.request_id === request.request_id)
          .map(exception => ({ expected_attendance: Number(exception.expected_attendance) })));
        if (readiness === 'blocked') return { outcome: 'suitability' };
        if (readiness === 'needs_capacity_exception') return { outcome: 'capacity' };
        const booking = { booking_id: nextId(this.database.tables.venue_bookings, 'booking_id'), venue_id: hold.venue_id,
          event_id: hold.event_id, starts_at: hold.starts_at, ends_at: hold.ends_at, status: 'confirmed' };
        this.database.tables.venue_bookings.push(booking);
        hold.status = 'converted'; hold.booking_id = booking.booking_id; request.status = 'approved'; event.venue_booking_id = booking.booking_id;
      } else { hold.status = 'released'; request.status = 'cancelled'; }
      this.audit(hold, userId, `Tentative hold ${hold.hold_id}`, `${action === 'convert' ? 'Converted' : 'Released'} hold ${hold.hold_id}`);
      return { outcome: 'updated', hold: this.record(hold) };
    },
  });
}
