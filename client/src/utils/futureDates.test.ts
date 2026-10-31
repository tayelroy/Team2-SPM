import { afterEach, expect, test, vi } from 'vitest';
import { endMinimum, futureSgtMinute, isFuturePeriod, isUnendedPeriod } from './futureDates';

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


test('[BOUNDARY] [SG2-45:AC1] [SG2-84:AC1,AC2] ongoing venue periods are allowed but invalid or ended periods are refused', () => {
  const now = Date.parse('2030-06-12T01:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  expect(isUnendedPeriod('2030-06-12T08:00', '2030-06-12T10:00')).toBe(true);
  expect(isUnendedPeriod('2030-06-12T09:00', '2030-06-12T10:00', now)).toBe(true);
  expect(isUnendedPeriod('', '2030-06-12T10:00', now)).toBe(false);
  expect(isUnendedPeriod('2030-06-12T08:00', '', now)).toBe(false);
  expect(isUnendedPeriod('2030-06-12T08:00', '2030-06-12T08:00', now)).toBe(false);
  expect(isUnendedPeriod('2030-06-12T08:00', '2030-06-12T09:00', now)).toBe(false);
});

test('[BOUNDARY] [SG2-55:AC1] precise end minimum advances one millisecond without excluding a valid short reservation', () => {
  const now = Date.parse('2030-06-12T01:00:00Z');
  expect(endMinimum('2030-06-12T10:00:30.123', now, 'millisecond')).toBe('2030-06-12T10:00:30.124');
  expect(endMinimum('', now, 'millisecond')).toBe('2030-06-12T09:00:00.001');
});
