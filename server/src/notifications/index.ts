import { type createAuthorization, AccessError } from '../auth';
import { listNotifications } from '../db/notifications';

/**
 * GET /api/notifications — the caller's own notices, newest first (SG2-49
 * AC1/AC2: a coordinator is told when Venue Staff approve or reject their
 * venue request, with the reason for a rejection).
 */
export function createNotificationsRouter(access: ReturnType<typeof createAuthorization>, list = listNotifications) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('notifications.read'), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const principal = access.getPrincipal(req)!;
      res.json({ notifications: await list(req.get('authorization')!.slice(7), principal.userId) });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  });
  return router;
}
