import type { RequestHandler } from 'express';
import { type createAuthorization, AccessError } from '../auth';
import { createVenueLayoutStore } from '../db/venueLayouts';
import { validateVenueLayouts } from './layoutFields';

function parseVenueId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 2147483647) return null;
  return Number(raw);
}

/**
 * Router for a venue's supported layouts (SG2-43). Mounted alongside
 * createVenuesRouter's venue CRUD (SG2-42) at /api/venues; the route pattern
 * (/:venueId/layouts) does not overlap with either sibling router.
 */
export function createVenueLayoutsRouter(
  access: ReturnType<typeof createAuthorization>,
  store = createVenueLayoutStore
) {
  const router = access.protectedRouter();

  const handle = (operation: 'list' | 'replace'): RequestHandler => async (req, res) => {
    try {
      const id = parseVenueId(req.params.venueId);
      if (id === null) {
        res.status(400).json({ error: 'Invalid venue ID.' });
        return;
      }
      const values = operation === 'list' ? null : validateVenueLayouts(req.body?.layouts);
      if (operation === 'replace' && !values) {
        res.status(400).json({
          error: 'Choose one of the listed layouts for each entry; "Other" needs a short description within 255 characters.'
        });
        return;
      }
      // requireAuth has already verified the single, well-formed bearer header.
      const database = store(req.get('authorization')!.slice(7));
      if (operation === 'list') {
        res.json({ layouts: await database.list(id) });
        return;
      }
      const layouts = await database.replace(id, values!);
      if (layouts === null) {
        res.status(404).json({ error: 'Venue not found.' });
        return;
      }
      res.status(200).json({ layouts });
    } catch (error) {
      const failure = error instanceof AccessError ? error : new AccessError(503);
      res.status(failure.status).json({ error: failure.message });
    }
  };

  router.get('/:venueId/layouts', access.requirePermission('venues.layouts.read'), handle('list'));
  router.put('/:venueId/layouts', access.requirePermission('venues.layouts.update'), handle('replace'));
  return router;
}
