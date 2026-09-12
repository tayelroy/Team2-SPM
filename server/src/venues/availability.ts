import type { Request, RequestHandler } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authorization } from '../auth';
import { createUserScopedClient } from '../db/user-client';

export type AvailabilityKind = 'booking' | 'unavailable';

/** One occupied period for a venue: a booking or a recorded unavailability. */
export interface AvailabilityEntry {
  start: string;
  end: string;
  kind: AvailabilityKind;
  /** What is occupying the venue: booking status (+ event) or the reason. */
  label: string;
}

export interface VenueAvailabilitySummary {
  venueId: number;
  name: string;
  entries: AvailabilityEntry[];
}

export type VenueAvailabilityResult =
  | { outcome: 'ok'; entries: AvailabilityEntry[] }
  | { outcome: 'invalid'; message: string }
  | { outcome: 'unavailable' };

export type AllVenuesAvailabilityResult =
  | { outcome: 'ok'; venues: VenueAvailabilitySummary[] }
  | { outcome: 'invalid'; message: string }
  | { outcome: 'unavailable' };

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i;

interface BookingRow { starts_at: string; ends_at: string; status: string; event_id: number | null }
interface UnavailabilityRow { starts_at: string; ends_at: string; reason: string }
interface VenueRow { venue_id: number; name: string }

function parseVenueId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return Number(value);
  return null;
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

type RangeResult =
  | { ok: true; fromIso: string; toIso: string }
  | { ok: false; message: string };

/** Shared from/to validation for both the single-venue and all-venues reads. */
function parseRange(from: unknown, to: unknown): RangeResult {
  const fromMs = parseInstant(from);
  const toMs = parseInstant(to);
  if (fromMs === null || toMs === null) {
    return { ok: false, message: 'from and to must be ISO 8601 date-times.' };
  }
  if (fromMs >= toMs) {
    return { ok: false, message: 'from must be earlier than to.' };
  }
  if (toMs - fromMs > MAX_RANGE_DAYS * DAY_MS) {
    return { ok: false, message: `The date range must not exceed ${MAX_RANGE_DAYS} days.` };
  }
  return { ok: true, fromIso: new Date(fromMs).toISOString(), toIso: new Date(toMs).toISOString() };
}

function sortByStart(a: AvailabilityEntry, b: AvailabilityEntry): number {
  return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
}

function bookingEntry(row: BookingRow): AvailabilityEntry {
  return {
    start: row.starts_at,
    end: row.ends_at,
    kind: 'booking',
    label: row.event_id === null ? row.status : `${row.status} · event ${row.event_id}`
  };
}

function unavailabilityEntry(row: UnavailabilityRow): AvailabilityEntry {
  return { start: row.starts_at, end: row.ends_at, kind: 'unavailable', label: row.reason };
}

/**
 * Reads a venue's occupied periods over [from, to): bookings and recorded
 * unavailability whose interval overlaps the range, merged and sorted by start.
 * The client must carry the caller's access token so RLS restricts this to the
 * internal scheduling roles.
 */
export async function getVenueAvailability(
  venueId: unknown,
  from: unknown,
  to: unknown,
  client: SupabaseClient | null
): Promise<VenueAvailabilityResult> {
  const id = parseVenueId(venueId);
  if (id === null) {
    return { outcome: 'invalid', message: 'A positive integer venue id is required.' };
  }

  const range = parseRange(from, to);
  if (!range.ok) return { outcome: 'invalid', message: range.message };
  if (!client) return { outcome: 'unavailable' };

  const [bookings, unavailability] = await Promise.all([
    client
      .from('venue_bookings')
      .select('starts_at, ends_at, status, event_id')
      .eq('venue_id', id)
      .lt('starts_at', range.toIso)
      .gt('ends_at', range.fromIso)
      .order('starts_at', { ascending: true }),
    client
      .from('venue_unavailability')
      .select('starts_at, ends_at, reason')
      .eq('venue_id', id)
      .lt('starts_at', range.toIso)
      .gt('ends_at', range.fromIso)
      .order('starts_at', { ascending: true })
  ]);

  if (bookings.error || unavailability.error) {
    return { outcome: 'unavailable' };
  }

  const entries: AvailabilityEntry[] = [
    ...((bookings.data ?? []) as BookingRow[]).map(bookingEntry),
    ...((unavailability.data ?? []) as UnavailabilityRow[]).map(unavailabilityEntry)
  ].sort(sortByStart);

  return { outcome: 'ok', entries };
}

