export interface VenueHoldValues {
  event_id: number;
  venue_id: number;
  starts_at: string;
  ends_at: string;
  expires_at: string;
}
export interface VenueHoldRecord extends VenueHoldValues {
  hold_id: number;
  event_name: string;
  venue_name: string;
  status: 'tentative' | 'converted' | 'released' | 'expired';
  request_id: number;
  booking_id: number | null;
  created_at: string;
}
export interface HoldNotification {
  notification_id: number;
  event_id: number;
  hold_id: number;
  kind: 'placed' | 'warning' | 'expired';
  message: string;
  created_at: string;
}
export function parseHoldId(raw: string): number | null {
  return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}
function instant(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return null;
  const time = Date.parse(raw);
  const day = Date.parse(`${raw.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(time) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === raw.slice(0, 10) ? time : null;
}
/** Date-times must include a zone; the database rechecks deadlines under its lock. */
export function validateVenueHold(body: unknown, now: number): VenueHoldValues | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some(key => !['event_id', 'venue_id', 'starts_at', 'ends_at', 'expires_at'].includes(key))) return null;
  const { event_id, venue_id } = record;
  if (typeof event_id !== 'number' || !Number.isInteger(event_id) || event_id < 1 || event_id > 2147483647
    || typeof venue_id !== 'number' || !Number.isInteger(venue_id) || venue_id < 1 || venue_id > 2147483647) return null;
  const start = instant(record.starts_at); const end = instant(record.ends_at); const expiry = instant(record.expires_at);
  if (start === null || end === null || expiry === null || end <= start || end <= now || expiry <= now) return null;
  return { event_id, venue_id, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), expires_at: new Date(expiry).toISOString() };
}
