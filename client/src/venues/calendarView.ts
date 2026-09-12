/**
 * Pure transforms for the venue availability calendar, kept separate from the
 * component so the grid math and overlap logic can be tested without
 * rendering (same separation as mock/viewModel.ts).
 */

import type { VenueAvailabilitySummary } from './availability';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const DAY_MS = 86_400_000;
const MAX_ITEMS_PER_DAY = 3;

export interface MonthRange {
  from: string;
  to: string;
  label: string;
  year: number;
  month: number;
}

/** ISO [from, to) bounds of the UTC month containing `reference`, plus its label. */
export function monthRange(reference: Date): MonthRange {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1)).toISOString(),
    to: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
    label: `${MONTH_LABELS[month]} ${year}`,
    year,
    month
  };
}

export type DayKind = 'free' | 'booked' | 'unavailable' | 'mixed';

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

    const dayStart = Date.UTC(year, month, dayNumber);
    const dayEnd = dayStart + DAY_MS;
    const items: string[] = [];
    let hasBooking = false;
    let hasUnavailable = false;

    for (const venue of venues) {
      for (const entry of venue.entries) {
        const entryStart = Date.parse(entry.start);
        const entryEnd = Date.parse(entry.end);
        if (entryStart < dayEnd && entryEnd > dayStart) {
          if (entry.kind === 'booking') hasBooking = true;
          else hasUnavailable = true;
          items.push(`${venue.name} · ${entry.label}`);
        }
      }
    }

    const kind: DayKind = hasBooking && hasUnavailable ? 'mixed' : hasBooking ? 'booked' : hasUnavailable ? 'unavailable' : 'free';
    const shown = items.slice(0, MAX_ITEMS_PER_DAY);
    if (items.length > MAX_ITEMS_PER_DAY) shown.push(`+${items.length - MAX_ITEMS_PER_DAY} more`);

    days.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      n: String(dayNumber),
      inMonth: true,
      kind,
      items: shown
    });
  }

  return days;
}
