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

/** Minute-precision forms must end at least one minute after their start. */
export function endMinimum(start: string, now = Date.now()): string {
  const from = Date.parse(`${start}+08:00`);
  return futureSgtMinute(Number.isFinite(from) ? Math.max(from, now) : now);
}
