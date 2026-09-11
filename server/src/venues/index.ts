import type { RequestHandler } from 'express';
import { authorization, type createAuthorization, AccessError } from '../auth';
import { createVenueStore } from '../db/venues';
import { validateVenue } from './fields';

export function createVenuesRouter(
  access: ReturnType<typeof createAuthorization> = authorization,
  store = createVenueStore
) {
  const router = access.protectedRouter();
  const handle = (operation: 'list' | 'create' | 'update'): RequestHandler => async (req, res) => {
    try {
      let id: number | undefined;
      if (operation === 'update') {
        if (!/^[1-9]\d*$/.test(req.params.venueId) || !Number.isSafeInteger(Number(req.params.venueId))) {
          res.status(400).json({ error: 'Invalid venue ID.' });
          return;
        }
        id = Number(req.params.venueId);
      }
      const values = operation === 'list' ? null : validateVenue(req.body);
      if (operation !== 'list' && !values) {
        res.status(400).json({ error: 'Complete every venue field, keep the name within 255 characters and enter a positive whole-number capacity.' });
        return;
      }
      // requireAuth has already verified the single, well-formed bearer header.
      const database = store(req.get('authorization')!.slice(7));
      if (operation === 'list') {
        res.json({ venues: await database.list() });
        return;
      }
      const venue = await database.save(values!, id);
      if (!venue) {
        res.status(operation === 'update' ? 404 : 503).json({ error: operation === 'update' ? 'Venue not found or no longer editable.' : 'Venue could not be saved.' });
        return;
      }
      res.status(operation === 'create' ? 201 : 200).json({ venue });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };
  router.get('/', access.requirePermission('venues.read'), handle('list'));
  router.post('/', access.requirePermission('venues.create'), handle('create'));
  router.put('/:venueId', access.requirePermission('venues.update'), handle('update'));
  return router;
}
