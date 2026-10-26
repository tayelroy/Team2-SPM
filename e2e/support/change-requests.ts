import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChangeRequest,
  ChangeRequestEvent,
  ChangeRequestSource,
  MockChangeRequestSource
} from '../../server/src/changeRequests/mockChangeRequests';
import type { RaiseChangeRequestInput, RaiseChangeRequestResult } from '../../server/src/db/changeRequests';
import { CHANGE_FIELD_LABELS } from '../../server/src/events/changeImpact';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;

const CLOSED = ['draft', 'cancelled', 'rejected', 'completed'];

function nextId(rows: Row[], key: string) {
  return Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
}

/** Loopback UI fixture mirroring public.raise_event_change_request and the
 * public.event_change_requests reads (SG2-64) over the in-memory tables. The
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
    async markAccepted(event, id) {
      const row = pending(event).find(candidate => String(candidate.change_request_id) === id);
      if (row) row.status = 'accepted';
      else await samples.markAccepted(event, id);
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
