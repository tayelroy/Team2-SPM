// SG2-66: what an accepted change to an event would break, and what has to be
// rechecked before it can go forward again. Pure: the facts are read by
// db/changeImpact.ts and the writes happen in apply_accepted_event_change /
// settle_arrangement_recheck.

/** Statuses in which a change to the event can be accepted. */
export const CHANGEABLE_STATUSES = [
  'approved',
  'planning',
  'awaiting_safety_check',
  'preparation',
  'confirmed',
] as const;

/** An accepted change with affected arrangements moves these back to Planning
 * (AC4) and tells the organiser and coordinator (AC7). Mirrored in
 * apply_accepted_event_change. */
export const RETURNS_TO_PLANNING = ['awaiting_safety_check', 'preparation', 'confirmed'] as const;

/** Changes to these fields make every arrangement need revalidating (AC1).
 * Name, purpose and description are changeable but not significant: they
 * cannot invalidate a booking, reservation or registration. */
export const SIGNIFICANT_CHANGE_FIELDS = [
  'proposed_date',
  'expected_attendance',
  'venue_requirements',
  'accessibility_needs',
  'equipment_requirements',
] as const;

/** Every field a change request may change. Mirrored by the whitelist in
 * apply_accepted_event_change. */
export const CHANGEABLE_FIELDS = [...SIGNIFICANT_CHANGE_FIELDS, 'name', 'purpose', 'description'] as const;

/** SG2-39's recheck vocabulary, already read by confirm_event and
 * arrangementReadiness, and SG2-93's changes requested at the safety check
 * (set by record_safety_decision). */
export const RECHECK_KEYS = [
  'venue_recheck',
  'equipment_recheck',
  'registration_recheck',
  'safety_venue_recheck',
  'safety_equipment_recheck',
  'safety_other_recheck',
] as const;

/** Registration settings stay editable on Confirmed and Preparation events
 * (SG2-63, SG2-66 AC6). */
export const REGISTRATION_SETTINGS = [
  'registration_needed',
  'registration_capacity',
  'registration_opens_at',
  'registration_closes_at',
] as const;

export type ChangeableStatus = (typeof CHANGEABLE_STATUSES)[number];
export type ChangeableField = (typeof CHANGEABLE_FIELDS)[number];
export type RecheckKey = (typeof RECHECK_KEYS)[number];

export const CHANGE_FIELD_LABELS: Record<ChangeableField, string> = {
  proposed_date: 'Event date and time',
  expected_attendance: 'Expected attendance',
  venue_requirements: 'Venue requirements',
  accessibility_needs: 'Accessibility needs',
  equipment_requirements: 'Equipment requirements',
  name: 'Event name',
  purpose: 'Purpose',
  description: 'Description',
};

export function isChangeableStatus(status: string): status is ChangeableStatus {
  return (CHANGEABLE_STATUSES as readonly string[]).includes(status);
}

export function isRecheckKey(value: string): value is RecheckKey {
  return (RECHECK_KEYS as readonly string[]).includes(value);
}

export function isSignificantField(field: string): boolean {
  return (SIGNIFICANT_CHANGE_FIELDS as readonly string[]).includes(field);
}

/** One requested field change. */
export interface ChangeRequestChange {
  field: ChangeableField;
  label: string;
  from: string | number | null;
  to: string | number | null;
}

/** A confirmed venue booking or a pending venue request of the event. */
export interface VenueArrangementFact {
  kind: 'venue_booking' | 'venue_request';
  id: number;
  venue_name: string;
  capacity: number | null;
  starts_at: string | null;
  ends_at: string | null;
  /** The highest attendance a Venue Staff capacity exception on this item's
   * venue booking request covers, or null when there is none (AC2/AC5). */
  exception_attendance: number | null;
}

/** An equipment reservation, or a live equipment request not yet reserved. */
export interface EquipmentArrangementFact {
  kind: 'equipment_reservation' | 'equipment_request';
  id: number;
  equipment_name: string;
  quantity: number;
  starts_at: string | null;
  ends_at: string | null;
}

export interface ChangeImpactFacts {
  venues: VenueArrangementFact[];
  equipment: EquipmentArrangementFact[];
  /** Registrations received, excluding cancelled ones. */
  registrations: number;
}

/** The event fields the impact and recheck rules read. */
export interface ChangeImpactEventFacts {
  proposed_date: string | null;
  expected_attendance: number | null;
  registration_needed: boolean | null;
  registration_capacity?: number | null;
  registration_closes_at?: string | null;
}

export type ImpactReasonCode = 'revalidate' | 'capacity_check' | 'period_recheck';

export interface ImpactReason {
  code: ImpactReasonCode;
  message: string;
}

