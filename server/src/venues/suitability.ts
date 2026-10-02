/**
 * Whether a venue fits an event (SG2-47). Requirements and venue features are
 * free text, so only recognised keywords take part: a requirement the list
 * does not recognise is shown to people as written but never flagged.
 */

type Keyword = [label: string, pattern: RegExp];

/** Facilities an event can require of a venue. Each pattern is matched both
 * against the event's venue requirements and the venue's own facilities. */
export const FACILITY_KEYWORDS: readonly Keyword[] = [
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

/** Mirrors client/src/venues/searchPrefill.ts so search and suitability agree
 * on which accessibility needs are recognised. */
export const ACCESSIBILITY_KEYWORDS: readonly Keyword[] = [
  ['step-free', /step[\s-]?free/i],
  ['wheelchair', /wheelchair/i],
  ['hearing loop', /hearing loop/i],
  ['lift', /\blifts?\b/i],
  ['ramp', /\bramps?\b/i],
  ['accessible toilet', /accessible (toilet|restroom|washroom)/i]
];

export function recognise(text: string | null, keywords: readonly Keyword[]): string[] {
  if (!text) return [];
  return keywords.filter(([, pattern]) => pattern.test(text)).map(([keyword]) => keyword);
}

export interface SuitabilityEvent {
  expected_attendance: number | null;
  venue_requirements: string | null;
  accessibility_needs: string | null;
}

export interface SuitabilityVenue {
  capacity: number | null;
  facilities: string | null;
  accessibility_features: string | null;
}

export type SuitabilityIssue =
  | { kind: 'capacity'; expected_attendance: number; capacity: number | null; message: string }
  | { kind: 'facility'; missing: string[]; message: string }
  | { kind: 'accessibility'; missing: string[]; message: string };

export interface Suitability {
  suitable: boolean;
  issues: SuitabilityIssue[];
  /** The requirements recognised from the event's own text. */
  required_facilities: string[];
  required_accessibility: string[];
}

function missingFrom(required: string[], offered: string | null, keywords: readonly Keyword[]) {
  const present = new Set(recognise(offered, keywords));
  return required.filter(keyword => !present.has(keyword));
}

export function assessSuitability(event: SuitabilityEvent, venue: SuitabilityVenue): Suitability {
  const issues: SuitabilityIssue[] = [];
  const attendance = event.expected_attendance;
  if (attendance !== null && (venue.capacity === null || attendance > venue.capacity)) {
    issues.push({
      kind: 'capacity', expected_attendance: attendance, capacity: venue.capacity,
      message: venue.capacity === null
        ? `Expected attendance is ${attendance}, but this venue's capacity is not recorded.`
        : `Expected attendance of ${attendance} is above this venue's capacity of ${venue.capacity}.`
    });
  }

  const requiredFacilities = recognise(event.venue_requirements, FACILITY_KEYWORDS);
  const missingFacilities = missingFrom(requiredFacilities, venue.facilities, FACILITY_KEYWORDS);
  if (missingFacilities.length > 0) {
    issues.push({ kind: 'facility', missing: missingFacilities, message: `Missing required ${missingFacilities.length === 1 ? 'facility' : 'facilities'}: ${missingFacilities.join(', ')}.` });
  }

  // With no accessibility needs, a venue's accessibility features do not count
  // against it (AC4); needs that are not recognised cannot be checked either.
  const requiredAccessibility = recognise(event.accessibility_needs, ACCESSIBILITY_KEYWORDS);
  const missingAccessibility = missingFrom(requiredAccessibility, venue.accessibility_features, ACCESSIBILITY_KEYWORDS);
  if (missingAccessibility.length > 0) {
    issues.push({ kind: 'accessibility', missing: missingAccessibility, message: `Missing accessibility ${missingAccessibility.length === 1 ? 'feature' : 'features'}: ${missingAccessibility.join(', ')}.` });
  }

  return {
    suitable: issues.length === 0, issues,
    required_facilities: requiredFacilities, required_accessibility: requiredAccessibility
  };
}

/** An approved capacity exception covers the attendance it was approved for;
 * if attendance later rises above that, a new approval is needed. */
export interface CapacityExceptionGrant { expected_attendance: number }

export type BookingReadiness = 'allowed' | 'needs_capacity_exception' | 'blocked';

/**
 * Whether a booking request for this venue may go ahead. A missing required
 * facility blocks it outright: no exception is permitted (AC2). Exceeding the
 * capacity needs an approved exception (AC3). Allowed only means the request
 * may be decided: Venue Staff still approve or reject the booking (AC5).
 *
 * SG2-48 (request a venue) refuses 'blocked'; SG2-49 (decide a request) may
 * approve only when 'allowed'.
 */
export function bookingReadiness(suitability: Suitability, exceptions: readonly CapacityExceptionGrant[] = []): BookingReadiness {
  if (suitability.issues.some(issue => issue.kind === 'facility')) return 'blocked';
  const capacity = suitability.issues.find(issue => issue.kind === 'capacity');
  if (capacity && !exceptions.some(grant => grant.expected_attendance >= capacity.expected_attendance)) {
    return 'needs_capacity_exception';
  }
  return 'allowed';
}
