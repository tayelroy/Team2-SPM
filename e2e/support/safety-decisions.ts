import type {
  RecordSafetyDecisionInput,
  RecordSafetyDecisionResult,
  ReworkSafetyRejectedEventResult
} from '../../server/src/db/safetyDecisions';
import { eventLabel, eventNoticeMessages } from '../../server/src/db/eventNotifications';
import { SAFETY_DECISION_NEXT_STATUS, safetyArrangementList } from '../../server/src/events/safetyDecisions';
import type { MemoryDatabase } from './memory-database';
import { flagRequestedChanges } from './safety-rereviews';

type Row = Record<string, unknown>;

function nextId(rows: Row[], key: string) {
  return Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
}

/** Loopback UI fixture mirroring public.record_safety_decision and
 * public.rework_safety_rejected_event over the in-memory tables, with SG2-91's
 * safety_check_track_event moving the revision on as the event leaves the
 * check. The SQL suite (supabase/tests/safety_decisions.sql) proves the
 * production functions, their locking, validation, wording and grants. */
export function createMemorySafetyDecisions(database: MemoryDatabase) {
  const audit = (eventId: number, actorId: string, field: string, from: unknown, to: string) => {
    const logs = database.tables.event_audit_logs;
    logs.push({ log_id: nextId(logs, 'log_id'), event_id: eventId, actor_id: actorId, field_name: field,
      old_value: from === null || from === undefined ? null : String(from), new_value: to, created_at: new Date().toISOString() });
  };

  const recordDecision = async (_admin: unknown, input: RecordSafetyDecisionInput): Promise<RecordSafetyDecisionResult> => {
    const role = database.tables.account_roles.find(row => row.user_id === input.actorId)?.role;
    if (role !== 'safety_officer') return { outcome: 'forbidden' };
    const event = database.tables.events.find(row => row.event_id === input.eventId);
    if (!event) return { outcome: 'missing' };
    if (event.status !== 'awaiting_safety_check') return { outcome: 'closed', status: String(event.status) };
    const revision = Number(event.safety_check_revision ?? 0);
    if (revision !== input.expectedRevision) return { outcome: 'stale', revision };
    const previous = String(event.status);
    const status = SAFETY_DECISION_NEXT_STATUS[input.decision];
    const decisions = database.tables.event_safety_decisions;
    const decidedAt = new Date().toISOString();
    const decisionId = nextId(decisions, 'decision_id');
    decisions.push({ decision_id: decisionId, event_id: input.eventId, decision: input.decision, reason: input.reason,
      arrangements: [...input.arrangements], decided_by: input.actorId, decided_at: decidedAt });
    Object.assign(event, { status, awaiting_safety_check_since: null, safety_check_revision: revision + 1 });
    if (input.decision === 'request_changes') flagRequestedChanges(database, event, decisionId, input.arrangements);
    const named = safetyArrangementList(input.arrangements);
    audit(input.eventId, input.actorId, 'safety_decision', null,
      input.decision === 'approve' ? `Approved${input.reason ? `: ${input.reason}` : ''}`
        : input.decision === 'reject' ? `Rejected: ${input.reason}` : `Changes requested (${named}): ${input.reason}`);
    audit(input.eventId, input.actorId, 'status', previous, status);
    const label = eventLabel(event.name as string | null);
    const message = input.decision === 'approve' ? eventNoticeMessages.safetyApproved(label, input.reason)
      : input.decision === 'reject' ? eventNoticeMessages.safetyRejected(label, input.reason!)
        : eventNoticeMessages.safetyChangesRequested(label, named, input.reason!);
    const recipients = [event.organiser_id, event.coordinator_id]
      .filter((recipient, index, all) => recipient && all.indexOf(recipient) === index);
    for (const recipient of recipients) {
      const notices = database.tables.notifications;
      notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: recipient, event_id: input.eventId,
        request_id: null, kind: 'safety_decision', message, created_at: decidedAt });
    }
    return { outcome: 'ok', decision_id: decisionId, decision: input.decision, previous_status: previous, status, decided_at: decidedAt };
  };

  const rework = async (_admin: unknown, eventId: number, actorId: string): Promise<ReworkSafetyRejectedEventResult> => {
    const event = database.tables.events.find(row => row.event_id === eventId);
    if (!event || event.coordinator_id !== actorId) return { outcome: 'missing' };
    if (event.status !== 'safety_rejected') return { outcome: 'closed', status: String(event.status) };
    event.status = 'planning';
    audit(eventId, actorId, 'status', 'safety_rejected', 'planning');
    return { outcome: 'ok', status: 'planning' };
  };

  return { recordDecision, rework };
}

/**
 * SG2-92: three events awaiting the Safety Officer's check, organised by
 * `organiser` and assigned to `coordinator`, each with Regression Hall
 * approved and booked and 4 wireless microphones placed, listed oldest wait
 * first: 921 Harbour Gala (to approve), 922 Riverside Fair (to reject) and
 * 923 Bayfront Talk (to request changes). The fixture places them in the
 * check directly, at revision 1, rather than through SG2-91's triggers.
 */
export function seedSafetyDecisions(database: MemoryDatabase) {
  const { events, venue_booking_requests: requests, venue_bookings: bookings, equipment_requests: equipmentRequests } = database.tables;
  const seeded: [number, string, string][] = [
    [921, 'Harbour Gala', '2030-07-10T02:00:00.000Z'],
    [922, 'Riverside Fair', '2030-07-11T02:00:00.000Z'],
    [923, 'Bayfront Talk', '2030-07-12T02:00:00.000Z']
  ];
  for (const [eventId, name, date] of seeded) {
    events.push({ ...events[0], event_id: eventId, name, status: 'awaiting_safety_check', coordinator_id: 'user-coordinator',
      organiser_id: 'user-organiser', proposed_date: date, expected_attendance: 80, accessibility_needs: 'Step-free access',
      arrangements_recheck_needed: false, outstanding_arrangements: [], planning_notes: null,
      awaiting_safety_check_since: `2030-07-0${eventId - 920}T01:00:00.000Z`, safety_check_revision: 1 });
    // Each event's venue and equipment are booked for its own four hours.
    const end = new Date(Date.parse(date) + 4 * 60 * 60 * 1000).toISOString();
    requests.push({ request_id: eventId, event_id: eventId, venue_id: 1, starts_at: date, ends_at: end, layout: 'theatre',
      status: 'approved', venue_requirements: null, notes: null, requested_by: 'user-coordinator',
      requested_at: '2030-06-01T00:00:00.000Z', decided_by: 'user-venue', decided_at: '2030-06-02T00:00:00.000Z',
      decision_reason: null, venue_booking_id: eventId });
    bookings.push({ booking_id: eventId, venue_id: 1, event_id: eventId, starts_at: date, ends_at: end, status: 'confirmed' });
    equipmentRequests.push({ request_id: eventId, event_id: eventId, equipment_id: 1, quantity: 4, notes: null, starts_at: date,
      ends_at: end, status: 'approved', arrangement_notes: null, shortfall: 0, placement_venue_id: 1, placement_position: 'Stage left', version: 1 });
  }
}

/** SG2-92: the expected attendance of a seeded event awaiting its check rises
 * to 450, and its safety_check_revision moves on as SG2-91's trigger would. */
export function changeReviewedDetail(database: MemoryDatabase, eventId: number) {
  const event = database.tables.events.find(row => row.event_id === eventId && row.status === 'awaiting_safety_check');
  if (!event) return;
  Object.assign(event, { expected_attendance: 450, safety_check_revision: Number(event.safety_check_revision ?? 0) + 1 });
}
