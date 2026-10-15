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
 * `ready_for_confirmation` means every *required* arrangement is ready. SG2-58's
 * `confirm_event` RPC applies the same three rules in SQL as its gate, so the
 * panel and the Confirm action never disagree; any change here must be made
 * there too (supabase/migrations/202610150001_event_confirmation.sql, whose
 * venue rule SG2-82 replaced in 202610150003_confirm_event_rejected_venues.sql).
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
  /** Whether the event has any live venue booking request (pending — including
   * one placed by a tentative hold — or approved). The coordinator's "find
   * venues" next step and SG2-39's planning recheck both key off this. */
  venue_requested: boolean;
}

// An equipment request that has been decided against (or withdrawn) no longer
// stands for a need the coordinator intends to meet; neither does a pending or
// approved venue request for `venue_requested`. Venue readiness itself keeps
// rejected requests (SG2-82, see computeVenue).
const DEAD_STATUSES = new Set(['rejected', 'cancelled']);

function isLive(row: { status: string }): boolean {
  return !DEAD_STATUSES.has(row.status.toLowerCase());
}

function pluralise(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export interface VenueTally {
  /** Every request but a cancelled (withdrawn or released) one. */
  needed: number;
  approved: number;
  pending: number;
  rejected: number;
  /** Approved requests no longer linked to a confirmed booking. */
  unbooked: number;
}

/**
 * SG2-82 AC5: every venue the event needs must be approved. A rejected
 * request is still a venue the event needs until the coordinator withdraws it
 * (or the booking is released), which cancels it; only cancelled requests stop
 * counting. Also used by the event's venue request list
 * (server/src/venues/bookingRequests.ts), so both say the same.
 */
export function venueTally(requests: VenueBookingStatusRow[]): VenueTally {
  const needed = requests.filter(row => row.status.toLowerCase() !== 'cancelled');
  const count = (status: string) => needed.filter(row => row.status.toLowerCase() === status);
  const approvedRows = count('approved');
  return {
    needed: needed.length,
    approved: approvedRows.length,
    pending: count('pending').length,
    rejected: count('rejected').length,
    // SG2-58 review: an approved request whose booking was converted from a
    // hold and later released stays approved, so approval alone does not
    // prove a venue.
    unbooked: approvedRows.filter(row => !row.booked).length
  };
}

function computeVenue(requests: VenueBookingStatusRow[]): ArrangementStatus {
  const { needed, approved, pending, rejected, unbooked } = venueTally(requests);

  // Every event needs a venue, so an event with no venue booking request has
  // an outstanding venue arrangement rather than "not required".
  if (needed === 0) {
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
  if (rejected > 0) {
    return {
      key: 'venue',
      label: 'Venue booking',
      state: 'outstanding',
      detail: rejected === 1
        ? '1 venue booking rejected: request a replacement if the event still needs one, then withdraw the rejected request.'
        : `${rejected} venue bookings rejected: request replacements if the event still needs them, then withdraw the rejected requests.`
    };
  }
  if (unbooked > 0) {
    return {
      key: 'venue',
      label: 'Venue booking',
      state: 'outstanding',
      detail: `${pluralise(unbooked, 'approved venue request')} no longer ${
        unbooked === 1 ? 'has' : 'have'
      } a confirmed booking.`
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

  // SG2-58 (product-owner decision): equipment is in place only when it is
  // both reserved (an SG2-55 receipt for the request) and arranged (SG2-53
  // placement recorded with no remaining shortfall). A null shortfall means
  // it has not been arranged at all.
  const inPlace = live.filter(
    row => row.reserved && row.placement_venue_id !== null && row.shortfall === 0
  ).length;
  const outstanding = live.length - inPlace;

  if (outstanding > 0) {
    return {
      key: 'equipment',
      label: 'Equipment',
      state: 'outstanding',
      detail: `${pluralise(outstanding, 'equipment request')} not yet reserved and placed with no shortfall.`
    };
  }
  return {
    key: 'equipment',
    label: 'Equipment',
    state: 'ready',
    detail: `${pluralise(inPlace, 'equipment request')} reserved and placed.`
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
    ready_for_confirmation: outstanding.length === 0,
    venue_requested: input.venue_requests.some(isLive)
  };
}
