import type { WorkItem } from '../api/workQueue';
import { EMPTY_SEARCH, isoToSgtLocal, type VenueSearchValues } from './searchApi';

/** Search criteria taken from an approved event (SG2-46 AC1). */
export interface VenueSearchPrefill {
  eventId: number;
  eventName: string;
  values: VenueSearchValues;
  /** The event's accessibility needs as the organiser wrote them, if any. */
  accessibilityNeeds: string | null;
}

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
  const needs = typeof rawNeeds === 'string' && rawNeeds.trim() ? rawNeeds.trim() : null;
  return {
    eventId: item.event_id,
    eventName: item.title,
    accessibilityNeeds: needs,
    values: {
      ...EMPTY_SEARCH,
      from: day === null ? '' : `${day}T00:00`,
      until: day === null ? '' : `${day}T23:59`,
      attendance: typeof attendance === 'number' ? String(attendance) : '',
      accessibility: needs === null ? '' : accessibilityKeywords(needs).join(', ')
    }
  };
}
