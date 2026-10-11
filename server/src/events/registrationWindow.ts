/**
 * Whether attendees may register for an event right now (SG2-58 AC3).
 *
 * Registration is open only for a **confirmed** event that needs registration,
 * from its opening time (inclusive) until its closing time (exclusive). This is
 * the rule SG2-60's register endpoint is expected to enforce; SG2-58 only
 * reports it.
 *
 * - `not_required`: the event does not take registrations.
 * - `not_confirmed`: registration is needed but the event is not confirmed
 *   yet, so nothing opens regardless of the times.
 * - `not_yet_open`: confirmed, but before the opening time (or a time is
 *   missing, which confirmation's readiness gate normally rules out).
 * - `open`: confirmed and `opens_at <= now < closes_at`.
 * - `closed`: at or after the closing time, or the event has been held and
 *   marked completed.
 */
export type RegistrationWindow = 'not_required' | 'not_confirmed' | 'not_yet_open' | 'open' | 'closed';

export interface RegistrationWindowEvent {
  status: string;
  registration_needed: boolean | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
}

export function registrationWindow(event: RegistrationWindowEvent, now: Date): RegistrationWindow {
  if (event.registration_needed !== true) return 'not_required';
  const status = event.status.toLowerCase();
  if (status === 'completed') return 'closed';
  if (status !== 'confirmed') return 'not_confirmed';
  if (event.registration_opens_at === null || event.registration_closes_at === null) return 'not_yet_open';
  const time = now.getTime();
  if (time < Date.parse(event.registration_opens_at)) return 'not_yet_open';
  if (time >= Date.parse(event.registration_closes_at)) return 'closed';
  return 'open';
}
