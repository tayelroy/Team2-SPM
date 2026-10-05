import type { RequestHandler } from 'express';
import { type createAuthorization, AccessError } from '../auth';
import { createVenueOperationStore } from '../db/venueOperations';
import { MAX_MINUTES, MAX_SAFETY_TEXT, validateVenueOperations } from './operationFields';

function parseVenueId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 2147483647) return null;
  return Number(raw);
}

/**
 * Router for a venue's setup time, turnaround time and safety details
 * (SG2-77). Mounted at /api/venues beside the venue, layout and block
 * routers; /:venueId/operations does not overlap their route patterns.
 */
export function createVenueOperationsRouter(
  access: ReturnType<typeof createAuthorization>,
  store = createVenueOperationStore
) {
  const router = access.protectedRouter();

  const handle = (operation: 'get' | 'save'): RequestHandler => async (req, res) => {
    try {
      const id = parseVenueId(req.params.venueId);
      if (id === null) {
        res.status(400).json({ error: 'Invalid venue ID.' });
        return;
      }
      const values = operation === 'get' ? null : validateVenueOperations(req.body);
      if (operation === 'save' && !values) {
        res.status(400).json({
          error: `Enter setup and turnaround times as whole minutes from 0 to ${MAX_MINUTES}, and keep each safety note within ${MAX_SAFETY_TEXT} characters.`
        });
        return;
      }
      // requireAuth has already verified the single, well-formed bearer header.
      const database = store(req.get('authorization')!.slice(7));
      const operations = operation === 'get' ? await database.get(id) : await database.save(id, values!);
      if (operations === null) {
        res.status(404).json({ error: 'Venue not found.' });
        return;
      }
      res.status(200).json({ operations });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };

  router.get('/:venueId/operations', access.requirePermission('venues.operations.read'), handle('get'));
  router.put('/:venueId/operations', access.requirePermission('venues.operations.update'), handle('save'));
  return router;
}
