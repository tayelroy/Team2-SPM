import { afterEach, expect, test, vi } from 'vitest';
import { endMinimum, futureSgtMinute, isFuturePeriod } from './futureDates';

afterEach(() => vi.restoreAllMocks());

test('[BOUNDARY] [SG2-46:AC2] Singapore scheduling limits round forward across midnight regardless of the browser timezone', () => {
  const now = Date.parse('2026-10-31T15:59:59.999Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  expect(futureSgtMinute()).toBe('2026-11-01T00:00');
  expect(futureSgtMinute(Date.parse('2026-10-31T16:00:00Z'))).toBe('2026-11-01T00:01');
  expect(endMinimum('')).toBe('2026-11-01T00:00');
  expect(endMinimum('not a date', now)).toBe('2026-11-01T00:00');
  expect(endMinimum('2026-10-31T23:58', now)).toBe('2026-11-01T00:00');
  expect(endMinimum('2026-11-01T00:00', now)).toBe('2026-11-01T00:01');
});

test('[BOUNDARY] [SG2-46:AC2] scheduling rejects invalid, past, equal and reversed periods while retaining precise future timestamps', () => {
  const now = Date.parse('2026-10-31T16:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  expect(isFuturePeriod('', '2026-11-01T01:00')).toBe(false);
  expect(isFuturePeriod('2026-11-01T00:01', '')).toBe(false);
  expect(isFuturePeriod('2026-10-31T23:59', '2026-11-01T01:00')).toBe(false);
  expect(isFuturePeriod('2026-11-01T00:00', '2026-11-01T01:00')).toBe(false);
  expect(isFuturePeriod('2026-11-01T00:01', '2026-11-01T00:01')).toBe(false);
  expect(isFuturePeriod('2026-11-01T00:02', '2026-11-01T00:01')).toBe(false);
  expect(isFuturePeriod('2026-11-01T00:00:00.001', '2026-11-01T00:00:00.002', now)).toBe(true);
});
