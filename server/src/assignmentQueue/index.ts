import type { SupabaseClient } from '@supabase/supabase-js';
import { authorization } from '../auth';
import { getSupabaseAdminClient } from '../db';
import { fetchUnassignedQueue, type FetchUnassignedQueueResult } from '../db/assignmentQueue';
import { listCoordinators, type ListCoordinatorsResult } from '../db/accountRoles';

export interface AssignmentQueueDependencies {
  getAdminClient?: () => SupabaseClient | null;
  fetchQueue?: (admin: SupabaseClient) => Promise<FetchUnassignedQueueResult>;
  /** SG2-88 AC1: who the Lead can assign a queued request to. */
  fetchCoordinators?: (admin: SupabaseClient) => Promise<ListCoordinatorsResult>;
}

const UNAVAILABLE_MESSAGE = 'The assignment queue is temporarily unavailable. Please try again.';

/** GET /api/assignment-queue — the Event Coordinator Lead's queue of
 * submitted requests awaiting a coordinator (SG2-87). */
export function createAssignmentQueueRouter(access = authorization, {
  getAdminClient = getSupabaseAdminClient,
  fetchQueue = fetchUnassignedQueue,
  fetchCoordinators = listCoordinators
}: AssignmentQueueDependencies = {}) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('event_request.queue.view'), async (_req, res) => {
    const admin = getAdminClient();
    const [queue, coordinators] = admin ? await Promise.all([fetchQueue(admin), fetchCoordinators(admin)]) : [null, null];
    if (!queue?.ok || !coordinators?.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.json({ entries: queue.entries, coordinators: coordinators.coordinators });
  });
  return router;
}
