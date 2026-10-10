/**
 * Pure transforms for the venue availability calendar, kept separate from the
 * component so the grid math and overlap logic can be tested without
 * rendering (same separation as mock/viewModel.ts).
 */

import type { VenueAvailabilitySummary } from './availability';

export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_MS = 86_400_000;
const MAX_ITEMS_PER_DAY = 3;
/** Venue times are entered and shown in Singapore time (UTC+8, no daylight
 * saving), so calendar days run from Singapore midnight to midnight. */
const SINGAPORE_OFFSET_MS = 8 * 3_600_000;

/** The instant of 00:00 Singapore time on a calendar date (month is 0-based and may overflow). */
function singaporeMidnight(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) - SINGAPORE_OFFSET_MS;
}

export interface MonthRange {
  from: string;
  to: string;
  label: string;
  year: number;
  month: number;
}

/** ISO [from, to) bounds of the Singapore month containing `reference`, plus its label. */
export function monthRange(reference: Date): MonthRange {
  const singapore = new Date(reference.getTime() + SINGAPORE_OFFSET_MS);
  const year = singapore.getUTCFullYear();
  const month = singapore.getUTCMonth();
  return {
    from: new Date(singaporeMidnight(year, month, 1)).toISOString(),
    to: new Date(singaporeMidnight(year, month + 1, 1)).toISOString(),
    label: `${MONTH_LABELS[month]} ${year}`,
    year,
    month
  };
}

export type DayKind = 'free' | 'booked' | 'unavailable' | 'tentative' | 'preparation' | 'mixed';

export interface CalendarDay {
  /** ISO date (yyyy-mm-dd) for an in-month day, null for a leading/trailing blank. */
  date: string | null;
  n: string;
  inMonth: boolean;
  kind: DayKind;
  items: string[];
}

/** Monday-indexed weekday (Mon=0 ... Sun=6), matching mock/data.ts's WEEKDAYS order. */
function mondayIndexedWeekday(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/**
 * A calendar-week-aligned grid for the month containing `reference`. Every
 * venue's entries overlapping a given day are aggregated into that cell —
 * there is no per-venue view, matching the "all venues, date range is the
 * only filter" design.
 */
export function buildCalendarDays(reference: Date, venues: VenueAvailabilitySummary[]): CalendarDay[] {
  const { year, month } = monthRange(reference);
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const leadingBlanks = mondayIndexedWeekday(new Date(Date.UTC(year, month, 1)));
  const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

  const days: CalendarDay[] = [];
  for (let i = 0; i < totalCells; i += 1) {
    const dayNumber = i - leadingBlanks + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      days.push({ date: null, n: '', inMonth: false, kind: 'free', items: [] });
      continue;
    }

    // SG2-44: a 12:00 am Singapore start belongs to that day, not the UTC day before.
    const dayStart = singaporeMidnight(year, month, dayNumber);
    const dayEnd = dayStart + DAY_MS;
    const items: string[] = [];
    let hasBooking = false;
    let hasUnavailable = false;
    let hasHold = false;
    let hasPreparation = false;

    for (const venue of venues) {
      for (const entry of venue.entries) {
        const entryStart = Date.parse(entry.start);
        const entryEnd = Date.parse(entry.end);
        if (entryStart < dayEnd && entryEnd > dayStart) {
          if (entry.kind === 'booking') hasBooking = true;
          else if (entry.kind === 'hold') hasHold = true;
          // SG2-78 AC3: setup and turnaround occupy the venue but are not the event.
          else if (entry.kind === 'setup' || entry.kind === 'turnaround') hasPreparation = true;
          else hasUnavailable = true;
          items.push(`${venue.name} · ${entry.label}`);
        }
      }
    }

    const occupiedKinds = Number(hasBooking) + Number(hasUnavailable) + Number(hasHold);
    // A day holding only setup or turnaround (e.g. the night before) is still occupied.
    const kind: DayKind = occupiedKinds > 1 ? 'mixed' : hasBooking ? 'booked' : hasUnavailable ? 'unavailable'
      : hasHold ? 'tentative' : hasPreparation ? 'preparation' : 'free';
    const shown = items.slice(0, MAX_ITEMS_PER_DAY);
    if (items.length > MAX_ITEMS_PER_DAY) shown.push(`+${items.length - MAX_ITEMS_PER_DAY} more`);

    days.push({
      date: new Date(Date.UTC(year, month, dayNumber)).toISOString().slice(0, 10),
      n: String(dayNumber),
      inMonth: true,
      kind,
      items: shown
    });
  }

  return days;
}
