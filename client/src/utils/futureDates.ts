const SGT_OFFSET = 8 * 60 * 60_000;

/** datetime-local fields on scheduling forms are explicitly in Singapore time. */
export function futureSgtMinute(now = Date.now()): string {
  return new Date((Math.floor(now / 60_000) + 1) * 60_000 + SGT_OFFSET).toISOString().slice(0, 16);
}

export function isFuturePeriod(start: string, end: string, now = Date.now()): boolean {
  const from = Date.parse(`${start}+08:00`);
  const until = Date.parse(`${end}+08:00`);
  return Number.isFinite(from) && Number.isFinite(until) && from > now && until > from;
}

/** Venue operations can record an ongoing period, but never one already ended. */
export function isUnendedPeriod(start: string, end: string, now = Date.now()): boolean {
  const from = Date.parse(`${start}+08:00`);
  const until = Date.parse(`${end}+08:00`);
  return Number.isFinite(from) && Number.isFinite(until) && until > from && until > now;
}

/** Match the field's step: minute forms round forward; precise reservations retain milliseconds. */
export function endMinimum(start: string, now = Date.now(), precision: 'minute' | 'millisecond' = 'minute'): string {
  const from = Date.parse(`${start}+08:00`);
  const boundary = Number.isFinite(from) ? Math.max(from, now) : now;
  return precision === 'minute' ? futureSgtMinute(boundary)
    : new Date(boundary + 1 + SGT_OFFSET).toISOString().slice(0, 23);
}
