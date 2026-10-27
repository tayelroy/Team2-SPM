import type {
  ApplyAcceptedEventChangeInput,
  ApplyAcceptedEventChangeResult,
  SettleArrangementRecheckResult
} from '../../server/src/db/changeImpact';
import { fetchEventArrangementFacts } from '../../server/src/db/eventArrangements';
import { eventLabel, eventNoticeMessages } from '../../server/src/db/eventNotifications';
import { computeArrangementReadiness, isSafetyApproved } from '../../server/src/events/arrangementReadiness';
import {
  CHANGEABLE_FIELDS,
  RECHECK_KEYS,
  RETURNS_TO_PLANNING,
  SIGNIFICANT_CHANGE_FIELDS,
  type RecheckKey
} from '../../server/src/events/changeImpact';
import { announceAttendeeChange, attendeeDetails } from './attendee-change-notices';
import type { MemoryDatabase } from './memory-database';
import { returnWhenSettled, waitingOn } from './safety-rereviews';
import { latestSafetyDecision } from './safety-decisions';

type Row = Record<string, unknown>;

function nextId(rows: Row[], key: string) {
  return Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
}

/** Loopback UI fixture mirroring public.apply_accepted_event_change (with
 * SG2-94's withdrawal of the safety approval and SG2-91's
 * refresh_safety_check_status) and public.settle_arrangement_recheck over the
 * in-memory tables. The SQL suites (supabase/tests/event_change_impact.sql,
 * supabase/tests/safety_approval_gate.sql) prove the production functions,
 * their locking, whitelist and grants. */
export function createMemoryChangeImpact(database: MemoryDatabase) {
  const audit = (eventId: number, actorId: string, field: string, from: unknown, to: unknown) => {
    const logs = database.tables.event_audit_logs;
    logs.push({ log_id: nextId(logs, 'log_id'), event_id: eventId, actor_id: actorId, field_name: field,
      old_value: from === null || from === undefined ? null : String(from), new_value: to === null || to === undefined ? null : String(to),
      created_at: new Date().toISOString() });
  };

  // SG2-91 safety_check_arrangements_ready: no recheck outstanding, and the
  // venue and equipment rules confirm_event applies.
  const arrangementsReady = async (event: Row, eventId: number) => {
    if (event.arrangements_recheck_needed === true && ((event.outstanding_arrangements ?? []) as string[]).length > 0) return false;
    const facts = await fetchEventArrangementFacts(database.client, eventId);
    if (!facts.ok) throw new Error('Arrangement facts unavailable');
    const { arrangements } = computeArrangementReadiness({ event_id: eventId, status: String(event.status), latest_safety_decision: null,
      registration_needed: false, registration_capacity: null, registration_opens_at: null, registration_closes_at: null,
      venue_requests: facts.facts.venue_requests, affected_bookings: facts.facts.affected_bookings,
      equipment_requests: facts.facts.equipment_requests });
    return arrangements.every(arrangement => arrangement.key === 'safety' || arrangement.state !== 'outstanding');
  };

  // SG2-91 refresh_safety_check_status for an event SG2-94 has just returned
  // to Planning: it goes straight back to the check when everything is in place.
  const refreshSafetyCheck = async (event: Row, eventId: number, actorId: string) => {
    if (!['approved', 'planning'].includes(String(event.status)) || !(await arrangementsReady(event, eventId))) return;
    const previous = String(event.status);
    Object.assign(event, { status: 'awaiting_safety_check', awaiting_safety_check_since: new Date().toISOString(),
      safety_check_revision: Number(event.safety_check_revision ?? 0) + 1 });
    audit(eventId, actorId, 'status', previous, 'awaiting_safety_check');
  };

  const applyChange = async (_admin: unknown, input: ApplyAcceptedEventChangeInput): Promise<ApplyAcceptedEventChangeResult> => {
    const event = database.tables.events.find(row => row.event_id === input.eventId);
    if (!event || event.status !== input.expectedStatus || event.coordinator_id !== input.actorId) return { outcome: 'stale' };
    const shown = attendeeDetails(database, input.eventId);
    const previous = String(event.status);
    const wasApproved = isSafetyApproved(previous, latestSafetyDecision(database, input.eventId));
    let changedSignificant = false;
    for (const field of CHANGEABLE_FIELDS) {
      if (!(field in input.changes)) continue;
      const to = input.changes[field] ?? null;
      if ((event[field] ?? null) !== to) {
        audit(input.eventId, input.actorId, field, event[field], to);
        if ((SIGNIFICANT_CHANGE_FIELDS as readonly string[]).includes(field)) changedSignificant = true;
      }
      event[field] = to;
    }
    audit(input.eventId, input.actorId, 'change_request', null, `Accepted ${input.changeReference}`);
    const added = RECHECK_KEYS.filter(key => input.outstanding.includes(key));
    const outstanding = [...((event.outstanding_arrangements ?? []) as RecheckKey[])];
    for (const key of added) if (!outstanding.includes(key)) outstanding.push(key);
    // SG2-94 AC3: what was approved has changed, so the approval cannot stand.
    const withdrawn = changedSignificant && (previous === 'preparation' || previous === 'confirmed');
    const returned = (added.length > 0 && (RETURNS_TO_PLANNING as readonly string[]).includes(previous)) || withdrawn;
    if (added.length > 0) Object.assign(event, { arrangements_recheck_needed: true, outstanding_arrangements: outstanding });
    if (returned || (added.length > 0 && previous === 'approved')) event.status = 'planning';
    if (returned) Object.assign(event, { confirmed_by: null, confirmed_at: null });
    if (event.status !== previous) audit(input.eventId, input.actorId, 'status', previous, event.status);
    if (withdrawn && wasApproved) {
      audit(input.eventId, input.actorId, 'safety_approval', 'Approved',
        `Withdrawn: the accepted ${input.changeReference} changed what was approved, so the event must pass the safety check again`);
    }
    if (returned) {
      const label = eventLabel(event.name as string | null);
      const notices = database.tables.notifications;
      const recipients: [unknown, string][] = [[event.organiser_id, eventNoticeMessages.returnedToPlanningOrganiser(label)]];
      if (event.coordinator_id !== event.organiser_id) {
        recipients.push([event.coordinator_id, eventNoticeMessages.returnedToPlanningCoordinator(label)]);
      }
      for (const [recipient, message] of recipients) {
        notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: recipient, event_id: input.eventId,
          request_id: null, kind: 'event_returned_to_planning', message, created_at: new Date().toISOString() });
      }
    }
    // With no recheck named, nothing else refreshes the event: one whose
    // arrangements are all still in place goes straight back to the check.
    if (withdrawn && added.length === 0) await refreshSafetyCheck(event, input.eventId, input.actorId);
    // SG2-102: the change reaches the event's registered attendees at commit.
    announceAttendeeChange(database, input.eventId, shown);
    return { outcome: 'ok', previous_status: previous, status: String(event.status), returned_to_planning: returned,
      arrangements_recheck_needed: Boolean(event.arrangements_recheck_needed),
      outstanding_arrangements: [...((event.outstanding_arrangements ?? []) as RecheckKey[])] };
  };

  const settleRecheck = async (_admin: unknown, eventId: number, actorId: string, key: RecheckKey): Promise<SettleArrangementRecheckResult> => {
    const event = database.tables.events.find(row => row.event_id === eventId);
    if (!event || event.coordinator_id !== actorId) return { outcome: 'stale' };
    const current = (event.outstanding_arrangements ?? []) as RecheckKey[];
    if (!current.includes(key)) return { outcome: 'not_outstanding' };
    // SG2-93 AC4: a safety venue or equipment change waits for the staff.
    const waiting = waitingOn(database, eventId, key);
    if (waiting.length > 0) return { outcome: 'flagged', waiting };
    const remaining = current.filter(item => item !== key);
    Object.assign(event, { outstanding_arrangements: remaining, arrangements_recheck_needed: remaining.length > 0 });
    audit(eventId, actorId, 'arrangement_recheck', null, `${key} settled`);
    if (key.startsWith('safety_')) returnWhenSettled(database, event, actorId);
    return { outcome: 'ok', arrangements_recheck_needed: remaining.length > 0, outstanding_arrangements: remaining };
  };

  return { applyChange, settleRecheck };
}

