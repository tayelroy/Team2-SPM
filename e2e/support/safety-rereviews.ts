import type {
  ConfirmSafetyRereviewResult,
  ListEventSafetyRereviewsResult,
  ListSafetyRereviewQueueResult,
  SafetyRereview,
  SafetyRereviewArrangement,
  SafetyRereviewQueueItem
} from '../../server/src/db/safetyRereviews';
import type { WaitingSafetyRereview } from '../../server/src/db/changeImpact';
import type { RecheckKey } from '../../server/src/events/changeImpact';
import type { MemoryDatabase } from './memory-database';

type Row = Record<string, unknown>;

function nextId(rows: Row[], key: string) {
  return Math.max(0, ...rows.map(row => Number(row[key]))) + 1;
}

const sgt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const sgtTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const KEY_BY_ARRANGEMENT: Record<SafetyRereviewArrangement, RecheckKey> = {
  venue: 'safety_venue_recheck',
  equipment: 'safety_equipment_recheck'
};

/** As public.safety_rereview_labels: the venue and its booked period in SGT,
 * or the quantity and the equipment name. */
function labelOf(database: MemoryDatabase, flag: Row): string {
  if (flag.arrangement === 'venue') {
    const request = database.tables.venue_booking_requests.find(row => row.request_id === flag.venue_request_id) ?? {};
    const venue = database.tables.venues.find(row => row.venue_id === request.venue_id);
    return `${String(venue?.name ?? 'Venue no longer listed')} (${sgt.format(new Date(String(request.starts_at))).replace(',', '')}`
      + ` – ${sgtTime.format(new Date(String(request.ends_at)))} SGT)`;
  }
  const request = database.tables.equipment_requests.find(row => row.request_id === flag.equipment_request_id) ?? {};
  const equipment = database.tables.equipment.find(row => row.equipment_id === request.equipment_id);
  return `${Number(request.quantity)} × ${String(equipment?.name ?? 'Equipment no longer listed')}`;
}

/**
 * SG2-93 AC1/AC2: the Request Changes block of public.record_safety_decision —
 * flags each live request of the named kinds and appends the named keys.
 */
export function flagRequestedChanges(database: MemoryDatabase, event: Row, decisionId: number, named: string[]) {
  const flags = database.tables.safety_rereviews;
  const live = (row: Row) => row.event_id === event.event_id && ['pending', 'approved'].includes(String(row.status));
  const flagged: Row[] = [
    ...(named.includes('venue') ? database.tables.venue_booking_requests.filter(live)
      .map(row => ({ arrangement: 'venue', venue_request_id: row.request_id, equipment_request_id: null })) : []),
    ...(named.includes('equipment') ? database.tables.equipment_requests.filter(live)
      .map(row => ({ arrangement: 'equipment', venue_request_id: null, equipment_request_id: row.request_id })) : [])
  ];
  for (const flag of flagged) {
    flags.push({ review_id: nextId(flags, 'review_id'), event_id: event.event_id, decision_id: decisionId, ...flag,
      flagged_at: new Date().toISOString(), resolution: null, resolved_by: null, resolved_at: null });
  }
  const outstanding = (event.outstanding_arrangements ?? []) as string[];
  event.outstanding_arrangements = [...outstanding, ...named.map(n => `safety_${n}_recheck`).filter(key => !outstanding.includes(key))];
  event.arrangements_recheck_needed = true;
}

/** The labels of the open flags a safety key is still waiting on (settle_arrangement_recheck's SG2-93 block). */
export function waitingOn(database: MemoryDatabase, eventId: number, key: string): WaitingSafetyRereview[] {
  const arrangement: SafetyRereviewArrangement | null = key === 'safety_venue_recheck' ? 'venue'
    : key === 'safety_equipment_recheck' ? 'equipment' : null;
  if (!arrangement) return [];
  return database.tables.safety_rereviews
    .filter(flag => flag.event_id === eventId && flag.arrangement === arrangement && flag.resolved_at === null)
    .map(flag => ({ arrangement, label: labelOf(database, flag) }));
}

/**
 * SG2-91's refresh after the event's outstanding keys change: with nothing
 * left outstanding a Planning event goes back to Awaiting Safety Check. The
 * loopback fixtures keep every venue and equipment arrangement in place, so
 * the rest of safety_check_arrangements_ready() is not mirrored here; the SQL
 * suites prove it.
 */
export function returnWhenSettled(database: MemoryDatabase, event: Row, actorId: string) {
  if (event.status !== 'planning' || ((event.outstanding_arrangements ?? []) as string[]).length > 0) return;
  Object.assign(event, { status: 'awaiting_safety_check', awaiting_safety_check_since: new Date().toISOString(),
    safety_check_revision: Number(event.safety_check_revision ?? 0) + 1 });
  const logs = database.tables.event_audit_logs;
  logs.push({ log_id: nextId(logs, 'log_id'), event_id: event.event_id, actor_id: actorId, field_name: 'status',
    old_value: 'planning', new_value: 'awaiting_safety_check', created_at: new Date().toISOString() });
}

