import type { Request, Response } from 'express';
import { AccessError, authorization } from '../auth';
import { createEventSearchStore, type EventSearchFilters } from '../db/eventSearch';
import { isEventCategory, isEventStatus } from '../events/fields';

const UNAVAILABLE_MESSAGE = 'Event search is temporarily unavailable. Please try again.';
const MAX_QUERY_LENGTH = 255;
// Account ids are UUIDs in production; anything id-shaped is passed on and
// simply matches no event if it is no coordinator's.
const ACCOUNT_ID = /^[A-Za-z0-9-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Parsed = { ok: true; filters: EventSearchFilters } | { ok: false; error: string };

/** A calendar day in YYYY-MM-DD form that actually exists (no 31 February). */
function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * SG2-70 AC1/AC2: reads the search text and the five filters from the query
 * string. Blank values leave a filter out; anything malformed is refused with
 * a message naming the filter rather than silently widening the search.
 */
export function parseSearchFilters(query: Request['query']): Parsed {
  const values: Record<string, string | null> = {};
  for (const key of ['q', 'from', 'to', 'status', 'venue', 'category', 'coordinator']) {
    const raw = query[key];
    if (raw !== undefined && typeof raw !== 'string') return { ok: false, error: `Give ${key} at most once.` };
    values[key] = raw?.trim() || null;
  }
  const { q, from, to, status, venue, category, coordinator } = values;
  if (q && Array.from(q).length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `The search text must be ${MAX_QUERY_LENGTH} characters or fewer.` };
  }
  if (from && !isDay(from)) return { ok: false, error: 'from must be a date (YYYY-MM-DD).' };
  if (to && !isDay(to)) return { ok: false, error: 'to must be a date (YYYY-MM-DD).' };
  if (from && to && from > to) return { ok: false, error: 'The start date must not be after the end date.' };
  // AC3: drafts are never found, so Draft is not a state a search can ask for.
  if (status && (!isEventStatus(status) || status === 'draft')) return { ok: false, error: 'Unknown event state.' };
  const venueId = venue === null ? null : Number(venue);
  if (venueId !== null && (!/^\d+$/.test(venue!) || !Number.isSafeInteger(venueId) || venueId < 1)) {
    return { ok: false, error: 'venue must be a venue id.' };
  }
  if (category && !isEventCategory(category)) return { ok: false, error: 'Unknown event category.' };
  if (coordinator && !ACCOUNT_ID.test(coordinator)) return { ok: false, error: 'coordinator must be a coordinator id.' };
  return {
    ok: true,
    filters: {
      query: q, date_from: from, date_to: to, status, venue_id: venueId, category,
      coordinator_id: coordinator?.toLowerCase() ?? null
    }
  };
}

function send(res: Response, error: unknown) {
  const failure = error instanceof AccessError ? error : new AccessError(503);
  res.status(failure.status).json({ error: failure.status === 503 ? UNAVAILABLE_MESSAGE : failure.message });
}

/**
 * GET /api/event-search — internal users find an event by name or client
 * organisation and narrow it by date, state, venue, category and coordinator,
 * or 'unassigned' (SG2-70 AC1/AC2). The database returns only the events the
 * acting role may see, never a draft (AC3), and the response echoes the
 * filters in force for the empty state (AC4).
 * GET /api/event-search/options — the venues and coordinators to choose from.
 * Both need 'events.search' here and an internal acting role in the database.
 */
export function createEventSearchRouter(access = authorization, store = createEventSearchStore) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('events.search'), async (req, res) => {
    const parsed = parseSearchFilters(req.query);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      res.json(await store(req.get('authorization')!.slice(7)).search(parsed.filters));
    } catch (error) {
      send(res, error);
    }
  });
  router.get('/options', access.requirePermission('events.search'), async (req, res) => {
    try {
      res.json(await store(req.get('authorization')!.slice(7)).options());
    } catch (error) {
      send(res, error);
    }
  });
  return router;
}
