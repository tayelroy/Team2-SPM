import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChangeRequest,
  ChangeRequestEvent,
  ChangeRequestSource,
  MockChangeRequestSource
} from '../../server/src/changeRequests/mockChangeRequests';
import type { RaiseChangeRequestInput, RaiseChangeRequestResult } from '../../server/src/db/changeRequests';
import { CHANGE_FIELD_LABELS } from '../../server/src/events/changeImpact';
import { announceAttendeeChange, attendeeDetails } from './attendee-change-notices';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;

const CLOSED = ['draft', 'cancelled', 'rejected', 'completed'];

function nextId(rows: Row[], key: string) {
  return Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
}

/** Loopback UI fixture mirroring public.raise_event_change_request, the
 * public.event_change_requests reads (SG2-64) and
 * public.decide_event_change_request (SG2-65) over the in-memory tables. The
 * SQL suite (supabase/tests/event_change_requests.sql) proves the production
 * function, its row lock, whitelist and grants.
 *
 * SG2-66's sample requests stay available for the events a fixture opts in
 * (`useSamplesFor`), so the change-impact journeys keep their stable ids;
 * every other event shows only what an organiser actually raised. */
export function createMemoryChangeRequests(database: MemoryDatabase, samples: MockChangeRequestSource) {
  const sampleEvents = new Set<number>();
  const rows = () => (database.tables.event_change_requests ??= []);

  const toRequest = (row: Row): ChangeRequest => ({
    id: String(row.change_request_id),
    requested_at: String(row.created_at),
    reason: String(row.reason),
    status: 'pending',
    changes: [{
      field: row.field as keyof typeof CHANGE_FIELD_LABELS,
      label: CHANGE_FIELD_LABELS[row.field as keyof typeof CHANGE_FIELD_LABELS],
      from: row.from_value as string | number | null,
      to: row.to_value as string | number
    }]
  });
  const pending = (event: ChangeRequestEvent) =>
    rows().filter(row => row.event_id === event.event_id && row.status === 'pending');

  const source: ChangeRequestSource = {
    async list(event) {
      const raised = pending(event).map(toRequest);
      return sampleEvents.has(event.event_id) ? [...await samples.list(event), ...raised] : raised;
    },
    async get(event, id) {
      const row = pending(event).find(candidate => String(candidate.change_request_id) === id);
      if (row) return toRequest(row);
      return sampleEvents.has(event.event_id) ? samples.get(event, id) : null;
    },
    // Mirrors public.decide_event_change_request (SG2-65): records who decided
    // and when, writes an AC4 acceptance onto the request, notifies the organiser.
    async decide(event, id, decision) {
      const row = pending(event).find(candidate => String(candidate.change_request_id) === id);
      if (!row) return sampleEvents.has(event.event_id) ? samples.decide(event, id, decision) : 'not_pending';
      const { tables } = database;
      const stored = tables.events.find(candidate => candidate.event_id === event.event_id) as Row;
      const label = String(stored.name || 'Untitled event').slice(0, 500);
      let message = `${label}: your change request was accepted.`;
      if (decision.decision === 'refused') {
        message = `${label}: your change request was refused. Reason: ${decision.reason}`;
        Object.assign(row, { decision_reason: decision.reason });
      } else if (decision.next) {
        const shown = attendeeDetails(database, event.event_id);
        stored[String(row.field)] = row.to_value;
        // SG2-102: an accepted date change reaches registered attendees.
        announceAttendeeChange(database, event.event_id, shown);
        if (decision.next === 'review') stored.status = 'under_review';
        message = decision.next === 'review'
          ? `${label}: your change request was accepted and the request is back in review.`
          : `${label}: your change request was accepted. Resubmit the request for review.`;
      }
      Object.assign(row, { status: decision.decision, decided_by: decision.by, decided_at: new Date().toISOString() });
      const notices = tables.notifications;
      notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: row.requested_by,
        event_id: event.event_id, request_id: null,
        kind: decision.decision === 'refused' ? 'change_refused' : 'change_accepted',
        message, created_at: row.decided_at });
      return 'ok';
    }
  };

  const raise = async (_admin: SupabaseClient, input: RaiseChangeRequestInput): Promise<RaiseChangeRequestResult> => {
    const { tables } = database;
    const actor = tables.users.find(row => row.user_id === input.actorId);
    const isOrganiser = tables.account_roles.some(row => row.user_id === input.actorId && row.role === 'event_organiser');
    const event = tables.events.find(row => row.event_id === input.eventId && row.organiser_id === input.actorId);
    if (!actor || !isOrganiser || !actor.organisation || !event || event.organisation !== actor.organisation) {
      return { outcome: 'not_found' };
    }
    const status = String(event.status);
    if (CLOSED.includes(status)) return { outcome: 'closed', status };
    const current = (event[input.field] ?? null) as string | number | null;
    const unchanged = input.field === 'proposed_date'
      ? current !== null && new Date(String(current)).getTime() === new Date(String(input.to)).getTime()
      : current === input.to;
    if (unchanged) return { outcome: 'unchanged' };
    const row: Row = {
      change_request_id: nextId(rows(), 'change_request_id'), event_id: input.eventId, requested_by: input.actorId,
      field: input.field, from_value: current, to_value: input.to, reason: input.reason, status: 'pending',
      created_at: new Date().toISOString()
    };
    rows().push(row);
    const coordinator = event.coordinator_id as string | null;
    if (coordinator) {
      const notices = tables.notifications;
      notices.push({ notification_id: nextId(notices, 'notification_id'), recipient_id: coordinator, event_id: input.eventId,
        request_id: null, kind: 'change_requested',
        message: `${String(event.name || 'Untitled event').slice(0, 500)} has a change request waiting for your decision.`,
        created_at: row.created_at });
    }
    return { outcome: 'ok', request: toRequest(row), coordinator_notified: coordinator !== null };
  };

  return {
    source,
    raise,
    useSamplesFor(eventId: number) { sampleEvents.add(eventId); },
    reset() {
      sampleEvents.clear();
      samples.reset();
    }
  };
}
