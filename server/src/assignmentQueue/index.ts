import type { SupabaseClient } from '@supabase/supabase-js';
import { authorization } from '../auth';
import { getSupabaseAdminClient } from '../db';
import { fetchUnassignedQueue, type FetchUnassignedQueueResult } from '../db/assignmentQueue';

export interface AssignmentQueueDependencies {
  getAdminClient?: () => SupabaseClient | null;
  fetchQueue?: (admin: SupabaseClient) => Promise<FetchUnassignedQueueResult>;
}

const UNAVAILABLE_MESSAGE = 'The assignment queue is temporarily unavailable. Please try again.';

/** GET /api/assignment-queue — the Event Coordinator Lead's queue of
 * submitted requests awaiting a coordinator (SG2-87). */
export function createAssignmentQueueRouter(access = authorization, {
  getAdminClient = getSupabaseAdminClient,
  fetchQueue = fetchUnassignedQueue
}: AssignmentQueueDependencies = {}) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('event_request.queue.view'), async (_req, res) => {
    const admin = getAdminClient();
    const result = admin ? await fetchQueue(admin) : null;
    if (!result?.ok) {
      res.status(503).json({ error: UNAVAILABLE_MESSAGE });
      return;
    }
    res.json({ entries: result.entries });
  });
  return router;
}
