import { expect, test } from 'vitest';
import { buildCalendarDays, monthRange } from './calendarView';
import type { VenueAvailabilitySummary } from './availability';

const OCT_2026 = new Date(Date.UTC(2026, 9, 15));

test('monthRange returns the UTC bounds and label of the containing month', () => {
  expect(monthRange(OCT_2026)).toEqual({
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-11-01T00:00:00.000Z',
    label: 'October 2026',
    year: 2026,
    month: 9
  });
});

test('monthRange rolls over into the next year at December', () => {
  const result = monthRange(new Date(Date.UTC(2026, 11, 25)));
  expect(result.to).toBe('2027-01-01T00:00:00.000Z');
  expect(result.label).toBe('December 2026');
});

test('grid has three leading blanks before October 1 (a Thursday) and covers every day', () => {
  const days = buildCalendarDays(OCT_2026, []);
  expect(days).toHaveLength(35);
  expect(days.slice(0, 3)).toEqual([
    { date: null, n: '', inMonth: false, kind: 'free', items: [] },
    { date: null, n: '', inMonth: false, kind: 'free', items: [] },
    { date: null, n: '', inMonth: false, kind: 'free', items: [] }
  ]);
  expect(days[3]).toEqual({ date: '2026-10-01', n: '1', inMonth: true, kind: 'free', items: [] });
  expect(days[33]).toEqual({ date: '2026-10-31', n: '31', inMonth: true, kind: 'free', items: [] });
});

function venue(name: string, entries: VenueAvailabilitySummary['entries']): VenueAvailabilitySummary {
  return { venueId: 1, name, entries };
}

test('a multi-day booking marks every day it overlaps and no others', () => {
  const venues = [
    venue('Atrium', [
      { start: '2026-10-01T09:00:00.000Z', end: '2026-10-03T09:00:00.000Z', kind: 'booking', label: 'confirmed' }
    ])
  ];
  const byDate = Object.fromEntries(buildCalendarDays(OCT_2026, venues).map((d) => [d.date, d]));
  expect(byDate['2026-10-01'].kind).toBe('booked');
  expect(byDate['2026-10-02'].kind).toBe('booked');
  expect(byDate['2026-10-03'].kind).toBe('booked');
  expect(byDate['2026-10-04'].kind).toBe('free');
  expect(byDate['2026-10-01'].items).toEqual(['Atrium · confirmed']);
});

test('an entry ending exactly at midnight does not spill into the next day', () => {
  const venues = [
    venue('Atrium', [
      { start: '2026-10-05T09:00:00.000Z', end: '2026-10-06T00:00:00.000Z', kind: 'booking', label: 'held' }
    ])
  ];
  const byDate = Object.fromEntries(buildCalendarDays(OCT_2026, venues).map((d) => [d.date, d]));
  expect(byDate['2026-10-05'].kind).toBe('booked');
  expect(byDate['2026-10-06'].kind).toBe('free');
});

test('an entry starting exactly at midnight belongs to that day, not the previous one', () => {
  const venues = [
    venue('Atrium', [
      { start: '2026-10-06T00:00:00.000Z', end: '2026-10-06T09:00:00.000Z', kind: 'unavailable', label: 'Maintenance' }
    ])
  ];
  const byDate = Object.fromEntries(buildCalendarDays(OCT_2026, venues).map((d) => [d.date, d]));
  expect(byDate['2026-10-05'].kind).toBe('free');
  expect(byDate['2026-10-06'].kind).toBe('unavailable');
});

test('a day with both a booking and an unavailability is mixed', () => {
  const venues = [
    venue('Atrium', [{ start: '2026-10-10T09:00:00.000Z', end: '2026-10-10T12:00:00.000Z', kind: 'booking', label: 'held' }]),
    venue('Rooftop', [{ start: '2026-10-10T00:00:00.000Z', end: '2026-10-11T00:00:00.000Z', kind: 'unavailable', label: 'Closed' }])
  ];
  const byDate = Object.fromEntries(buildCalendarDays(OCT_2026, venues).map((d) => [d.date, d]));
  expect(byDate['2026-10-10'].kind).toBe('mixed');
  expect(byDate['2026-10-10'].items).toEqual(['Atrium · held', 'Rooftop · Closed']);
});

test('more than three entries on one day are capped with a "+N more" marker', () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    start: '2026-10-12T00:00:00.000Z',
    end: '2026-10-12T01:00:00.000Z',
    kind: 'booking' as const,
    label: `slot ${i}`
  }));
  const venues = [venue('Atrium', entries)];
  const day = buildCalendarDays(OCT_2026, venues).find((d) => d.date === '2026-10-12')!;
  expect(day.items).toEqual(['Atrium · slot 0', 'Atrium · slot 1', 'Atrium · slot 2', '+2 more']);
});
