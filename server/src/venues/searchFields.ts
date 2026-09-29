import { LAYOUTS, type Layout } from './layoutFields';

export const MAX_SEARCH_DAYS = 31;
const DAY_MS = 86_400_000;
const MAX_TEXT = 255;
const MAX_TERMS = 10;

/** One venue search (SG2-46). Text criteria are lower-cased for matching;
 * facilities and accessibility are comma-separated keywords that must all
 * appear in the venue's own description. */
export interface VenueSearchCriteria {
  starts_at: string;
  ends_at: string;
  attendance: number | null;
  location: string | null;
  layout: Layout | null;
  facilities: string[];
  accessibility: string[];
}

export type ParsedSearch = { ok: true; criteria: VenueSearchCriteria } | { ok: false; message: string };

function instant(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** Absent or blank means "not filtered"; anything else must be one string. */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;
  return Array.from(text).length > MAX_TEXT ? undefined : text.toLowerCase();
}

function terms(value: unknown): string[] | null {
  const text = optionalText(value);
  if (text === undefined) return null;
  const list = (text ?? '').split(',').map(term => term.trim()).filter(Boolean);
  return list.length > MAX_TERMS ? null : list;
}

export function parseVenueSearch(query: Record<string, unknown>): ParsedSearch {
  const from = instant(query.from);
  const to = instant(query.to);
  if (from === null || to === null) return { ok: false, message: 'from and to must be ISO 8601 date-times.' };
  if (from >= to) return { ok: false, message: 'from must be earlier than to.' };
  if (to - from > MAX_SEARCH_DAYS * DAY_MS) {
    return { ok: false, message: `The search period must not exceed ${MAX_SEARCH_DAYS} days.` };
  }

  let attendance: number | null = null;
  if (query.attendance !== undefined && query.attendance !== '') {
    if (typeof query.attendance !== 'string' || !/^[1-9]\d*$/.test(query.attendance) || Number(query.attendance) > 2147483647) {
      return { ok: false, message: 'attendance must be a positive whole number.' };
    }
    attendance = Number(query.attendance);
  }

  const location = optionalText(query.location);
  const layout = optionalText(query.layout);
  const facilities = terms(query.facilities);
  const accessibility = terms(query.accessibility);
  if (location === undefined || layout === undefined || facilities === null || accessibility === null) {
    return { ok: false, message: `Text criteria must be single values within ${MAX_TEXT} characters, with at most ${MAX_TERMS} keywords each.` };
  }
  if (layout !== null && !(LAYOUTS as readonly string[]).includes(layout)) {
    return { ok: false, message: 'layout must be one of the listed layouts.' };
  }

  return {
    ok: true,
    criteria: {
      starts_at: new Date(from).toISOString(), ends_at: new Date(to).toISOString(),
      attendance, location, layout: layout as Layout | null, facilities, accessibility
    }
  };
}