export type AffectedArrangementKind =
  | VenueArrangementFact['kind']
  | EquipmentArrangementFact['kind']
  | 'registrations';

export interface AffectedArrangement {
  kind: AffectedArrangementKind;
  id: number | null;
  label: string;
  starts_at?: string | null;
  ends_at?: string | null;
  reasons: ImpactReason[];
}

export interface ChangeImpact {
  requires_revalidation: boolean;
  outstanding_arrangements: RecheckKey[];
  arrangements: AffectedArrangement[];
}

const REVALIDATE_SUBJECTS: Record<AffectedArrangementKind, string> = {
  venue_booking: 'This venue booking',
  venue_request: 'This pending venue request',
  equipment_reservation: 'This equipment reservation',
  equipment_request: 'This equipment request',
  registrations: 'The registrations',
};

const PERIOD_VERBS: Record<VenueArrangementFact['kind'] | EquipmentArrangementFact['kind'], string> = {
  venue_booking: 'Booked',
  venue_request: 'Requested',
  equipment_reservation: 'Reserved',
  equipment_request: 'Requested',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Singapore keeps UTC+8 all year, so a fixed offset is exact. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * `20 Jun 2030 10:00 SGT`: the wording the database notices use
 * (`to_char(… at time zone 'Asia/Singapore', 'DD Mon YYYY HH24:MI')`),
 * independent of the server's own zone.
 */
export function formatInstant(value: string): string {
  const local = new Date(new Date(value).getTime() + SGT_OFFSET_MS).toISOString();
  return `${local.slice(8, 10)} ${MONTHS[Number(local.slice(5, 7)) - 1]} ${local.slice(0, 4)} ${local.slice(11, 16)} SGT`;
}

function describePeriod(kind: keyof typeof PERIOD_VERBS, startsAt: string | null, endsAt: string | null): string {
  if (startsAt === null || endsAt === null) return 'No period is recorded for it';
  return `${PERIOD_VERBS[kind]} from ${formatInstant(startsAt)} to ${formatInstant(endsAt)}`;
}

/** Whether a Venue Staff exception, or the venue's own capacity, fits the attendance. */
function fitsAttendance(venue: VenueArrangementFact, attendance: number): boolean {
  if (venue.capacity !== null && venue.capacity >= attendance) return true;
  return venue.exception_attendance !== null && venue.exception_attendance >= attendance;
}

function covers(startsAt: string | null, endsAt: string | null, instant: string): boolean {
  if (startsAt === null || endsAt === null) return false;
  const at = new Date(instant).getTime();
  return new Date(startsAt).getTime() <= at && at < new Date(endsAt).getTime();
}

function equipmentLabel(item: EquipmentArrangementFact): string {
  return `${item.equipment_name} × ${item.quantity}`;
}

function capacityMessage(venue: VenueArrangementFact, attendance: number): string {
  const subject = venue.capacity === null
    ? `${venue.venue_name} has no recorded capacity, so it cannot be shown to fit the revised attendance of ${attendance}.`
    : `The revised attendance of ${attendance} is above ${venue.venue_name}'s capacity of ${venue.capacity}.`;
  return `${subject} A new capacity check is needed: only Venue Staff can approve a capacity exception for the revised attendance.`;
}

function periodMessage(kind: keyof typeof PERIOD_VERBS, startsAt: string | null, endsAt: string | null, newStart: string | null): string {
  const target = newStart === null ? 'the event, which no longer has a date' : `the new start of ${formatInstant(newStart)}`;
  return `${describePeriod(kind, startsAt, endsAt)}; recheck it against ${target}.`;
}

/**
 * What a change request would break (AC1–AC3). A significant change lists
 * every venue booking, pending venue request, equipment reservation, live
 * equipment request and the registrations as needing revalidation; a raised
 * attendance that no longer fits a venue adds a capacity check (unless Venue
 * Staff already approved an exception covering it), and a new date adds a
 * period recheck to every venue and equipment item. A change to name,
 * purpose or description alone needs nothing rechecked.
 */
export function assessChangeImpact(
  event: ChangeImpactEventFacts,
  changes: readonly ChangeRequestChange[],
  facts: ChangeImpactFacts
): ChangeImpact {
  if (!changes.some(change => isSignificantField(change.field))) {
    return { requires_revalidation: false, outstanding_arrangements: [], arrangements: [] };
  }
  const attendanceChange = changes.find(change => change.field === 'expected_attendance');
  const newAttendance = typeof attendanceChange?.to === 'number' ? attendanceChange.to : null;
  const dateChange = changes.find(change => change.field === 'proposed_date');
  const newStart = dateChange === undefined ? undefined : (dateChange.to === null ? null : String(dateChange.to));

  const revalidate = (kind: AffectedArrangementKind): ImpactReason => ({
    code: 'revalidate',
    message: `${REVALIDATE_SUBJECTS[kind]} must be revalidated against the changed event details.`,
  });

  const arrangements: AffectedArrangement[] = [];
  for (const venue of facts.venues) {
    const reasons = [revalidate(venue.kind)];
    if (newAttendance !== null && !fitsAttendance(venue, newAttendance)) {
      reasons.push({ code: 'capacity_check', message: capacityMessage(venue, newAttendance) });
    }
    if (newStart !== undefined) {
      reasons.push({ code: 'period_recheck', message: periodMessage(venue.kind, venue.starts_at, venue.ends_at, newStart) });
    }
    arrangements.push({ kind: venue.kind, id: venue.id, label: venue.venue_name,
      starts_at: venue.starts_at, ends_at: venue.ends_at, reasons });
  }
  for (const item of facts.equipment) {
    const reasons = [revalidate(item.kind)];
    if (newStart !== undefined) {
      reasons.push({ code: 'period_recheck', message: periodMessage(item.kind, item.starts_at, item.ends_at, newStart) });
    }
    arrangements.push({ kind: item.kind, id: item.id, label: equipmentLabel(item),
      starts_at: item.starts_at, ends_at: item.ends_at, reasons });
  }
  if (event.registration_needed === true || facts.registrations > 0) {
    arrangements.push({ kind: 'registrations', id: null, label: `Registrations (${facts.registrations} received)`,
      reasons: [revalidate('registrations')] });
  }

  const outstanding: RecheckKey[] = [];
  if (facts.venues.length > 0) outstanding.push('venue_recheck');
  if (facts.equipment.length > 0) outstanding.push('equipment_recheck');
  if (arrangements.some(item => item.kind === 'registrations')) outstanding.push('registration_recheck');
  return { requires_revalidation: true, outstanding_arrangements: outstanding, arrangements };
}

/**
 * Why an outstanding recheck cannot be marked settled yet; empty when it can.
 * - venue_recheck: every confirmed booking and pending venue request covers
 *   the event start and fits the attendance (its capacity, or a Venue Staff
 *   exception for at least that attendance).
 * - equipment_recheck: every live equipment request and every dated
 *   reservation covers the event start.
 * - registration_recheck: when registration is needed, it closes before the
 *   event starts and holds no more registrations than its capacity.
 * - safety_*_recheck (SG2-93): none here; settle_arrangement_recheck refuses a
 *   venue or equipment change while Venue Staff or Technical Support have not
 *   confirmed every flagged request again.
 */
export function recheckBlockers(key: RecheckKey, event: ChangeImpactEventFacts, facts: ChangeImpactFacts): string[] {
  const start = event.proposed_date;
  const blockers: string[] = [];
  if (key === 'venue_recheck') {
    for (const venue of facts.venues) {
      if (start === null) {
        blockers.push(`${venue.venue_name} cannot be checked against the event, which has no date.`);
      } else if (!covers(venue.starts_at, venue.ends_at, start)) {
        blockers.push(`${venue.venue_name}: ${describePeriod(venue.kind, venue.starts_at, venue.ends_at)}, `
          + `which does not cover the event start of ${formatInstant(start)}.`);
      }
      const attendance = event.expected_attendance;
      if (attendance !== null && !fitsAttendance(venue, attendance)) {
        blockers.push(capacityMessage(venue, attendance));
      }
    }
  } else if (key === 'equipment_recheck') {
    for (const item of facts.equipment) {
      if (item.kind === 'equipment_reservation' && item.starts_at === null) continue;
      if (start === null) {
        blockers.push(`${equipmentLabel(item)} cannot be checked against the event, which has no date.`);
      } else if (!covers(item.starts_at, item.ends_at, start)) {
        blockers.push(`${equipmentLabel(item)}: ${describePeriod(item.kind, item.starts_at, item.ends_at)}, `
          + `which does not cover the event start of ${formatInstant(start)}.`);
      }
    }
  } else if (key === 'registration_recheck' && event.registration_needed === true) {
    const closes = event.registration_closes_at ?? null;
    if (closes === null) {
      blockers.push('Registration has no closing time.');
    } else if (start === null) {
      blockers.push('Registration cannot be checked against the event, which has no date.');
    } else if (new Date(closes).getTime() >= new Date(start).getTime()) {
      blockers.push(`Registration closes at ${formatInstant(closes)}, which is not before the event start of ${formatInstant(start)}.`);
    }
    const capacity = event.registration_capacity ?? null;
    if (capacity !== null && facts.registrations > capacity) {
      blockers.push(`${facts.registrations} registrations have been received, above the registration capacity of ${capacity}.`);
    }
  }
  return blockers;
}
