import { AccessError } from '../auth/policy';
import { createUserScopedClient } from './user-client';

/** The filters a search applies; null leaves that filter out (SG2-70 AC1/AC2). */
export interface EventSearchFilters {
  query: string | null;
  date_from: string | null;
  date_to: string | null;
  status: string | null;
  venue_id: number | null;
  category: string | null;
  coordinator_id: string | null;
}

/** One event a search found, with what is needed to recognise it (SG2-70 AC1). */
export interface EventSearchResult {
  event_id: number;
  name: string;
  organisation: string | null;
  category: string | null;
  status: string;
  proposed_date: string | null;
  coordinator_id: string | null;
  coordinator_name: string | null;
  venues: string[];
}

export interface EventSearchPage {
  events: EventSearchResult[];
  /** More than the first 100 matched; the screen asks for a narrower search. */
  truncated: boolean;
  /** AC4: the filters in force, echoed by the database that applied them. */
  filters: EventSearchFilters;
}

/** What the venue and coordinator filters can be set to (SG2-70 AC2). */
export interface EventSearchOptions {
  venues: { venue_id: number; name: string }[];
  coordinators: { user_id: string; name: string }[];
}

export interface EventSearchStore {
  search(filters: EventSearchFilters): Promise<EventSearchPage>;
  options(): Promise<EventSearchOptions>;
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const id = (value: unknown): number | null => (Number.isSafeInteger(value) ? value as number : null);
/** Callers have already checked the value is an array. */
const rows = (value: unknown[]): Row[] => value.filter((row): row is Row => typeof row === 'object' && row !== null);
const isObject = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

function result(row: Row): EventSearchResult {
  return {
    event_id: Number(row.event_id),
    name: text(row.name) ?? '',
    organisation: text(row.organisation),
    category: text(row.category),
    status: text(row.status) ?? '',
    proposed_date: text(row.proposed_date),
    coordinator_id: text(row.coordinator_id),
    coordinator_name: text(row.coordinator_name),
    venues: Array.isArray(row.venues) ? row.venues.filter((name): name is string => typeof name === 'string') : []
  };
}

function filters(row: Row): EventSearchFilters {
  return {
    query: text(row.query),
    date_from: text(row.date_from),
    date_to: text(row.date_to),
    status: text(row.status),
    venue_id: id(row.venue_id),
    category: text(row.category),
    coordinator_id: text(row.coordinator_id)
  };
}

function failure(error: { code?: string }, status: number): AccessError {
  return new AccessError(status === 401 ? 401 : status === 403 || error.code === '42501' ? 403 : 503);
}

/**
 * Reads through `public.search_events` and `public.event_search_options` with
 * the caller's JWT, so the stored role is checked by the database as well as
 * by the route (SG2-70 AC3): an account whose role has since changed is refused.
 */
export function createEventSearchStore(token: string, makeClient = createUserScopedClient): EventSearchStore {
  const client = makeClient(token);
  if (!client) throw new AccessError(503);
  return {
    async search(applied) {
      const { data, error, status } = await client.rpc('search_events', {
        p_query: applied.query, p_date_from: applied.date_from, p_date_to: applied.date_to,
        p_status: applied.status, p_venue_id: applied.venue_id, p_category: applied.category,
        p_coordinator_id: applied.coordinator_id
      });
      if (error) throw failure(error, status);
      if (!isObject(data) || !Array.isArray(data.events) || !isObject(data.filters)) throw new AccessError(503);
      return { events: rows(data.events).map(result), truncated: data.truncated === true, filters: filters(data.filters) };
    },
    async options() {
      const { data, error, status } = await client.rpc('event_search_options');
      if (error) throw failure(error, status);
      if (!isObject(data) || !Array.isArray(data.venues) || !Array.isArray(data.coordinators)) throw new AccessError(503);
      return {
        venues: rows(data.venues).map(row => ({ venue_id: Number(row.venue_id), name: text(row.name) ?? 'Unnamed venue' })),
        coordinators: rows(data.coordinators).map(row => ({ user_id: String(row.user_id), name: text(row.name) ?? 'Unnamed coordinator' }))
      };
    }
  };
}
