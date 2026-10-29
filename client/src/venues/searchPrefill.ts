import type { WorkItem } from '../api/workQueue';
import { LAYOUT_LABELS, LAYOUTS, type Layout } from './layoutsApi';
import { EMPTY_SEARCH, isoToSgtLocal, type VenueSearchValues } from './searchApi';

/** Search criteria taken from an approved event (SG2-46 AC1). */
export interface VenueSearchPrefill {
  eventId: number;
  eventName: string;
  values: VenueSearchValues;
  /** The event's accessibility needs as the organiser wrote them, if any. */
  accessibilityNeeds: string | null;
  /** SG2-48 AC1: the venue requirements a venue request will carry. */
  venueRequirements: string | null;
  /** SG2-48 AC1: the event's preferred layout when it names a known layout,
   * so a request defaults to it even after the search filter is cleared. */
  preferredLayout?: Layout | null;
}

/** The known layout an organiser's preferred layout names (value or label,
 * any case, trimmed), or null for free text that names none. */
export function layoutFromPreference(preference: unknown): Layout | null {
  if (typeof preference !== 'string') return null;
  const wanted = preference.trim().toLowerCase();
  return LAYOUTS.find(layout => layout === wanted || LAYOUT_LABELS[layout].toLowerCase() === wanted) ?? null;
}

/** Mirror server/src/venues/suitability.ts: extract the same recognised
 * facilities from event prose instead of treating every word as a filter. */
const FACILITY_KEYWORDS: [string, RegExp][] = [
  ['projector', /\bproject(or|ors|ion)\b/i],
  ['screen', /\bscreens?\b/i],
  ['PA system', /\bPA\b|public address|sound system/],
  ['microphone', /\bmic(rophone)?s?\b/i],
  ['stage', /\bstages?\b/i],
  ['whiteboard', /\bwhiteboards?\b/i],
  ['wifi', /\bwi-?fi\b|\binternet\b/i],
  ['kitchen', /\bkitchens?\b|\bcatering\b/i],
  ['bar', /\bbars?\b/i],
  ['power outlets', /\bpower\b/i],
  ['air-conditioning', /\bair[\s-]?con(ditioning|ditioned)?\b/i],
  ['video conferencing', /\bvideo[\s-]?conferenc(e|ing)\b/i]
];

/** Accessibility needs are free text, so only recognised features become
 * matching keywords; the coordinator sees the full text and can add more. */
const ACCESSIBILITY_KEYWORDS: [string, RegExp][] = [
  ['step-free', /step[\s-]?free/i],
  ['wheelchair', /wheelchair/i],
  ['hearing loop', /hearing loop/i],
  ['lift', /\blifts?\b/i],
  ['ramp', /\bramps?\b/i],
  ['accessible toilet', /accessible (toilet|restroom|washroom)/i]
];

export function accessibilityKeywords(needs: string): string[] {
  return ACCESSIBILITY_KEYWORDS.filter(([, pattern]) => pattern.test(needs)).map(([keyword]) => keyword);
}

/** Events record a date but no duration, so search the whole day (Singapore
 * time) of the proposed date; the coordinator can narrow it. */
export function prefillFromEvent(item: WorkItem): VenueSearchPrefill {
  const day = item.starts_at === null ? null : isoToSgtLocal(item.starts_at).slice(0, 10);
  const attendance = item.details.expected_attendance;
  const rawNeeds = item.details.accessibility_needs;
  // SG2-105: "None" is how an organiser says there are no needs.
  const needs = typeof rawNeeds === 'string' && rawNeeds.trim() && rawNeeds.trim().toLowerCase() !== 'none'
    ? rawNeeds.trim() : null;
  const requirements = item.details.venue_requirements;
  const venueRequirements = typeof requirements === 'string' && requirements.trim() ? requirements.trim() : null;
  const preferredLayout = layoutFromPreference(item.details.preferred_layout);
  return {
    eventId: item.event_id,
    eventName: item.title,
    accessibilityNeeds: needs,
    venueRequirements,
    preferredLayout,
    values: {
      ...EMPTY_SEARCH,
      from: day === null ? '' : `${day}T00:00`,
      until: day === null ? '' : `${day}T23:59`,
      layout: preferredLayout ?? '',
      attendance: typeof attendance === 'number' ? String(attendance) : '',
      facilities: venueRequirements === null ? '' : FACILITY_KEYWORDS
        .filter(([, pattern]) => pattern.test(venueRequirements)).map(([keyword]) => keyword).join(', '),
      accessibility: needs === null ? '' : accessibilityKeywords(needs).join(', ')
    }
  };
}
