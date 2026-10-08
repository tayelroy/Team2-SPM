import type {
  VenueBookingStatusRow,
  EquipmentRequestArrangementRow
} from '../db/eventArrangements';

/**
 * Computes which of an event's arrangements are in place and which still stand
 * between it and confirmation (SG2-57).
 *
 * The three arrangements are the venue booking(s), any requested equipment, and
 * registration. Each is `ready`, `outstanding`, or `not_required`. Venue is
 * always required; equipment and registration are `not_required` when nothing
 * is requested or registration is not needed.
 *
 * `ready_for_confirmation` means every *required* arrangement is ready — the
 * event can leave the Arrangements step toward the safety check (SG2-100 put
 * Safety Check and Preparation between Arrangements and Confirmed, so this is
 * "arrangements complete", not "one click from confirmed"). SG2-58 owns the
 * actual confirmation transition and its own gating.
 */

export type ArrangementState = 'ready' | 'outstanding' | 'not_required';
export type ArrangementKey = 'venue' | 'equipment' | 'registration';

export interface ArrangementStatus {
  key: ArrangementKey;
  label: string;
  state: ArrangementState;
  detail: string;
}

export interface ArrangementReadinessInput {
  event_id: number;
  registration_needed: boolean | null;
  registration_capacity: number | null;
  registration_opens_at: string | null;
  registration_closes_at: string | null;
  venue_requests: VenueBookingStatusRow[];
  equipment_requests: EquipmentRequestArrangementRow[];
}

export interface ArrangementReadinessResult {
  event_id: number;
  arrangements: ArrangementStatus[];
  /** Keys of the arrangements still outstanding, in display order. */
  outstanding: ArrangementKey[];
  ready_for_confirmation: boolean;
}

// A venue or equipment request that has been decided against (or withdrawn) no
// longer stands for a need the coordinator intends to meet.
const DEAD_STATUSES = new Set(['rejected', 'cancelled']);

function isLive(row: { status: string }): boolean {
  return !DEAD_STATUSES.has(row.status.toLowerCase());
}

function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function computeVenue(requests: VenueBookingStatusRow[]): ArrangementStatus {
  const live = requests.filter(isLive);
  const approved = live.filter(row => row.status.toLowerCase() === 'approved').length;
  const pending = live.filter(row => row.status.toLowerCase() === 'pending').length;

  // Every event needs a venue, so an event with no live booking request has an
  // outstanding venue arrangement rather than "not required".
  if (live.length === 0) {
    return {
      key: 'venue',
      label: 'Venue booking',
      state: 'outstanding',
      detail: 'No venue booking has been requested yet.'
    };
  }
  if (pending > 0) {
    return {
      key: 'venue',
      label: 'Venue booking',
      state: 'outstanding',
      detail: `${pluralise(pending, 'venue booking')} still awaiting approval.`
    };
  }
  return {
    key: 'venue',
    label: 'Venue booking',
    state: 'ready',
    detail: `${pluralise(approved, 'venue booking')} approved.`
  };
}

function computeEquipment(requests: EquipmentRequestArrangementRow[]): ArrangementStatus {
  const live = requests.filter(isLive);

  // Nothing requested means equipment is not needed for this event.
  if (live.length === 0) {
    return {
      key: 'equipment',
      label: 'Equipment',
      state: 'not_required',
      detail: 'No equipment requested.'
    };
  }

  // SG2-53: a request is in place once Technical Support has arranged it
  // (placement recorded) with no remaining shortfall. A null shortfall means it
  // has not been arranged at all.
  const inPlace = live.filter(
    row => row.placement_venue_id !== null && row.shortfall === 0
  ).length;
  const outstanding = live.length - inPlace;

  if (outstanding > 0) {
    return {
      key: 'equipment',
      label: 'Equipment',
      state: 'outstanding',
      detail: `${pluralise(outstanding, 'equipment request')} not yet arranged or with a shortfall.`
    };
  }
  return {
    key: 'equipment',
    label: 'Equipment',
    state: 'ready',
    detail: `${pluralise(inPlace, 'equipment request')} arranged.`
  };
}

function computeRegistration(input: ArrangementReadinessInput): ArrangementStatus {
  if (!input.registration_needed) {
    return {
      key: 'registration',
      label: 'Registration',
      state: 'not_required',
      detail: 'Registration not required.'
    };
  }

  const missing: string[] = [];
  if (input.registration_capacity === null) missing.push('capacity');
  if (input.registration_opens_at === null) missing.push('opening time');
  if (input.registration_closes_at === null) missing.push('closing time');

  if (missing.length > 0) {
    return {
      key: 'registration',
      label: 'Registration',
      state: 'outstanding',
      detail: `Registration ${missing.join(', ')} not set.`
    };
  }
  return {
    key: 'registration',
    label: 'Registration',
    state: 'ready',
    detail: 'Registration capacity and opening and closing times set.'
  };
}

export function computeArrangementReadiness(
  input: ArrangementReadinessInput
): ArrangementReadinessResult {
  const arrangements: ArrangementStatus[] = [
    computeVenue(input.venue_requests),
    computeEquipment(input.equipment_requests),
    computeRegistration(input)
  ];

  const outstanding = arrangements
    .filter(arrangement => arrangement.state === 'outstanding')
    .map(arrangement => arrangement.key);

  return {
    event_id: input.event_id,
    arrangements,
    outstanding,
    ready_for_confirmation: outstanding.length === 0
  };
}
