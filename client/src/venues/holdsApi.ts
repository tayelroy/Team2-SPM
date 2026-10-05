export interface VenueHold {
  hold_id: number;
  event_id: number;
  event_name: string;
  venue_id: number;
  venue_name: string;
  starts_at: string;
  ends_at: string;
  expires_at: string;
  status: 'tentative' | 'converted' | 'released' | 'expired';
  booking_id: number | null;
  request_id: number;
  created_at: string;
}
export type HoldValues = Pick<VenueHold, 'event_id' | 'venue_id' | 'starts_at' | 'ends_at' | 'expires_at'>;
export interface HoldOptions {
  events: { event_id: number; name: string }[];
  venues: { venue_id: number; name: string }[];
}
export type HoldResult<T> = { ok: true; data: T } | { ok: false; error: string };
const UNAVAILABLE = 'Venue holds are temporarily unavailable. Please try again.';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isHold(value: unknown): value is VenueHold {
  return record(value)
    && ['hold_id', 'event_id', 'venue_id'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) > 0)
    && ['event_name', 'venue_name'].every(key => typeof value[key] === 'string')
    && ['starts_at', 'ends_at', 'expires_at'].every(key => typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key] as string)))
    && ['tentative', 'converted', 'released', 'expired'].includes(value.status as string);
}
function isOption(value: unknown, id: string) {
  return record(value) && Number.isSafeInteger(value[id]) && Number(value[id]) > 0 && typeof value.name === 'string';
}

async function request<T>(token: string, path: string, decode: (body: any) => T | null, values?: HoldValues, mutate = false): Promise<HoldResult<T>> {
  if (!token) return { ok: false, error: 'Sign in again to manage venue holds.' };
  try {
    const response = await fetch(`/api/venue-holds${path}`, {
      ...(mutate ? { method: 'POST' } : {}),
      headers: { Authorization: `Bearer ${token}`, ...(values ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store',
      ...(values ? { body: JSON.stringify(values) } : {}),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, error: 'Your account cannot manage these holds. Sign in again.' };
    if ([400, 404, 409].includes(response.status)) {
      const body = await response.json().catch(() => null);
      return { ok: false, error: typeof body?.error === 'string' ? body.error : 'This hold could not be saved. Refresh and try again.' };
    }
    if (!response.ok) throw new Error(UNAVAILABLE);
    const data = decode(await response.json());
    if (data === null) throw new Error(UNAVAILABLE);
    return { ok: true, data };
  } catch {
    return { ok: false, error: UNAVAILABLE };
  }
}

export function fetchHolds(token: string): Promise<HoldResult<VenueHold[]>> {
  return request(token, '', body => Array.isArray(body?.holds) && body.holds.every(isHold) ? body.holds : null);
}
export function fetchHoldOptions(token: string): Promise<HoldResult<HoldOptions>> {
  return request(token, '/options', body => Array.isArray(body?.events) && Array.isArray(body.venues)
    && body.events.every((item: unknown) => isOption(item, 'event_id'))
    && body.venues.every((item: unknown) => isOption(item, 'venue_id')) ? body : null);
}
export function createHold(token: string, values: HoldValues): Promise<HoldResult<VenueHold>> {
  return request(token, '', body => isHold(body?.hold) ? body.hold : null, values, true);
}
export function changeHold(token: string, id: number, action: 'convert' | 'release'): Promise<HoldResult<VenueHold>> {
  return request(token, `/${id}/${action}`, body => isHold(body?.hold) ? body.hold : null, undefined, true);
}
