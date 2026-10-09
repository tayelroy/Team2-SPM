import { MAX_MINUTES } from './operationFields';

/** A venue's setup and turnaround time in minutes (SG2-77). */
export interface PreparationTimes {
  setup_minutes: number;
  turnaround_minutes: number;
}

/** A venue with nothing recorded needs no setup or turnaround (SG2-77 AC3). */
export const NO_PREPARATION: PreparationTimes = { setup_minutes: 0, turnaround_minutes: 0 };

/** The largest gap two bookings can need: the most setup plus the most
 * turnaround. Range queries widen by this so no clashing row is missed. */
export const MAX_GAP_MINUTES = MAX_MINUTES * 2;

const MINUTE = 60_000;

interface Period {
  starts_at: string;
  ends_at: string;
}

/** The instant `minutes` after (or, if negative, before) an ISO time. */
export function shiftIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MINUTE).toISOString();
}

/** Minutes two bookings at the venue must keep between them. */
export function gapMinutes(times: PreparationTimes): number {
  return times.setup_minutes + times.turnaround_minutes;
}

/**
 * SG2-78 AC1: the period a booking keeps its venue busy, from setup before it
 * starts until turnaround after it ends. 10:00-12:00 with 30 minutes setup
 * and 45 minutes turnaround is 09:30-12:45.
 */
export function effectivePeriod(period: Period, times: PreparationTimes): Period {
  return { starts_at: shiftIso(period.starts_at, -times.setup_minutes), ends_at: shiftIso(period.ends_at, times.turnaround_minutes) };
}

/**
 * SG2-78 AC2: two periods at one venue clash when their effective periods
 * overlap, which is when the gap between them is shorter than setup plus
 * turnaround. Periods exactly that far apart do not clash.
 */
export function clashes(a: Period, b: Period, times: PreparationTimes): boolean {
  const gap = gapMinutes(times) * MINUTE;
  return Date.parse(a.starts_at) < Date.parse(b.ends_at) + gap && Date.parse(a.ends_at) > Date.parse(b.starts_at) - gap;
}

type PreparationRow = PreparationTimes & { venue_id: number };

/** Times per venue from venue_operations rows; venues without a row need none. */
export function preparationByVenue(rows: PreparationRow[]): (venueId: number) => PreparationTimes {
  const byVenue = new Map(rows.map(({ venue_id, setup_minutes, turnaround_minutes }) => [venue_id, { setup_minutes, turnaround_minutes }]));
  return venueId => byVenue.get(venueId) ?? NO_PREPARATION;
}
