import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;

const nextId = (rows: Row[], key: string) => Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** to_char(... at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI') || ' SGT' */
function sgt(iso: string | null) {
  if (iso === null) return 'not set';
  const at = new Date(Date.parse(iso) + 8 * 3600_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(at.getUTCDate())} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} SGT`;
}

/** What an attendee sees of an event's date, time and venue. */
export interface AttendeeDetails { proposed_date: string | null; venue_ids: number[]; venue_names: string | null }

export function attendeeDetails(database: MemoryDatabase, eventId: number): AttendeeDetails {
  const event = database.tables.events.find(row => row.event_id === eventId);
  const ids = new Set(database.tables.venue_bookings
    .filter(row => row.event_id === eventId && row.status === 'confirmed').map(row => Number(row.venue_id)));
  const venues = database.tables.venues.filter(row => ids.has(Number(row.venue_id)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)) || Number(a.venue_id) - Number(b.venue_id));
  return {
    proposed_date: (event?.proposed_date ?? null) as string | null,
    venue_ids: [...ids].sort((a, b) => a - b),
    venue_names: venues.length ? venues.map(row => String(row.name)).join(', ') : null
  };
}

/**
 * SG2-102: test equivalent of private.announce_event_attendee_details(). The
 * database runs it at commit; each in-memory RPC is one transaction, so it
 * takes `before` on entry and announces here on the way out. Every active
 * registration of an event that is not cancelled gets one event_changed
 * notice naming what changed. The SQL suite carries the trigger evidence.
 */
export function announceAttendeeChange(database: MemoryDatabase, eventId: number, before: AttendeeDetails) {
  const event = database.tables.events.find(row => row.event_id === eventId);
  if (!event || event.status === 'cancelled') return;
  const after = attendeeDetails(database, eventId);
  const changes: string[] = [];
  const instant = (value: string | null) => value === null ? null : Date.parse(value);
  if (instant(before.proposed_date) !== instant(after.proposed_date)) {
    changes.push(`Date and time: ${sgt(before.proposed_date)} → ${sgt(after.proposed_date)}.`);
  }
  if (before.venue_ids.join() !== after.venue_ids.join()) {
    changes.push(`Venue: ${before.venue_names ?? 'none confirmed'} → ${after.venue_names ?? 'none confirmed'}.`);
  }
  if (changes.length === 0) return;
  const message = `${String(event.name || 'Untitled event').slice(0, 200)} has changed. ${changes.join(' ')}`
    + ' Open My registrations for the latest details.';
  const attendees = new Set(database.tables.registrations
    .filter(row => row.event_id === eventId && String(row.status ?? '').toLowerCase() !== 'cancelled')
    .map(row => row.attendee_id));
  const notices = database.tables.notifications;
  for (const recipient of attendees) {
    notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: recipient, event_id: eventId,
      request_id: null, kind: 'event_changed', message, created_at: new Date().toISOString() });
  }
}
