import type { SupabaseClient } from '@supabase/supabase-js';
import { authorization } from '../auth';
import { getSupabaseAdminClient } from '../db';
import {
  fetchSupervisedEvents,
  OVERSIGHT_STATUSES,
  type FetchSupervisedEventsResult,
  type SupervisedEvent
} from '../db/coordinatorOverview';
import { listCoordinators, type ListCoordinatorsResult } from '../db/accountRoles';

export interface CoordinatorOverviewDependencies {
  getAdminClient?: () => SupabaseClient | null;
  fetchEvents?: (admin: SupabaseClient, leadId: string) => Promise<FetchSupervisedEventsResult>;
  fetchCoordinators?: (admin: SupabaseClient) => Promise<ListCoordinatorsResult>;
}

/** One coordinator and how many of the Lead's active events they hold (AC2). */
export interface CoordinatorWorkload {
  user_id: string;
  name: string;
  active_events: number;
  /** False for someone who has since lost the coordinator role (AC6 reassigns away from them, never to them). */
  assignable: boolean;
}

const UNAVAILABLE_MESSAGE = 'The coordinator overview is temporarily unavailable. Please try again.';

/**
 * Every Event Coordinator, each with how many of the Lead's active events they
 * hold, so a coordinator with none still shows as free to take work (AC2). A
 * coordinator who has since lost the role still holds their events, so they
 * are listed too, by the name on the event.
 */
function workloads(coordinators: { user_id: string; name: string }[], events: SupervisedEvent[]): CoordinatorWorkload[] {
  const roster = new Map(coordinators.map(({ user_id, name }) => [user_id, { user_id, name, active_events: 0, assignable: true }]));
  for (const event of events) {
    const entry = roster.get(event.coordinator_id)
      ?? { user_id: event.coordinator_id, name: event.coordinator_name ?? 'Former coordinator', active_events: 0, assignable: false };
    entry.active_events += 1;
    roster.set(event.coordinator_id, entry);
  }
  return [...roster.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GET /api/coordinator-overview?coordinatorId=&status= — SG2-89: the Event
 * Coordinator Lead's view of the active events they supervise and who holds
 * each one. Workloads are counted before the filters apply, so narrowing the
 * list never hides how busy each coordinator is.
 */
export function createCoordinatorOverviewRouter(access = authorization, {
  getAdminClient = getSupabaseAdminClient,
  fetchEvents = fetchSupervisedEvents,
  fetchCoordinators = listCoordinators
}: CoordinatorOverviewDependencies = {}) {
  const router = access.protectedRouter();
  // SG2-89 AC4: only the Lead holds this permission.
  router.get('/', access.requirePermission('event_request.oversight.view'), async (req, res) => {
    const filters: Record<'coordinatorId' | 'status', string | null> = { coordinatorId: null, status: null };
    for (const key of ['coordinatorId', 'status'] as const) {
      const raw = req.query[key];
      if (raw !== undefined && typeof raw !== 'string') {
        res.status(400).json({ error: `Give ${key} at most once.` });
        return;
      }
      filters[key] = raw?.trim() || null;
    }
    // AC3: an unknown status is refused rather than silently showing nothing.
    if (filters.status && !OVERSIGHT_STATUSES.includes(filters.status)) {
      res.status(400).json({ error: 'status must be the status of an active event.' });
      return;
    }

    const admin = getAdminClient();
    const leadId = access.getPrincipal(req)!.userId;
    const [events, coordinators] = admin
      ? await Promise.all([fetchEvents(admin, leadId), fetchCoordinators(admin)])
      : [null, null];
    if (!events?.ok || !coordinators?.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }

    const roster = workloads(coordinators.coordinators, events.events);
    if (filters.coordinatorId && !roster.some(entry => entry.user_id === filters.coordinatorId)) {
      res.status(400).json({ error: 'coordinatorId must be an Event Coordinator.' });
      return;
    }
    res.json({
      events: events.events.filter(event =>
        (!filters.coordinatorId || event.coordinator_id === filters.coordinatorId)
        && (!filters.status || event.status === filters.status)),
      coordinators: roster,
      statuses: OVERSIGHT_STATUSES
    });
  });
  return router;
}
