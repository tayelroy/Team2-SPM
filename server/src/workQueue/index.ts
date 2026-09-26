import type { RequestHandler } from 'express';
import { authorization } from '../auth';
import { getSupabaseAdminClient } from '../db';
import { fetchWorkQueue, type WorkSelection } from '../db/workQueue';

export function createWorkQueueRouter(access = authorization, {
  getAdminClient = getSupabaseAdminClient,
  fetchItems = fetchWorkQueue,
} = {}) {
  const router = access.protectedRouter();
  const read: RequestHandler = async (req, res) => {
    let selection: WorkSelection | undefined;
    if (req.params.kind !== undefined) {
      const { kind, itemId } = req.params;
      if (!['event', 'venue', 'equipment'].includes(kind) || !/^[1-9]\d*$/.test(itemId) || !Number.isSafeInteger(Number(itemId))) {
        res.status(400).json({ error: 'Invalid work item.' });
        return;
      }
      selection = { kind: kind as WorkSelection['kind'], item_id: Number(itemId) };
    }
    try {
      const admin = getAdminClient();
      if (!admin) throw new Error('Unconfigured');
      const items = await fetchItems(admin, access.getPrincipal(req)!, selection);
      if (selection && items.length === 0) {
        res.status(404).json({ error: 'This item is no longer in your work queue. Return to the queue to refresh it.' });
        return;
      }
      res.json({ items });
    } catch {
      res.status(503).json({ error: 'Your work queue is temporarily unavailable. Please try again.' });
    }
  };
  router.get(['/', '/:kind/:itemId'], access.requirePermission('work_queue.read'), read);
  return router;
}
