import { AccessError, authorization } from '../auth';
import { createSafetyChecksStore } from '../db/safetyChecks';

const UNAVAILABLE_MESSAGE = 'The safety check list is temporarily unavailable. Please try again.';

/** GET /api/safety-checks — the events awaiting an operational safety check,
 * with what the review needs (SG2-91 AC2/AC3), for Safety Officers only
 * (AC4: 'safety_checks.read' here, and the stored role in the database). */
export function createSafetyChecksRouter(access = authorization, store = createSafetyChecksStore) {
  const router = access.protectedRouter();
  router.get('/', access.requirePermission('safety_checks.read'), async (req, res) => {
    try {
      res.json({ events: await store(req.get('authorization')!.slice(7)).list() });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.status === 503 ? UNAVAILABLE_MESSAGE : failure.message });
    }
  });
  return router;
}
