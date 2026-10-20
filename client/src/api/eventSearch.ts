/**
 * SG2-70: find an event across the system. Mirrors server/src/eventSearch
 * and server/src/db/eventSearch.ts.
 */

/** What the user asked for; an empty string leaves that filter out (AC1/AC2). */
export interface EventSearchQuery {
  q: string;
  from: string;
  to: string;
  status: string;
  venue: string;
  category: string;
  coordinator: string;
}

export const EMPTY_SEARCH: EventSearchQuery = { q: '', from: '', to: '', status: '', venue: '', category: '', coordinator: '' };

/** One event a search found (AC1). */
export interface EventSearchResult {
  eventId: number;
  name: string;
  organisation: string | null;
  category: string | null;
  status: string;
  proposedDate: string | null;
  coordinatorName: string | null;
  venues: string[];
}

/** The filters the server applied, echoed for the empty state (AC4). */
export interface AppliedFilters {
  query: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  status: string | null;
  venueId: number | null;
  category: string | null;
  coordinatorId: string | null;
}

export interface EventSearchOptions {
  venues: { venueId: number; name: string }[];
  coordinators: { userId: string; name: string }[];
}

export type SearchEventsResult =
  | { ok: true; events: EventSearchResult[]; truncated: boolean; filters: AppliedFilters }
  | { ok: false; kind: 'unauthorized' | 'unavailable' }
  | { ok: false; kind: 'invalid'; message: string };

export type FetchSearchOptionsResult =
  | { ok: true; options: EventSearchOptions }
  | { ok: false; kind: 'unauthorized' | 'unavailable' };

type Raw = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

async function get(path: string, token: string, signal?: AbortSignal): Promise<Response | null> {
  try {
    return await fetch(path, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal });
  } catch {
    return null;
  }
}

/** GET /api/event-search — internal roles only (AC3). */
export async function searchEvents(query: EventSearchQuery, token: string, signal?: AbortSignal): Promise<SearchEventsResult> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value.trim()) params.set(key, value.trim());
  const search = params.toString();
  const response = await get(`/api/event-search${search ? `?${search}` : ''}`, token, signal);
  if (!response) return { ok: false, kind: 'unavailable' };
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  if (response.status === 400) {
    return { ok: false, kind: 'invalid', message: text(data.error) ?? 'Check the search filters and try again.' };
  }
  if (!response.ok || !Array.isArray(data.events) || !isObject(data.filters)) return { ok: false, kind: 'unavailable' };
  const filters = data.filters;
  return {
    ok: true,
    events: (data.events as Raw[]).map((raw) => ({
      eventId: Number(raw.event_id) || 0,
      name: text(raw.name) ?? '',
      organisation: text(raw.organisation),
      category: text(raw.category),
      status: text(raw.status) ?? '',
      proposedDate: text(raw.proposed_date),
      coordinatorName: text(raw.coordinator_name),
      venues: Array.isArray(raw.venues) ? raw.venues.filter((name): name is string => typeof name === 'string') : [],
    })),
    truncated: data.truncated === true,
    filters: {
      query: text(filters.query),
      dateFrom: text(filters.date_from),
      dateTo: text(filters.date_to),
      status: text(filters.status),
      venueId: typeof filters.venue_id === 'number' ? filters.venue_id : null,
      category: text(filters.category),
      coordinatorId: text(filters.coordinator_id),
    },
  };
}

/** GET /api/event-search/options — the venues and coordinators to filter by (AC2). */
export async function fetchSearchOptions(token: string): Promise<FetchSearchOptionsResult> {
  const response = await get('/api/event-search/options', token);
  if (!response) return { ok: false, kind: 'unavailable' };
  if (response.status === 401 || response.status === 403) return { ok: false, kind: 'unauthorized' };
  const data = (await response.json().catch(() => ({}))) as Raw;
  if (!response.ok || !Array.isArray(data.venues) || !Array.isArray(data.coordinators)) return { ok: false, kind: 'unavailable' };
  return {
    ok: true,
    options: {
      venues: (data.venues as Raw[]).map((raw) => ({ venueId: Number(raw.venue_id) || 0, name: text(raw.name) ?? '' })),
      coordinators: (data.coordinators as Raw[]).map((raw) => ({ userId: text(raw.user_id) ?? '', name: text(raw.name) ?? '' })),
    },
  };
}