/**
 * Reads every venue's occupied periods over [from, to) in one call: every
 * venue is included (even with no entries), so the caller sees the full
 * catalogue against the chosen date range rather than picking a venue first.
 */
export async function getAllVenuesAvailability(
  from: unknown,
  to: unknown,
  client: SupabaseClient | null
): Promise<AllVenuesAvailabilityResult> {
  const range = parseRange(from, to);
  if (!range.ok) return { outcome: 'invalid', message: range.message };
  if (!client) return { outcome: 'unavailable' };

  const [venues, bookings, unavailability] = await Promise.all([
    client.from('venues').select('venue_id, name').order('name', { ascending: true }),
    client
      .from('venue_bookings')
      .select('venue_id, starts_at, ends_at, status, event_id')
      .lt('starts_at', range.toIso)
      .gt('ends_at', range.fromIso),
    client
      .from('venue_unavailability')
      .select('venue_id, starts_at, ends_at, reason')
      .lt('starts_at', range.toIso)
      .gt('ends_at', range.fromIso)
  ]);

  if (venues.error || bookings.error || unavailability.error) {
    return { outcome: 'unavailable' };
  }

  const entriesByVenue = new Map<number, AvailabilityEntry[]>();
  const addEntry = (venueId: number, entry: AvailabilityEntry) => {
    const list = entriesByVenue.get(venueId);
    if (list) list.push(entry);
    else entriesByVenue.set(venueId, [entry]);
  };

  for (const row of (bookings.data ?? []) as (BookingRow & { venue_id: number })[]) {
    addEntry(row.venue_id, bookingEntry(row));
  }
  for (const row of (unavailability.data ?? []) as (UnavailabilityRow & { venue_id: number })[]) {
    addEntry(row.venue_id, unavailabilityEntry(row));
  }

  const summaries: VenueAvailabilitySummary[] = ((venues.data ?? []) as VenueRow[]).map((venue) => ({
    venueId: venue.venue_id,
    name: venue.name,
    entries: (entriesByVenue.get(venue.venue_id) ?? []).sort(sortByStart)
  }));

  return { outcome: 'ok', venues: summaries };
}

function bearerToken(req: Request): string | null {
  const match = BEARER.exec(req.get('authorization') ?? '');
  return match ? match[1] : null;
}

/**
 * GET /:venueId/availability?from=<iso>&to=<iso>
 * Runs behind requireAuth + requirePermission('venues.availability.view').
 */
export function createAvailabilityHandler(
  getAvailability: typeof getVenueAvailability = getVenueAvailability,
  makeClient: (token: string) => SupabaseClient | null = createUserScopedClient
): RequestHandler {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = bearerToken(req);
    const client = token ? makeClient(token) : null;
    const result = await getAvailability(req.params.venueId, req.query.from, req.query.to, client);

    if (result.outcome === 'invalid') {
      res.status(400).json({ error: result.message });
      return;
    }
    if (result.outcome === 'unavailable') {
      res.status(503).json({ error: 'Venue availability is temporarily unavailable.' });
      return;
    }
    res.status(200).json({
      venueId: Number(req.params.venueId),
      from: req.query.from,
      to: req.query.to,
      entries: result.entries
    });
  };
}

/**
 * GET /availability?from=<iso>&to=<iso> — every venue, one date range.
 * Runs behind requireAuth + requirePermission('venues.availability.view').
 */
export function createAllVenuesAvailabilityHandler(
  getAvailability: typeof getAllVenuesAvailability = getAllVenuesAvailability,
  makeClient: (token: string) => SupabaseClient | null = createUserScopedClient
): RequestHandler {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const token = bearerToken(req);
    const client = token ? makeClient(token) : null;
    const result = await getAvailability(req.query.from, req.query.to, client);

    if (result.outcome === 'invalid') {
      res.status(400).json({ error: result.message });
      return;
    }
    if (result.outcome === 'unavailable') {
      res.status(503).json({ error: 'Venue availability is temporarily unavailable.' });
      return;
    }
    res.status(200).json({ from: req.query.from, to: req.query.to, venues: result.venues });
  };
}

/** Router for venue endpoints. Every route requires a verified caller. */
export function createVenuesRouter(access = authorization) {
  const router = access.protectedRouter();
  const requireView = access.requirePermission('venues.availability.view');
  router.get('/availability', requireView, createAllVenuesAvailabilityHandler());
  router.get('/:venueId/availability', requireView, createAvailabilityHandler());
  return router;
}