const START = '2030-06-20T02:00:00.000Z';
const END = '2030-06-20T06:00:00.000Z';

/**
 * SG2-66: 661 Harbour Showcase, Confirmed, organised by `organiser` and
 * assigned to `coordinator`. 80 expected guests in Regression Hall (capacity
 * 100, booked through an approved request), 12 wireless microphones reserved
 * for the same period, and registration for 120 with three registrations
 * (one cancelled, which does not count). The sample attendance change raises
 * attendance to 120, above the hall's capacity.
 */
export function seedChangeImpact(database: MemoryDatabase) {
  const { events, venue_booking_requests: venueRequests, venue_bookings: bookings,
    equipment_requests: equipmentRequests, equipment_reservations: reservations, registrations } = database.tables;
  events.push({ ...events[0], event_id: 661, name: 'Harbour Showcase', status: 'confirmed', coordinator_id: 'user-coordinator',
    organiser_id: 'user-organiser', proposed_date: START, expected_attendance: 80, description: 'An evening showcase.',
    registration_needed: true, registration_capacity: 120, registration_opens_at: '2026-01-01T00:00:00.000Z',
    registration_closes_at: '2030-06-19T16:00:00.000Z', arrangements_recheck_needed: false, outstanding_arrangements: [],
    planning_notes: null, confirmed_by: 'user-coordinator', confirmed_at: '2030-01-05T00:00:00.000Z' });
  venueRequests.push({ request_id: 6611, event_id: 661, venue_id: 1, starts_at: START, ends_at: END, status: 'approved',
    layout: 'theatre', venue_requirements: 'A stage', notes: null, requested_by: 'user-coordinator',
    requested_at: '2030-01-01T00:00:00.000Z', decided_by: 'user-venue', decided_at: '2030-01-02T00:00:00.000Z',
    decision_reason: null, venue_booking_id: 6611 });
  bookings.push({ booking_id: 6611, venue_id: 1, event_id: 661, starts_at: START, ends_at: END, status: 'confirmed' });
  equipmentRequests.push({ request_id: 6612, event_id: 661, equipment_id: 1, quantity: 12, notes: null, starts_at: START,
    ends_at: END, status: 'approved', arrangement_notes: 'Stage left.', shortfall: 0, placement_venue_id: 1,
    placement_position: 'Stage left', version: 2 });
  reservations.push({ reservation_id: 6612, request_id: 6612, event_id: 661, equipment_id: 1, quantity_reserved: 12,
    starts_at: START, ends_at: END, reserved_at: '2030-01-03T00:00:00.000Z' });
  registrations.push(
    { registration_id: 6611, event_id: 661, attendee_id: 'user-attendee', status: 'registered' },
    { registration_id: 6612, event_id: 661, attendee_id: 'user-colleague', status: 'registered' },
    { registration_id: 6613, event_id: 661, attendee_id: 'user-organiser2', status: 'cancelled' }
  );
}