/** Loopback UI fixture mirroring public.event_safety_rereviews,
 * safety_rereview_queue and confirm_safety_rereview over the in-memory
 * tables. supabase/tests/safety_changes_requested.sql proves the production
 * functions, their locking, the withdrawal trigger and the grants. */
export function createMemorySafetyRereviews(database: MemoryDatabase) {
  const userName = (id: unknown) => (database.tables.users.find(row => row.user_id === id)?.name as string | undefined) ?? null;

  const listRereviews = async (_admin: unknown, eventId: number): Promise<ListEventSafetyRereviewsResult> => ({
    ok: true,
    rereviews: database.tables.safety_rereviews.filter(flag => flag.event_id === eventId)
      .sort((a, b) => Number(b.decision_id) - Number(a.decision_id) || Number(a.review_id) - Number(b.review_id))
      .map((flag): SafetyRereview => ({
        review_id: Number(flag.review_id), decision_id: Number(flag.decision_id), arrangement: flag.arrangement as SafetyRereviewArrangement,
        label: labelOf(database, flag), flagged_at: String(flag.flagged_at), resolution: flag.resolution as SafetyRereview['resolution'],
        resolved_by_name: userName(flag.resolved_by), resolved_at: (flag.resolved_at as string | null) ?? null
      }))
  });

  const listQueue = async (_admin: unknown, arrangement: SafetyRereviewArrangement): Promise<ListSafetyRereviewQueueResult> => ({
    ok: true,
    items: database.tables.safety_rereviews.filter(flag => flag.arrangement === arrangement && flag.resolved_at === null)
      .sort((a, b) => Number(a.review_id) - Number(b.review_id))
      .map((flag): SafetyRereviewQueueItem => {
        const event = database.tables.events.find(row => row.event_id === flag.event_id) ?? {};
        const decision = database.tables.event_safety_decisions.find(row => row.decision_id === flag.decision_id) ?? {};
        const venueRequest = database.tables.venue_booking_requests.find(row => row.request_id === flag.venue_request_id);
        const equipmentRequest = database.tables.equipment_requests.find(row => row.request_id === flag.equipment_request_id);
        const placement = database.tables.venues.find(row => row.venue_id === equipmentRequest?.placement_venue_id);
        return {
          review_id: Number(flag.review_id), arrangement, event_id: Number(flag.event_id),
          event_name: (event.name as string | null) ?? null, proposed_date: (event.proposed_date as string | null) ?? null,
          coordinator_name: userName(event.coordinator_id), flagged_at: String(flag.flagged_at), label: labelOf(database, flag),
          reason: (decision.reason as string | null) ?? null, decided_by_name: userName(decision.decided_by),
          layout: (venueRequest?.layout as string | null) ?? null, placement_venue_name: (placement?.name as string | null) ?? null,
          placement_position: (equipmentRequest?.placement_position as string | null) ?? null
        };
      })
  });

  const confirm = async (_admin: unknown, reviewId: number, actorId: string, actingRole: string): Promise<ConfirmSafetyRereviewResult> => {
    const flag = database.tables.safety_rereviews.find(row => row.review_id === reviewId);
    if (!flag) return { outcome: 'missing' };
    const required = flag.arrangement === 'venue' ? 'venue_staff' : 'technical_support_staff';
    const holds = database.tables.account_roles.some(row => row.user_id === actorId && row.role === required);
    if (actingRole !== required || !holds) return { outcome: 'forbidden' };
    if (flag.resolved_at !== null) return { outcome: 'closed', resolution: flag.resolution as 'confirmed' | 'withdrawn' };
    const label = labelOf(database, flag);
    Object.assign(flag, { resolution: 'confirmed', resolved_by: actorId, resolved_at: new Date().toISOString() });
    const event = database.tables.events.find(row => row.event_id === flag.event_id)!;
    const logs = database.tables.event_audit_logs;
    logs.push({ log_id: nextId(logs, 'log_id'), event_id: event.event_id, actor_id: actorId, field_name: 'safety_rereview', old_value: null,
      new_value: `${flag.arrangement === 'venue' ? 'Venue Staff' : 'Technical Support'} confirmed ${label} again`, created_at: new Date().toISOString() });
    const key = KEY_BY_ARRANGEMENT[flag.arrangement as SafetyRereviewArrangement];
    const outstanding = (event.outstanding_arrangements ?? []) as string[];
    if (outstanding.includes(key) && waitingOn(database, Number(event.event_id), key).length === 0) {
      event.outstanding_arrangements = outstanding.filter(item => item !== key);
      event.arrangements_recheck_needed = (event.outstanding_arrangements as string[]).length > 0;
      logs.push({ log_id: nextId(logs, 'log_id'), event_id: event.event_id, actor_id: actorId, field_name: 'arrangement_recheck',
        old_value: null, new_value: `${key} settled`, created_at: new Date().toISOString() });
      returnWhenSettled(database, event, actorId);
    }
    return { outcome: 'ok', review_id: reviewId, event_id: Number(event.event_id), status: String(event.status),
      outstanding_arrangements: event.outstanding_arrangements as RecheckKey[] };
  };

  return { listRereviews, listQueue, confirm };
}
